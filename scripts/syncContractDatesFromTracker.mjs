#!/usr/bin/env node
/**
 * Sync contract start/end dates from Contract Expiry Tracker into live app state.
 *
 * Reads the currently open Excel workbook via COM when possible, otherwise the
 * saved Downloads copy.
 *
 * Usage:
 *   node scripts/syncContractDatesFromTracker.mjs
 *   node scripts/syncContractDatesFromTracker.mjs --dry-run
 *   node scripts/syncContractDatesFromTracker.mjs --api https://mananasiappproduction.up.railway.app
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const apiIdx = args.indexOf('--api')
const apiBase =
  (apiIdx >= 0 ? args[apiIdx + 1] : null) || 'https://mananasiappproduction.up.railway.app'
const fileIdx = args.indexOf('--file')
const fileOverride = fileIdx >= 0 ? args[fileIdx + 1] : null

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultFile = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'Contract Expiry Tracker(1).xlsx',
)

function parseDate(value) {
  const raw = String(value ?? '').trim()
  if (!raw || /^n\/?a$/i.test(raw)) {
    return ''
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    let [, a, b, y] = slash
    const year = y.length === 2 ? `20${y}` : y
    // Prefer DD/MM/YYYY (Kenya), but accept already-swapped M/D/YY from Excel US format.
    let day = Number(a)
    let month = Number(b)
    if (day <= 12 && month > 12) {
      // was MM/DD/YYYY
      month = Number(a)
      day = Number(b)
    } else if (day > 12 && month <= 12) {
      // DD/MM/YYYY
    } else {
      // ambiguous: treat as DD/MM/YYYY (tracker convention)
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30) + value * 86400000
    return new Date(epoch).toISOString().slice(0, 10)
  }
  const asDate = value instanceof Date ? value : new Date(raw)
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString().slice(0, 10)
  }
  return null
}

function padId(value) {
  const raw = String(value ?? '').trim()
  if (/^\d+$/.test(raw)) {
    return raw.padStart(4, '0')
  }
  return raw
}

function readOpenWorkbookViaCom() {
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
} catch {
  Write-Output 'NO_EXCEL'
  exit 2
}
$wb = $null
foreach ($w in @($excel.Workbooks)) {
  if ($w.Name -like '*Contract Expiry*') { $wb = $w; break }
}
if (-not $wb) {
  Write-Output 'NO_OPEN_WORKBOOK'
  exit 1
}
$ws = $wb.Worksheets.Item(1)
$used = $ws.UsedRange
$rows = $used.Rows.Count
$cols = $used.Columns.Count
for ($r = 1; $r -le $rows; $r++) {
  $vals = @()
  for ($c = 1; $c -le $cols; $c++) {
    $vals += [string]$ws.Cells.Item($r, $c).Text
  }
  Write-Output ($vals -join "\`t")
}
`
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    )
    if (out.startsWith('NO_')) {
      return null
    }
    return out
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((cols) => cols.some((c) => String(c).trim()))
  } catch {
    return null
  }
}

function readRowsFromFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false,
  })
}

function extractTrackerRows(grid) {
  const rows = []
  for (const cols of grid) {
    const id = padId(cols[0])
    if (!/^\d{4}$/.test(id)) {
      continue
    }
    const name = String(cols[1] ?? '').trim()
    // Prefer updated columns (E/F) when present, else C/D.
    const startRaw = String(cols[4] ?? '').trim() || cols[2]
    const endRaw = String(cols[5] ?? '').trim() || cols[3]
    const start = parseDate(startRaw)
    const end = parseDate(endRaw)
    if (start === null || end === null) {
      rows.push({ id, name, error: `Unparseable date(s): start=${startRaw} end=${endRaw}` })
      continue
    }
    rows.push({ id, name, contractStartDate: start, contractEndDate: end })
  }
  return rows
}

const comGrid = fileOverride ? null : readOpenWorkbookViaCom()
const sourceLabel = comGrid
  ? 'open Excel workbook (Contract Expiry Tracker)'
  : fileOverride || defaultFile
const grid = comGrid || readRowsFromFile(fileOverride || defaultFile)
const trackerRows = extractTrackerRows(grid)
console.log(`Source: ${sourceLabel}`)
console.log(`Tracker employee rows: ${trackerRows.length}`)

const get = await fetch(`${apiBase}/api/state`)
if (!get.ok) {
  throw new Error(`GET failed ${get.status} ${await get.text()}`)
}
const state = await get.json()
const employees = Array.isArray(state.employees) ? [...state.employees] : []
const byId = new Map(employees.map((e) => [String(e.id), e]))

const changes = []
const missing = []
const errors = []
const unchanged = []

for (const row of trackerRows) {
  if (row.error) {
    errors.push(row)
    continue
  }
  const employee = byId.get(row.id)
  if (!employee) {
    missing.push(row)
    continue
  }
  const nextStart = row.contractStartDate
  const nextEnd = row.contractEndDate
  const prevStart = String(employee.contractStartDate ?? '').trim()
  const prevEndRaw = String(employee.contractEndDate ?? '').trim()
  const prevEnd = /^n\/?a$/i.test(prevEndRaw) ? '' : prevEndRaw
  if (prevStart === nextStart && prevEnd === nextEnd) {
    unchanged.push(row.id)
    continue
  }
  changes.push({
    id: row.id,
    name: employee.name,
    from: { start: prevStart || '—', end: prevEnd || '—' },
    to: { start: nextStart || '—', end: nextEnd || '—' },
  })
  Object.assign(employee, {
    contractStartDate: nextStart,
    contractEndDate: nextEnd,
  })
}

console.log(`\nChanges: ${changes.length}`)
for (const change of changes) {
  console.log(
    `  ${change.id} ${change.name}: ${change.from.start}→${change.to.start} , ${change.from.end}→${change.to.end}`,
  )
}
if (missing.length) {
  console.log(`\nMissing in app (${missing.length}):`)
  for (const row of missing) {
    console.log(`  ${row.id} ${row.name}`)
  }
}
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`)
  for (const row of errors) {
    console.log(`  ${row.id} ${row.name}: ${row.error}`)
  }
}
console.log(`Unchanged: ${unchanged.length}`)

if (dryRun || changes.length === 0) {
  console.log(dryRun ? '\n[dry-run] No write performed.' : '\nNothing to update.')
  process.exit(0)
}

const { _meta, ...data } = state
const payload = {
  ...data,
  employees,
  _meta: {
    expectedUpdatedAt: _meta?.updatedAt ?? null,
    changeSource: 'sync-contract-dates',
  },
}

const put = await fetch(`${apiBase}/api/state`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
if (!put.ok) {
  throw new Error(`PUT failed ${put.status} ${await put.text()}`)
}
const result = await put.json()
console.log(`\nUpdated live app state at ${result?.updatedAt ?? ''}`)
