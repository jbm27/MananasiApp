import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

function parseArgs(argv) {
  const options = {
    workbook: '',
    apiBaseUrl: '',
    batchNumber: '62',
    recordedById: '',
    recordedByName: 'Data Recovery',
    includeDates: [],
    apply: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--workbook') options.workbook = argv[index + 1] ?? ''
    if (token === '--api') options.apiBaseUrl = argv[index + 1] ?? ''
    if (token === '--batch') options.batchNumber = argv[index + 1] ?? '62'
    if (token === '--recorded-by-id') options.recordedById = argv[index + 1] ?? ''
    if (token === '--recorded-by-name') options.recordedByName = argv[index + 1] ?? 'Data Recovery'
    if (token === '--dates')
      options.includeDates = String(argv[index + 1] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    if (token === '--apply') options.apply = true
  }

  if (!options.workbook || !options.apiBaseUrl || !options.recordedById) {
    throw new Error(
      'Usage: node scripts/syncHarvestFromWorkbook.mjs --workbook "<path.xlsx>" --api "<https://api...>" --recorded-by-id "<employeeId>" [--recorded-by-name "<name>"] [--batch 62] [--apply]',
    )
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
      if (!Number.isFinite(serial) || !harvesterName) continue

      const bundleWeights = row
        .slice(2, 12)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry > 0)

      if (bundleWeights.length === 0) continue

      const kg = Number(bundleWeights.reduce((sum, value) => sum + value, 0).toFixed(1))
      records.push({
        harvestedOn,
        harvesterName,
        bundleWeights,
        kg,
        batchNumber: String(fallbackBatchNumber),
      })
    }
  }

  return records
}

function buildEmployeeNameMaps(employees) {
  const idByName = new Map()
  const preferredNameByName = new Map()
  const harvesterProfiles = []

  for (const employee of employees ?? []) {
    if (String(employee.role ?? '') !== 'harvester') continue
    const key = normalizeName(employee.name)
    if (!key) continue
    if (!idByName.has(key)) idByName.set(key, employee.id)
    if (!preferredNameByName.has(key)) preferredNameByName.set(key, employee.name)
    harvesterProfiles.push({
      id: employee.id,
      name: employee.name,
      normalizedName: key,
      tokens: tokenizeName(employee.name),
    })
  }

  return { idByName, preferredNameByName, harvesterProfiles }
}

function matchHarvesterByName(rawName, maps) {
  const normalized = normalizeName(rawName)
  const manualAliases = {
    'elizabeth makasi': '0078',
    'gideon gicharu': '0098',
    victoria: '0074',
  }
  const aliasId = manualAliases[normalized]
  if (aliasId) {
    const profile = maps.harvesterProfiles.find((item) => item.id === aliasId)
    if (profile) {
      return {
        harvesterId: profile.id,
        harvesterName: profile.name,
        strategy: 'alias',
      }
    }
  }
  const exactId = maps.idByName.get(normalized)
  if (exactId) {
    return {
      harvesterId: exactId,
      harvesterName: maps.preferredNameByName.get(normalized) ?? rawName,
      strategy: 'exact',
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
    if (!best || score > best.score) {
      best = { profile, score, intersection }
    }
  }

  if (!best) return null
  if (best.intersection < 2 || best.score < 0.45) return null
  return {
    harvesterId: best.profile.id,
    harvesterName: best.profile.name,
    strategy: 'fuzzy',
  }
}

function summarizeByDate(records) {
  const summary = {}
  for (const record of records) {
    if (!summary[record.harvestedOn]) summary[record.harvestedOn] = { count: 0, kg: 0 }
    summary[record.harvestedOn].count += 1
    summary[record.harvestedOn].kg = Number((summary[record.harvestedOn].kg + record.kg).toFixed(1))
  }
  return summary
}

function recordKey(record) {
  return [
    record.harvestedOn,
    normalizeName(record.harvesterName),
    String(record.kg),
    (record.bundleWeights ?? []).join(','),
  ].join('|')
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workbookPath = path.resolve(process.cwd(), args.workbook)
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`)
  }

  const apiBase = String(args.apiBaseUrl).replace(/\/+$/, '')
  const state = await fetchJson(`${apiBase}/api/state`)
  const employees = Array.isArray(state?.employees) ? state.employees : []
  const existingRecords = Array.isArray(state?.records) ? state.records : []
  const maps = buildEmployeeNameMaps(employees)

  const workbookRecords = parseWorkbookRecords(workbookPath, args.batchNumber).filter((record) =>
    args.includeDates.length === 0 ? true : args.includeDates.includes(record.harvestedOn),
  )
  const workbookByDate = summarizeByDate(workbookRecords)
  const existingByDate = summarizeByDate(existingRecords)

  const unresolvedNames = new Map()
  const fuzzyMatches = []
  const normalizedWorkbookRecords = []
  for (const record of workbookRecords) {
    const match = matchHarvesterByName(record.harvesterName, maps)
    if (!match) {
      unresolvedNames.set(record.harvesterName, (unresolvedNames.get(record.harvesterName) ?? 0) + 1)
      continue
    }
    if (match.strategy === 'fuzzy') {
      fuzzyMatches.push({
        sourceName: record.harvesterName,
        matchedName: match.harvesterName,
        harvesterId: match.harvesterId,
      })
    }
    normalizedWorkbookRecords.push({
      ...record,
      harvesterId: match.harvesterId,
      harvesterName: match.harvesterName,
    })
  }

  const existingKeySet = new Set(existingRecords.map(recordKey))
  const missingRecords = normalizedWorkbookRecords.filter((record) => !existingKeySet.has(recordKey(record)))

  const workbookAggByPersonDate = new Map()
  for (const record of normalizedWorkbookRecords) {
    const key = `${record.harvestedOn}|${record.harvesterId}`
    if (!workbookAggByPersonDate.has(key)) {
      workbookAggByPersonDate.set(key, { harvestedOn: record.harvestedOn, harvesterId: record.harvesterId, kg: 0 })
    }
    const entry = workbookAggByPersonDate.get(key)
    entry.kg = Number((entry.kg + record.kg).toFixed(1))
  }

  const existingAggByPersonDate = new Map()
  for (const record of existingRecords) {
    const key = `${record.harvestedOn}|${record.harvesterId}`
    if (!existingAggByPersonDate.has(key)) {
      existingAggByPersonDate.set(key, { harvestedOn: record.harvestedOn, harvesterId: record.harvesterId, kg: 0 })
    }
    const entry = existingAggByPersonDate.get(key)
    entry.kg = Number((entry.kg + Number(record.kg ?? 0)).toFixed(1))
  }

  const mismatches = []
  for (const [key, expected] of workbookAggByPersonDate.entries()) {
    const current = existingAggByPersonDate.get(key)
    if (!current) continue
    if (Math.abs(expected.kg - current.kg) > 0.1) {
      mismatches.push({
        harvestedOn: expected.harvestedOn,
        harvesterId: expected.harvesterId,
        expectedKg: expected.kg,
        currentKg: current.kg,
      })
    }
  }

  const missingPayload = missingRecords.map((record, index) => ({
    id: `RECOVERY-${record.harvesterId}-${record.harvestedOn}-${Date.now()}-${index + 1}`,
    harvesterId: record.harvesterId,
    harvesterName: record.harvesterName,
    bundleWeights: record.bundleWeights,
    kg: record.kg,
    harvestedOn: record.harvestedOn,
    clockInTime: '',
    clockOutTime: '',
    supervisorDailyWageKes: 0,
    batchNumber: record.batchNumber,
    supervisorBonusKes: 0,
    incentiveKes: 0,
    recordedById: args.recordedById,
    recordedByName: args.recordedByName,
  }))

  const nextState = {
    ...state,
    records: [...missingPayload, ...existingRecords],
    _meta: {
      ...(state?._meta ?? {}),
      expectedUpdatedAt: state?._meta?.updatedAt ?? null,
      changeSource: 'harvest-recovery-script',
    },
  }

  const report = {
    workbookPath,
    workbookDates: Object.keys(workbookByDate).sort(),
    workbookByDate,
    existingByDate,
    unresolvedNameCount: unresolvedNames.size,
    unresolvedNames: Object.fromEntries([...unresolvedNames.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    fuzzyMatchCount: fuzzyMatches.length,
    fuzzyMatches,
    missingRecordCount: missingPayload.length,
    mismatchCount: mismatches.length,
    mismatches,
  }

  console.log(JSON.stringify(report, null, 2))

  if (!args.apply) {
    console.log('\nDry run complete. Re-run with --apply to push missing records to API state.')
    return
  }

  await fetchJson(`${apiBase}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nextState),
  })
  console.log('\nApplied successfully: missing records inserted into app state.')
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
