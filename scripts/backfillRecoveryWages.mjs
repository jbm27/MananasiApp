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
  const kg = Number(record?.kg ?? record?.kgHarvested ?? record?.leafMassKg ?? 0)
  return Number.isFinite(kg) ? kg : 0
}

function needsWageBackfill(record) {
  if (!record || typeof record !== 'object') return false
  if (!String(record.id ?? '').startsWith('RECOVERY-')) return false
  const baseWageKes = Number(record.baseWageKes)
  const hasBaseWage = Number.isFinite(baseWageKes) && baseWageKes > 0
  return !hasBaseWage
}

async function main() {
  const state = await fetchJson(`${API_BASE}/api/state`)
  const employees = Array.isArray(state.employees) ? state.employees : []
  const employeeById = new Map(employees.map((employee) => [String(employee.id), employee]))
  const compensationRules =
    state.compensationRules && typeof state.compensationRules === 'object' ? state.compensationRules : {}

  const records = Array.isArray(state.records) ? state.records : []
  let updatedCount = 0
  let updatedJuly7 = 0

  const nextRecords = records.map((record) => {
    if (!needsWageBackfill(record)) {
      return record
    }

    const employee = employeeById.get(String(record.harvesterId ?? ''))
    if (!employee) {
      return record
    }

    const kg = getKg(record)
    const harvestedOn = String(record.harvestedOn ?? '')
    const wage = calculateHarvestWage(kg, employee, compensationRules, { workDate: harvestedOn })
    updatedCount += 1
    if (harvestedOn === '2026-07-07') {
      updatedJuly7 += 1
    }

    return {
      ...record,
      baseWageKes: Number(wage.baseWageKes) || 0,
      incentiveKes: Number(wage.incentiveKes) || 0,
      wageKes: Number(wage.wageKes) || 0,
    }
  })

  if (updatedCount === 0) {
    console.log('No RECOVERY rows needed wage backfill.')
    return
  }

  const payload = {
    records: nextRecords,
    _meta: {
      ...(state?._meta ?? {}),
      expectedUpdatedAt: state?._meta?.updatedAt ?? null,
      changeSource: 'backfill-recovery-wages',
    },
  }

  await fetchJson(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const verify = await fetchJson(`${API_BASE}/api/state`)
  const july7 = (verify.records ?? []).filter((record) => record.harvestedOn === '2026-07-07')
  const july7Base = july7.reduce((sum, record) => sum + Number(record.baseWageKes ?? 0), 0)
  const july7Incentive = july7.reduce((sum, record) => sum + Number(record.incentiveKes ?? 0), 0)

  console.log(
    JSON.stringify(
      {
        updatedCount,
        updatedJuly7,
        july7: {
          records: july7.length,
          baseWageKes: july7Base,
          incentiveKes: july7Incentive,
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
