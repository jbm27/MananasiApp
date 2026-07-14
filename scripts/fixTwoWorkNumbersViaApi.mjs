#!/usr/bin/env node
/**
 * Remap clock-in work numbers via the live Railway API:
 *   5068 Brian Mwinami Nyangule -> 0104
 *   5069 Grainton Pamba Ameyo   -> 0105
 *
 * Also cleans up the case where both old and new IDs temporarily exist.
 *
 * Usage:
 *   node scripts/fixTwoWorkNumbersViaApi.mjs
 *   node scripts/fixTwoWorkNumbersViaApi.mjs --dry-run
 *   node scripts/fixTwoWorkNumbersViaApi.mjs --api https://mananasiappproduction.up.railway.app
 */
import { remapEmployeeIdsInAppState } from '../src/employeeIdMigration.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const apiIdx = args.indexOf('--api')
const apiBase = (apiIdx >= 0 ? args[apiIdx + 1] : null) || 'https://mananasiappproduction.up.railway.app'

const RENAMES = [
  {
    oldId: '5068',
    newId: '0104',
    namePattern: /brian.*nyangule/i,
    label: 'Brian Mwinami Nyangule',
  },
  {
    oldId: '5069',
    newId: '0105',
    namePattern: /(?:grainton|graiton|graiston).*pamba/i,
    label: 'Grainton Pamba Ameyo',
  },
]

const get = await fetch(`${apiBase}/api/state`)
if (!get.ok) {
  throw new Error(`GET failed ${get.status} ${await get.text()}`)
}
const state = await get.json()
const employees = Array.isArray(state.employees) ? state.employees : []
const pending = new Map()
const tombstoneIds = new Set()

for (const rename of RENAMES) {
  const oldEmployee = employees.find((item) => String(item.id) === rename.oldId)
  const newEmployee = employees.find((item) => String(item.id) === rename.newId)

  if (oldEmployee && !rename.namePattern.test(oldEmployee.name ?? '')) {
    throw new Error(`Refusing remap ${rename.oldId}: unexpected name "${oldEmployee.name}"`)
  }
  if (newEmployee && !rename.namePattern.test(newEmployee.name ?? '')) {
    throw new Error(
      `Cannot use ${rename.newId}: already used by unexpected employee "${newEmployee.name}"`,
    )
  }

  if (oldEmployee && newEmployee) {
    console.log(
      `Both ${rename.oldId} and ${rename.newId} exist for ${rename.label}; will keep ${rename.newId} and remove ${rename.oldId}`,
    )
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

  console.log(`WARN: neither ${rename.oldId} nor ${rename.newId} found for ${rename.label}`)
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

if (dryRun) {
  const preview = (nextData.employees || [])
    .filter((e) => ['0104', '0105', '5068', '5069'].includes(String(e.id)))
    .map((e) => ({ id: e.id, name: e.name }))
  console.log('\n[dry-run] Preview after remap:', preview)
  console.log('[dry-run] Would tombstone employees:', Array.from(tombstoneIds))
  process.exit(0)
}

const payload = {
  ...nextData,
  _meta: {
    expectedUpdatedAt: _meta?.updatedAt ?? null,
    changeSource: 'fix-two-work-numbers',
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
console.log('\nUpdated live app state.', result?.updatedAt ?? '')

const verify = await fetch(`${apiBase}/api/state`)
const verified = await verify.json()
const hits = (verified.employees || [])
  .filter(
    (e) =>
      ['0104', '0105', '5068', '5069'].includes(String(e.id)) ||
      /nyangule|pamba ameyo/i.test(e.name || ''),
  )
  .map((e) => ({ id: e.id, name: e.name }))
console.log('Verified employees:', hits)
console.log(
  'Tombstoned employee ids:',
  verified.deletedEntityIds?.employees?.filter((id) => ['5068', '5069'].includes(String(id))) ?? [],
)
