#!/usr/bin/env node
/**
 * Cleanup live employee work numbers:
 * - Delete duplicate Tomas/Timothy stubs 5071/5072 (keep 0102/0103)
 * - Remap directors 1022–1026 → D001–D005
 *
 * Usage:
 *   node scripts/fixDirectorAndDuplicateIds.mjs
 *   node scripts/fixDirectorAndDuplicateIds.mjs --dry-run
 */
import { remapEmployeeIdsInAppState } from '../src/employeeIdMigration.js'
import { nextEmployeeWorkNumber } from '../src/employeeFields.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const apiIdx = args.indexOf('--api')
const apiBase =
  (apiIdx >= 0 ? args[apiIdx + 1] : null) || 'https://mananasiappproduction.up.railway.app'

const DIRECTOR_RENAMES = [
  { oldId: '1022', newId: 'D001', namePattern: /zeid/i, label: 'Zeid Shehadeh' },
  { oldId: '1024', newId: 'D002', namePattern: /riikka/i, label: 'Riikka Juva' },
  { oldId: '1025', newId: 'D003', namePattern: /raquel/i, label: 'Raquel Prado' },
  { oldId: '1023', newId: 'D004', namePattern: /zakariya/i, label: 'Zakariya Ali Musleh' },
  { oldId: '1026', newId: 'D005', namePattern: /zainab/i, label: 'Zainab Haquon' },
]

const DUPLICATE_REMOVALS = [
  { oldId: '5071', keepId: '0102', namePattern: /tomas.*akhonya|akhonya.*tomas/i, label: 'Tomas Jumbi Akhonya' },
  { oldId: '5072', keepId: '0103', namePattern: /timothy.*ndungu|ndungu.*timothy/i, label: 'Timothy Kamau Ndungu' },
]

const get = await fetch(`${apiBase}/api/state`)
if (!get.ok) {
  throw new Error(`GET failed ${get.status} ${await get.text()}`)
}
const state = await get.json()
const employees = Array.isArray(state.employees) ? state.employees : []
const pending = new Map()
const tombstoneIds = new Set()

for (const rename of DIRECTOR_RENAMES) {
  const oldEmployee = employees.find((item) => String(item.id) === rename.oldId)
  const newEmployee = employees.find((item) => String(item.id) === rename.newId)

  if (oldEmployee && !rename.namePattern.test(oldEmployee.name ?? '')) {
    throw new Error(`Refusing director remap ${rename.oldId}: unexpected name "${oldEmployee.name}"`)
  }
  if (newEmployee && !rename.namePattern.test(newEmployee.name ?? '')) {
    throw new Error(`Cannot use ${rename.newId}: already used by "${newEmployee.name}"`)
  }

  if (oldEmployee && newEmployee) {
    console.log(`Both ${rename.oldId} and ${rename.newId} exist; keep ${rename.newId}, remove ${rename.oldId}`)
    pending.set(rename.oldId, rename.newId)
    tombstoneIds.add(rename.oldId)
    continue
  }
  if (oldEmployee && !newEmployee) {
    console.log(`Will remap ${rename.oldId} -> ${rename.newId}  ${oldEmployee.name}`)
    pending.set(rename.oldId, rename.newId)
    tombstoneIds.add(rename.oldId)
    continue
  }
  if (!oldEmployee && newEmployee) {
    console.log(`OK: already remapped; ${rename.newId} is ${newEmployee.name}`)
    tombstoneIds.add(rename.oldId)
    continue
  }
  console.log(`WARN: director ${rename.label} not found as ${rename.oldId} or ${rename.newId}`)
}

for (const dup of DUPLICATE_REMOVALS) {
  const oldEmployee = employees.find((item) => String(item.id) === dup.oldId)
  const keepEmployee = employees.find((item) => String(item.id) === dup.keepId)

  if (oldEmployee && !dup.namePattern.test(oldEmployee.name ?? '')) {
    throw new Error(`Refusing delete ${dup.oldId}: unexpected name "${oldEmployee.name}"`)
  }
  if (!keepEmployee) {
    if (oldEmployee) {
      console.log(`Keep-id ${dup.keepId} missing; remapping ${dup.oldId} -> ${dup.keepId}`)
      pending.set(dup.oldId, dup.keepId)
      tombstoneIds.add(dup.oldId)
    } else {
      console.log(`WARN: neither ${dup.oldId} nor ${dup.keepId} found for ${dup.label}`)
    }
    continue
  }
  if (!dup.namePattern.test(keepEmployee.name ?? '')) {
    throw new Error(`Keep-id ${dup.keepId} unexpected name "${keepEmployee.name}"`)
  }
  if (oldEmployee) {
    console.log(
      `Will remove duplicate ${dup.oldId} (${oldEmployee.role}) and keep ${dup.keepId} (${keepEmployee.role}) for ${keepEmployee.name}`,
    )
    pending.set(dup.oldId, dup.keepId)
    tombstoneIds.add(dup.oldId)
  } else {
    console.log(`OK: duplicate ${dup.oldId} already gone; ${dup.keepId} is ${keepEmployee.name}`)
  }
}

if (pending.size === 0 && tombstoneIds.size === 0) {
  console.log('Nothing to change.')
  process.exit(0)
}

const { _meta, ...data } = state
const nextData = pending.size > 0 ? remapEmployeeIdsInAppState(data, pending) : { ...data }

const deletedEmployees = new Set([
  ...((nextData.deletedEntityIds?.employees ?? []).map(String)),
  ...tombstoneIds,
])
nextData.deletedEntityIds = {
  ...(nextData.deletedEntityIds ?? {}),
  employees: Array.from(deletedEmployees),
}

const byId = new Map()
for (const employee of nextData.employees ?? []) {
  const id = String(employee.id)
  if (tombstoneIds.has(id)) {
    continue
  }
  byId.set(id, employee)
}
nextData.employees = Array.from(byId.values())

const previewIds = [
  '0102',
  '0103',
  '5071',
  '5072',
  '1022',
  '1023',
  '1024',
  '1025',
  '1026',
  'D001',
  'D002',
  'D003',
  'D004',
  'D005',
]
const preview = (nextData.employees || [])
  .filter((e) => previewIds.includes(String(e.id)))
  .map((e) => ({ id: e.id, name: e.name, role: e.role }))
console.log('\nPreview employees:', preview)
console.log('Would tombstone:', Array.from(tombstoneIds).sort())
console.log('Next regular work number would be:', nextEmployeeWorkNumber(nextData.employees))

if (dryRun) {
  console.log('\n[dry-run] No write performed.')
  process.exit(0)
}

const payload = {
  ...nextData,
  _meta: {
    expectedUpdatedAt: _meta?.updatedAt ?? null,
    changeSource: 'fix-director-and-duplicate-ids',
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

const verify = await fetch(`${apiBase}/api/state`)
const verified = await verify.json()
const hits = (verified.employees || [])
  .filter((e) => previewIds.includes(String(e.id)) || /tomas|timothy|zeid|riikka|raquel|zakariya|zainab/i.test(e.name || ''))
  .map((e) => ({ id: e.id, name: e.name, role: e.role }))
console.log('Verified:', hits)
console.log('Next regular work number:', nextEmployeeWorkNumber(verified.employees || []))
