import XLSX from 'xlsx'

const API_BASE = 'https://mananasiappproduction.up.railway.app'
const WORKBOOK = '7. 2026 June - July Harvest.xlsx'
const RECORDED_BY_ID = '0014'
const RECORDED_BY_NAME = 'James Boyd Moss'
const BATCH_NUMBER = '62'

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function tokenizeName(value) {
  return normalizeName(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

function levenshteinDistance(left, right) {
  const a = String(left ?? '')
  const b = String(right ?? '')
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }
  return matrix[a.length][b.length]
}

function toIsoDateFromSheetName(sheetName) {
  const match = String(sheetName).match(/^(\d{2})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const [, dd, mm, yy] = match
  return `20${yy}-${mm}-${dd}`
}

function parseWorkbookRecords(workbookPath) {
  const workbook = XLSX.readFile(workbookPath)
  const records = []
  for (const sheetName of workbook.SheetNames) {
    const harvestedOn = toIsoDateFromSheetName(sheetName)
    if (!harvestedOn) continue
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const serial = Number(row[0])
      const harvesterName = String(row[1] ?? '').trim()
      if (!Number.isFinite(serial) || !harvesterName) continue
      const bundleWeights = row
        .slice(2, 12)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry > 0)
      if (bundleWeights.length === 0) continue
      records.push({
        harvestedOn,
        harvesterName,
        bundleWeights,
        kg: Number(bundleWeights.reduce((sum, value) => sum + value, 0).toFixed(1)),
      })
    }
  }
  return records
}

function buildHarvesterProfiles(employees) {
  return (employees ?? [])
    .filter((employee) => String(employee.role ?? '') === 'harvester')
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      normalizedName: normalizeName(employee.name),
      tokens: tokenizeName(employee.name),
    }))
}

function matchHarvesterId(rawName, profiles) {
  const normalized = normalizeName(rawName)
  const manualAliases = {
    'elizabeth makasi': '0078',
    'gideon gicharu': '0098',
    victoria: '0074',
    'calvince mwongela': '0088',
  }
  if (manualAliases[normalized]) return manualAliases[normalized]
  const exact = profiles.find((profile) => profile.normalizedName === normalized)
  if (exact) return exact.id
  const sourceTokens = tokenizeName(rawName)
  if (sourceTokens.length === 0) return null
  let best = null
  for (const profile of profiles) {
    const intersection = sourceTokens.filter((token) =>
      profile.tokens.some((employeeToken) => {
        if (employeeToken === token) return true
        if (token.length >= 4 && employeeToken.startsWith(token)) return true
        if (employeeToken.length >= 4 && token.startsWith(employeeToken)) return true
        return (
          token.length >= 5 &&
          employeeToken.length >= 5 &&
          levenshteinDistance(token, employeeToken) <= 1
        )
      }),
    ).length
    const score =
      intersection / Math.max(sourceTokens.length, profile.tokens.length) +
      (profile.normalizedName.includes(normalized) || normalized.includes(profile.normalizedName) ? 0.25 : 0)
    if (!best || score > best.score) best = { profile, score, intersection }
  }
  if (!best) return null
  if (best.intersection < 2 || best.score < 0.45) return null
  return best.profile.id
}

function keyOf(date, harvesterId) {
  return `${date}|${harvesterId}`
}

async function fetchState() {
  const response = await fetch(`${API_BASE}/api/state`)
  if (!response.ok) {
    throw new Error(`Fetch state failed (${response.status})`)
  }
  return response.json()
}

async function putState(state) {
  const response = await fetch(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PUT failed (${response.status}): ${text}`)
  }
}

function summarize(records, datesSet) {
  const byDate = {}
  for (const record of records) {
    if (!datesSet.has(record.harvestedOn)) continue
    if (!byDate[record.harvestedOn]) byDate[record.harvestedOn] = { count: 0, total: 0 }
    byDate[record.harvestedOn].count += 1
    byDate[record.harvestedOn].total = Number((byDate[record.harvestedOn].total + Number(record.kg ?? 0)).toFixed(1))
  }
  return byDate
}

async function main() {
  const original = await fetchState()
  const profiles = buildHarvesterProfiles(original.employees ?? [])
  const workbookRows = parseWorkbookRecords(WORKBOOK)
  const workbookDates = [...new Set(workbookRows.map((row) => row.harvestedOn))].sort()
  const workbookDatesSet = new Set(workbookDates)

  const desiredByKey = new Map()
  for (const row of workbookRows) {
    const harvesterId = matchHarvesterId(row.harvesterName, profiles)
    if (!harvesterId) continue
    const key = keyOf(row.harvestedOn, harvesterId)
    const existing = desiredByKey.get(key)
    if (existing) {
      existing.kg = Number((existing.kg + row.kg).toFixed(1))
      existing.bundleWeights.push(...row.bundleWeights)
    } else {
      desiredByKey.set(key, {
        harvestedOn: row.harvestedOn,
        harvesterId,
        harvesterName: profiles.find((profile) => profile.id === harvesterId)?.name ?? row.harvesterName,
        kg: row.kg,
        bundleWeights: [...row.bundleWeights],
      })
    }
  }

  const records = Array.isArray(original.records) ? [...original.records] : []
  const nonRecoveryKeys = new Set(
    records
      .filter(
        (record) => workbookDatesSet.has(record.harvestedOn) && !String(record.id ?? '').startsWith('RECOVERY-'),
      )
      .map((record) => keyOf(record.harvestedOn, record.harvesterId)),
  )

  let nextRecords = records.filter((record) => {
    const isWorkbookDate = workbookDatesSet.has(record.harvestedOn)
    if (!isWorkbookDate) return true
    const id = String(record.id ?? '')
    if (!id.startsWith('RECOVERY-')) return true
    if (id.startsWith('RECOVERY-ADJ-0088-')) return false
    return !nonRecoveryKeys.has(keyOf(record.harvestedOn, record.harvesterId))
  })

  const byKey = new Map()
  for (const record of nextRecords) {
    if (!workbookDatesSet.has(record.harvestedOn)) continue
    const key = keyOf(record.harvestedOn, record.harvesterId)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(record)
  }

  function currentKgForKey(key) {
    return Number(
      ((byKey.get(key) ?? []).reduce((sum, record) => sum + Number(record.kg ?? 0), 0)).toFixed(1),
    )
  }

  for (const [key, desired] of desiredByKey.entries()) {
    let diff = Number((desired.kg - currentKgForKey(key)).toFixed(1))
    if (Math.abs(diff) <= 0.1) continue

    if (diff > 0) {
      const rec = {
        id: `RECOVERY-RECON-${desired.harvesterId}-${desired.harvestedOn}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        harvesterId: desired.harvesterId,
        harvesterName: desired.harvesterName,
        bundleWeights: [diff],
        kg: diff,
        harvestedOn: desired.harvestedOn,
        clockInTime: '',
        clockOutTime: '',
        supervisorDailyWageKes: 0,
        batchNumber: BATCH_NUMBER,
        supervisorBonusKes: 0,
        incentiveKes: 0,
        recordedById: RECORDED_BY_ID,
        recordedByName: RECORDED_BY_NAME,
      }
      nextRecords.unshift(rec)
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(rec)
      continue
    }

    let amountToTrim = Number(Math.abs(diff).toFixed(1))
    const rowsForKey = byKey.get(key) ?? []
    const recoveryRows = rowsForKey.filter((row) => String(row.id ?? '').startsWith('RECOVERY-'))
    for (const row of recoveryRows) {
      if (amountToTrim <= 0.1) break
      const rowKg = Number(row.kg ?? 0)
      if (rowKg <= amountToTrim + 0.1) {
        amountToTrim = Number((amountToTrim - rowKg).toFixed(1))
        nextRecords = nextRecords.filter((candidate) => candidate.id !== row.id)
      } else {
        row.kg = Number((rowKg - amountToTrim).toFixed(1))
        row.bundleWeights = [row.kg]
        amountToTrim = 0
      }
    }

    if (amountToTrim > 0.1) {
      const nonRecoveryRows = rowsForKey.filter((row) => !String(row.id ?? '').startsWith('RECOVERY-'))
      nonRecoveryRows.sort((left, right) => Number(right.kg ?? 0) - Number(left.kg ?? 0))
      const target = nonRecoveryRows[0]
      if (target) {
        const updatedKg = Number((Number(target.kg ?? 0) - amountToTrim).toFixed(1))
        if (updatedKg > 0) {
          target.kg = updatedKg
        } else {
          nextRecords = nextRecords.filter((candidate) => candidate.id !== target.id)
        }
      }
    }
  }

  const desiredKeys = new Set(desiredByKey.keys())
  for (const record of [...nextRecords]) {
    if (!workbookDatesSet.has(record.harvestedOn)) continue
    const key = keyOf(record.harvestedOn, record.harvesterId)
    if (!desiredKeys.has(key)) continue
  }

  const payload = {
    ...original,
    records: nextRecords,
    _meta: {
      ...(original._meta ?? {}),
      expectedUpdatedAt: original?._meta?.updatedAt ?? null,
      changeSource: 'harvest-reconcile-workbook',
    },
  }

  try {
    await putState(payload)
  } catch (error) {
    if (!String(error.message).includes('409')) throw error
    const latest = await fetchState()
    const retryPayload = {
      ...latest,
      records: nextRecords,
      _meta: {
        ...(latest._meta ?? {}),
        expectedUpdatedAt: latest?._meta?.updatedAt ?? null,
        changeSource: 'harvest-reconcile-workbook',
      },
    }
    await putState(retryPayload)
  }

  const finalState = await fetchState()
  const finalSummary = summarize(finalState.records ?? [], workbookDatesSet)
  console.log(
    JSON.stringify(
      {
        workbookDates,
        workbookSummary: summarize(
          [...desiredByKey.values()].map((entry) => ({
            harvestedOn: entry.harvestedOn,
            kg: entry.kg,
          })),
          workbookDatesSet,
        ),
        liveSummary: finalSummary,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
