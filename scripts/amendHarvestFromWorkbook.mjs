import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { calculateHarvestWage } from '../src/employeePay.js'

function parseArgs(argv) {
  const options = {
    workbook: '7. 2026 June - July Harvest.xlsx',
    apiBaseUrl: 'https://mananasiappproduction.up.railway.app',
    batchNumber: '62',
    recordedById: '0014',
    recordedByName: 'James Boyd Moss',
    apply: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--workbook') options.workbook = argv[index + 1] ?? options.workbook
    if (token === '--api') options.apiBaseUrl = argv[index + 1] ?? options.apiBaseUrl
    if (token === '--batch') options.batchNumber = argv[index + 1] ?? options.batchNumber
    if (token === '--recorded-by-id') options.recordedById = argv[index + 1] ?? options.recordedById
    if (token === '--recorded-by-name') options.recordedByName = argv[index + 1] ?? options.recordedByName
    if (token === '--apply') options.apply = true
  }

  return options
}

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

function parseWorkbookRecords(workbookPath, fallbackBatchNumber) {
  const workbook = XLSX.readFile(workbookPath)
  const records = []

  for (const sheetName of workbook.SheetNames) {
    const harvestedOn = toIsoDateFromSheetName(sheetName)
    if (!harvestedOn) continue

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
    })

    for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const serial = Number(row[0])
      const harvesterName = String(row[1] ?? '').trim()
      if (!Number.isFinite(serial) || !harvesterName || harvesterName.toUpperCase().includes('TOTAL')) {
        continue
      }

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
        batchNumber: String(fallbackBatchNumber),
      })
    }
  }

  return records
}

function buildEmployeeNameMaps(employees) {
  const idByName = new Map()
  const preferredNameByName = new Map()
  const employeeById = new Map()
  const harvesterProfiles = []

  for (const employee of employees ?? []) {
    employeeById.set(String(employee.id), employee)
    const key = normalizeName(employee.name)
    if (!key) continue
    if (!idByName.has(key)) idByName.set(key, employee.id)
    if (!preferredNameByName.has(key)) preferredNameByName.set(key, employee.name)
    if (String(employee.role ?? '') === 'harvester' || String(employee.role ?? '') === 'inactive') {
      harvesterProfiles.push({
        id: employee.id,
        name: employee.name,
        normalizedName: key,
        tokens: tokenizeName(employee.name),
      })
    }
  }

  return { idByName, preferredNameByName, harvesterProfiles, employeeById }
}

function matchHarvesterByName(rawName, maps) {
  const normalized = normalizeName(rawName)
  const manualAliases = {
    'elizabeth makasi': '0078',
    'gideon gicharu': '0098',
    victoria: '0074',
    'calvince mwongela': '0088',
    'samwel mukule': '0037',
    'lydiah mweru': '0077',
    'graiton pamba': '0105',
    'grainton pamba ameyo': '0105',
    'brian nyangule': '0104',
    'brian mwinami nyangule': '0104',
  }
  const aliasId = manualAliases[normalized]
  if (aliasId) {
    const employee = maps.employeeById.get(aliasId)
    if (employee) {
      return {
        harvesterId: String(employee.id),
        harvesterName: employee.name,
      }
    }
  }

  const exactId = maps.idByName.get(normalized)
  if (exactId) {
    return {
      harvesterId: exactId,
      harvesterName: maps.preferredNameByName.get(normalized) ?? rawName,
    }
  }

  const sourceTokens = tokenizeName(rawName)
  if (sourceTokens.length === 0) return null

  let best = null
  for (const profile of maps.harvesterProfiles) {
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

  if (!best || best.intersection < 2 || best.score < 0.45) return null
  return {
    harvesterId: best.profile.id,
    harvesterName: best.profile.name,
  }
}

function personDateKey(harvestedOn, harvesterId) {
  return `${harvestedOn}|${harvesterId}`
}

function bundlesMatch(left, right) {
  const a = Array.isArray(left) ? left.map(Number) : []
  const b = Array.isArray(right) ? right.map(Number) : []
  if (a.length !== b.length) return false
  return a.every((value, index) => Math.abs(value - b[index]) <= 0.01)
}

function summarizeByDate(records) {
  const summary = {}
  for (const record of records) {
    if (!summary[record.harvestedOn]) summary[record.harvestedOn] = { count: 0, kg: 0 }
    summary[record.harvestedOn].count += 1
    summary[record.harvestedOn].kg = Number((summary[record.harvestedOn].kg + Number(record.kg ?? 0)).toFixed(1))
  }
  return summary
}

function chooseKeeper(rows) {
  const sorted = [...rows].sort((left, right) => {
    const leftRecovery = String(left.id ?? '').startsWith('RECOVERY-') ? 1 : 0
    const rightRecovery = String(right.id ?? '').startsWith('RECOVERY-') ? 1 : 0
    if (leftRecovery !== rightRecovery) return leftRecovery - rightRecovery
    return String(left.id ?? '').localeCompare(String(right.id ?? ''))
  })
  return sorted[0] ?? null
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${url} failed (${response.status}): ${body?.error ?? text}`)
  }
  return body
}

async function saveWithRetry(apiBase, buildPayload) {
  let state = await fetchJson(`${apiBase}/api/state`)
  let payload = buildPayload(state)
  try {
    await fetchJson(`${apiBase}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return
  } catch (error) {
    if (!String(error.message).includes('(409)')) throw error
  }
  state = await fetchJson(`${apiBase}/api/state`)
  payload = buildPayload(state)
  await fetchJson(`${apiBase}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workbookPath = path.resolve(process.cwd(), args.workbook)
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`)
  }

  const apiBase = String(args.apiBaseUrl).replace(/\/+$/, '')
  const state = await fetchJson(`${apiBase}/api/state`)
  const employees = Array.isArray(state.employees) ? state.employees : []
  const employeeById = new Map(employees.map((employee) => [String(employee.id), employee]))
  const compensationRules =
    state.compensationRules && typeof state.compensationRules === 'object' ? state.compensationRules : {}
  const maps = buildEmployeeNameMaps(employees)

  const workbookRows = parseWorkbookRecords(workbookPath, args.batchNumber)
  const workbookDates = [...new Set(workbookRows.map((row) => row.harvestedOn))].sort()
  const workbookDatesSet = new Set(workbookDates)

  const desiredByKey = new Map()
  const unresolvedNames = new Map()
  for (const row of workbookRows) {
    const match = matchHarvesterByName(row.harvesterName, maps)
    if (!match) {
      unresolvedNames.set(row.harvesterName, (unresolvedNames.get(row.harvesterName) ?? 0) + 1)
      continue
    }
    const key = personDateKey(row.harvestedOn, match.harvesterId)
    const existing = desiredByKey.get(key)
    if (existing) {
      existing.bundleWeights.push(...row.bundleWeights)
      existing.kg = Number(existing.bundleWeights.reduce((sum, value) => sum + value, 0).toFixed(1))
    } else {
      desiredByKey.set(key, {
        harvestedOn: row.harvestedOn,
        harvesterId: match.harvesterId,
        harvesterName: match.harvesterName,
        bundleWeights: [...row.bundleWeights],
        kg: row.kg,
        batchNumber: row.batchNumber,
      })
    }
  }

  const existingRecords = Array.isArray(state.records) ? state.records : []
  const recordsOutsideWorkbook = existingRecords.filter((record) => !workbookDatesSet.has(record.harvestedOn))
  const recordsInWorkbook = existingRecords.filter((record) => workbookDatesSet.has(record.harvestedOn))

  const liveByKey = new Map()
  for (const record of recordsInWorkbook) {
    const key = personDateKey(record.harvestedOn, record.harvesterId)
    if (!liveByKey.has(key)) liveByKey.set(key, [])
    liveByKey.get(key).push(record)
  }

  const deletedIds = new Set(
    Array.isArray(state.deletedEntityIds?.records) ? state.deletedEntityIds.records.map(String) : [],
  )
  const nextRecords = [...recordsOutsideWorkbook]
  const changes = {
    updated: 0,
    created: 0,
    removed: 0,
    unchanged: 0,
    mismatchesBefore: [],
  }

  for (const [key, desired] of desiredByKey.entries()) {
    const liveRows = liveByKey.get(key) ?? []
    const keeper = chooseKeeper(liveRows)
    const employee = employeeById.get(String(desired.harvesterId))
    const wage = employee
      ? calculateHarvestWage(desired.kg, employee, compensationRules, { workDate: desired.harvestedOn })
      : { baseWageKes: 0, incentiveKes: 0, wageKes: 0 }

    if (keeper) {
      const currentKg = Number(keeper.kg ?? 0)
      const needsUpdate =
        Math.abs(currentKg - desired.kg) > 0.1 || !bundlesMatch(keeper.bundleWeights, desired.bundleWeights)

      if (needsUpdate) {
        changes.mismatchesBefore.push({
          harvestedOn: desired.harvestedOn,
          harvesterId: desired.harvesterId,
          harvesterName: desired.harvesterName,
          fromKg: currentKg,
          toKg: desired.kg,
        })
      }

      nextRecords.push({
        ...keeper,
        harvesterId: desired.harvesterId,
        harvesterName: desired.harvesterName,
        bundleWeights: [...desired.bundleWeights],
        kg: desired.kg,
        batchNumber: desired.batchNumber,
        baseWageKes: Number(wage.baseWageKes) || 0,
        incentiveKes: Number(wage.incentiveKes) || 0,
        wageKes: Number(wage.wageKes) || 0,
      })

      if (needsUpdate) changes.updated += 1
      else changes.unchanged += 1

      for (const row of liveRows) {
        if (String(row.id) !== String(keeper.id)) {
          deletedIds.add(String(row.id))
          changes.removed += 1
        }
      }
    } else {
      nextRecords.push({
        id: `RECOVERY-WB-${desired.harvesterId}-${desired.harvestedOn}-${Date.now()}`,
        harvesterId: desired.harvesterId,
        harvesterName: desired.harvesterName,
        bundleWeights: [...desired.bundleWeights],
        kg: desired.kg,
        harvestedOn: desired.harvestedOn,
        clockInTime: '',
        clockOutTime: '',
        supervisorDailyWageKes: 0,
        batchNumber: desired.batchNumber,
        supervisorBonusKes: 0,
        baseWageKes: Number(wage.baseWageKes) || 0,
        incentiveKes: Number(wage.incentiveKes) || 0,
        wageKes: Number(wage.wageKes) || 0,
        recordedById: args.recordedById,
        recordedByName: args.recordedByName,
      })
      changes.created += 1
    }

    liveByKey.delete(key)
  }

  for (const rows of liveByKey.values()) {
    for (const row of rows) {
      deletedIds.add(String(row.id))
      changes.removed += 1
    }
  }

  const workbookSummary = summarizeByDate(
    [...desiredByKey.values()].map((entry) => ({
      harvestedOn: entry.harvestedOn,
      kg: entry.kg,
    })),
  )
  const beforeSummary = summarizeByDate(existingRecords.filter((record) => workbookDatesSet.has(record.harvestedOn)))
  const afterSummary = summarizeByDate(nextRecords.filter((record) => workbookDatesSet.has(record.harvestedOn)))

  const report = {
    workbookDates,
    unresolvedNames: Object.fromEntries([...unresolvedNames.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    changes,
    mismatchesBefore: changes.mismatchesBefore,
    beforeSummary,
    workbookSummary,
    afterSummary,
  }

  console.log(JSON.stringify(report, null, 2))

  if (!args.apply) {
    console.log('\nDry run complete. Re-run with --apply to amend live records.')
    return
  }

  await saveWithRetry(apiBase, (latest) => ({
    records: nextRecords,
    deletedEntityIds: {
      ...(latest.deletedEntityIds ?? {}),
      records: Array.from(deletedIds),
    },
    _meta: {
      ...(latest._meta ?? {}),
      expectedUpdatedAt: latest?._meta?.updatedAt ?? null,
      changeSource: 'amend-harvest-from-workbook',
    },
  }))

  const verify = await fetchJson(`${apiBase}/api/state`)
  console.log(
    '\nApplied. Live summary now:',
    JSON.stringify(
      summarizeByDate((verify.records ?? []).filter((record) => workbookDatesSet.has(record.harvestedOn))),
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
