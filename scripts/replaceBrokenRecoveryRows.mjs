import { calculateHarvestWage } from '../src/employeePay.js'

const API_BASE = 'https://mananasiappproduction.up.railway.app'

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${url} failed (${response.status}): ${body?.error ?? text}`)
  }
  return body
}

function getKg(record) {
  const value = Number(record?.kg ?? record?.kgHarvested ?? record?.leafMassKg ?? 0)
  return Number.isFinite(value) ? value : 0
}

function isBrokenRecovery(record) {
  if (!record || typeof record !== 'object') return false
  if (!String(record.id ?? '').startsWith('RECOVERY-')) return false
  const base = Number(record.baseWageKes)
  return !Number.isFinite(base) || base <= 0
}

async function main() {
  const state = await fetchJson(`${API_BASE}/api/state`)
  const records = Array.isArray(state.records) ? state.records : []
  const employees = Array.isArray(state.employees) ? state.employees : []
  const employeeById = new Map(employees.map((employee) => [String(employee.id), employee]))
  const compensationRules =
    state.compensationRules && typeof state.compensationRules === 'object' ? state.compensationRules : {}

  const brokenRows = records.filter(isBrokenRecovery)
  if (brokenRows.length === 0) {
    console.log('No broken recovery rows found.')
    return
  }

  const now = Date.now()
  const replacementRows = []
  const deletedIds = []
  let skippedRows = 0

  for (let index = 0; index < brokenRows.length; index += 1) {
    const row = brokenRows[index]
    const employee = employeeById.get(String(row.harvesterId ?? ''))
    if (!employee) {
      skippedRows += 1
      continue
    }
    const kg = getKg(row)
    const harvestedOn = String(row.harvestedOn ?? '')
    const wage = calculateHarvestWage(kg, employee, compensationRules, { workDate: harvestedOn })
    const replacementId = `RECOVERY-WAGEFIX-${row.harvesterId}-${harvestedOn}-${now}-${index + 1}`
    replacementRows.push({
      ...row,
      id: replacementId,
      baseWageKes: Number(wage.baseWageKes) || 0,
      incentiveKes: Number(wage.incentiveKes) || 0,
      wageKes: Number(wage.wageKes) || 0,
    })
    deletedIds.push(String(row.id))
  }

  const deletedEntityIds =
    state.deletedEntityIds && typeof state.deletedEntityIds === 'object' ? { ...state.deletedEntityIds } : {}
  const deletedRecordIds = new Set(
    Array.isArray(deletedEntityIds.records) ? deletedEntityIds.records.map(String) : [],
  )
  deletedIds.forEach((id) => deletedRecordIds.add(id))
  deletedEntityIds.records = Array.from(deletedRecordIds)

  const removeSet = new Set(deletedIds)
  const nextRecords = [...records.filter((record) => !removeSet.has(String(record.id ?? ''))), ...replacementRows]

  await fetchJson(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      records: nextRecords,
      deletedEntityIds,
      _meta: {
        ...(state?._meta ?? {}),
        expectedUpdatedAt: state?._meta?.updatedAt ?? null,
        changeSource: 'replace-broken-recovery-rows',
      },
    }),
  })

  const verify = await fetchJson(`${API_BASE}/api/state`)
  const july7 = (verify.records ?? []).filter((record) => record.harvestedOn === '2026-07-07')
  const july7Base = july7.reduce((sum, record) => sum + Number(record.baseWageKes ?? 0), 0)
  const july7Incentive = july7.reduce((sum, record) => sum + Number(record.incentiveKes ?? 0), 0)
  const july7ZeroRows = july7.filter(
    (record) => Number(record.baseWageKes ?? 0) === 0 && Number(record.incentiveKes ?? 0) === 0,
  ).length

  console.log(
    JSON.stringify(
      {
        brokenRowsFound: brokenRows.length,
        replacedRows: replacementRows.length,
        skippedRows,
        july7: {
          records: july7.length,
          baseWageKes: july7Base,
          incentiveKes: july7Incentive,
          zeroWageRows: july7ZeroRows,
        },
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
