import { toKenyaDateString } from './kenyaTime.js'

const WORKING_DAYS_PER_MONTH = 22

export const DAILY_WAGE_RATE_KEYS = [
  'harvesting',
  'generalFactory',
  'machineAttendant',
  'supervisor',
]

export const DAILY_WAGE_RATE_LABELS = {
  harvesting: 'Harvesting',
  generalFactory: 'General factory labour',
  machineAttendant: 'Machine attendant',
  supervisor: 'Supervisor (factory or harvesting)',
}

export const DAILY_WAGE_RATE_APPLIES_TO = {
  harvesting: 'Harvester',
  generalFactory: 'Loader, dryer, driver, and any other wage role',
  machineAttendant: 'Decorticator, silage, brushing, and baling',
  supervisor: 'Harvesting and factory supervisors',
}

/** Older saved rates, used only when a current category has not been set yet. */
const LEGACY_DAILY_WAGE_RATE_KEYS = {
  harvesting: ['seasonalHarvester', 'supplementaryHarvester'],
  generalFactory: ['seasonalFactory', 'supplementaryFactory'],
  machineAttendant: ['seasonalFactory', 'supplementaryFactory'],
  supervisor: [],
}

/** Board directors use read-only app access and are excluded from all payroll runs. */
export function isPayrollParticipant(employee) {
  return employee?.role !== 'director'
}

export function createDefaultDailyWageRates() {
  return {
    harvesting: 550,
    generalFactory: 732,
    machineAttendant: 732,
    supervisor: 807,
  }
}

function readPositiveRate(rates, key) {
  const value = Number(rates?.[key])
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  return null
}

export function normalizeDailyWageRates(rates) {
  const defaults = createDefaultDailyWageRates()
  const next = { ...defaults }
  if (rates && typeof rates === 'object') {
    DAILY_WAGE_RATE_KEYS.forEach((key) => {
      const current = readPositiveRate(rates, key)
      if (current !== null) {
        next[key] = current
        return
      }
      for (const legacyKey of LEGACY_DAILY_WAGE_RATE_KEYS[key]) {
        const legacy = readPositiveRate(rates, legacyKey)
        if (legacy !== null) {
          next[key] = legacy
          break
        }
      }
    })
  }
  return next
}

export function getDailyWageRatesFromCompensation(compensationRules) {
  return normalizeDailyWageRates(compensationRules?.dailyWageRates)
}

export const SUPERVISOR_ROLES = new Set([
  'harvesting-supervisor',
  'decortication-supervisor',
  'brushing-supervisor',
  'baling-supervisor',
  'silage-supervisor',
])

export const MACHINE_ATTENDANT_ROLES = new Set([
  'decorticator-operator',
  'silage-operator',
  'brusher',
  'baler',
])

export const GENERAL_FACTORY_ROLES = new Set(['loader', 'dryer', 'truck-driver'])

export function normalizeContractType(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
  if (key.startsWith('regular')) {
    return 'regular'
  }
  if (key.startsWith('season')) {
    return 'seasonal'
  }
  if (key.startsWith('suppl')) {
    return 'supplementary'
  }
  return 'regular'
}

export function normalizeSeasonalGrade(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  if (key === 'grade1' || key === 'grade-1') {
    return 'grade-1'
  }
  if (key === 'grade2' || key === 'grade-2') {
    return 'grade-2'
  }
  if (key === 'grade3' || key === 'grade-3') {
    return 'grade-3'
  }
  return null
}

export function getContractTypeLabel(contractType) {
  if (contractType === 'seasonal') {
    return 'Seasonal'
  }
  if (contractType === 'supplementary') {
    return 'Supplementary'
  }
  return 'Regular'
}

export function getSeasonalGradeLabel(seasonalGrade) {
  if (seasonalGrade === 'grade-1') {
    return 'Grade 1'
  }
  if (seasonalGrade === 'grade-2') {
    return 'Grade 2'
  }
  if (seasonalGrade === 'grade-3') {
    return 'Grade 3'
  }
  return '—'
}

export function isSupervisorRole(role) {
  return SUPERVISOR_ROLES.has(role)
}

export function isHarvesterRole(role) {
  return role === 'harvester'
}

export function isMachineAttendantRole(role) {
  return MACHINE_ATTENDANT_ROLES.has(role)
}

/** Wage category for a role. Null means the role has no dedicated rate. */
export function getWageRateKeyForRole(role) {
  if (isSupervisorRole(role)) {
    return 'supervisor'
  }
  if (isHarvesterRole(role)) {
    return 'harvesting'
  }
  if (isMachineAttendantRole(role)) {
    return 'machineAttendant'
  }
  if (GENERAL_FACTORY_ROLES.has(role)) {
    return 'generalFactory'
  }
  return null
}

export function isWageContractEmployee(employee) {
  const contractType = normalizeContractType(employee?.contractType)
  return contractType === 'seasonal' || contractType === 'supplementary'
}

export function getRuleBasedDailyWageKes(
  employee,
  role = employee?.role,
  dailyWageRates = createDefaultDailyWageRates(),
) {
  const rates = normalizeDailyWageRates(dailyWageRates)
  const contractType = normalizeContractType(employee?.contractType)
  if (contractType === 'regular') {
    return null
  }
  return rates[getWageRateKeyForRole(role) ?? 'generalFactory']
}

export function getEmployeeRoleHistory(employee) {
  if (Array.isArray(employee?.roleHistory) && employee.roleHistory.length > 0) {
    return [...employee.roleHistory].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  }
  return [{ effectiveDate: '2000-01-01', role: employee?.role ?? 'harvester' }]
}

export function getEmployeeRoleOnDate(employee, date) {
  const history = getEmployeeRoleHistory(employee)
  let role = employee?.role ?? 'harvester'
  for (const entry of history) {
    if (entry.effectiveDate <= date) {
      role = entry.role
    } else {
      break
    }
  }
  return role
}

export function appendEmployeeRoleHistory(employee, role, effectiveDate = toKenyaDateString(new Date())) {
  const history = getEmployeeRoleHistory(employee)
  const nextHistory = [...history]
  const last = nextHistory[nextHistory.length - 1]
  if (last?.effectiveDate === effectiveDate) {
    nextHistory[nextHistory.length - 1] = { effectiveDate, role }
  } else {
    nextHistory.push({ effectiveDate, role })
  }
  return nextHistory
}

export function formatEmployeeRoleOptionLabel(
  optionLabel,
  employee,
  role,
  dailyWageRates = createDefaultDailyWageRates(),
) {
  if (!isWageContractEmployee(employee)) {
    return optionLabel
  }
  const rateKey = getWageRateKeyForRole(role)
  if (!rateKey) {
    return optionLabel
  }
  const rate = normalizeDailyWageRates(dailyWageRates)[rateKey]
  return `${optionLabel} — KES ${rate.toLocaleString()}/day`
}

export function getEmployeeDailyWageKes(employee, options = {}) {
  const role = options.role ?? employee?.role
  const dailyWageRates = options.dailyWageRates ?? createDefaultDailyWageRates()
  const ruleRate = getRuleBasedDailyWageKes(employee, role, dailyWageRates)
  if (ruleRate !== null && ruleRate > 0) {
    return ruleRate
  }

  const monthlySalary = Number(employee?.monthlySalaryKes)
  if (employee?.contractType === 'regular' && Number.isFinite(monthlySalary) && monthlySalary > 0) {
    return Math.round(monthlySalary / WORKING_DAYS_PER_MONTH)
  }

  return 0
}

export function sumAttendanceDailyPay(
  attendanceEvents,
  employee,
  fromDate,
  toDate,
  dailyWageRates = createDefaultDailyWageRates(),
) {
  const dates = new Set()
  attendanceEvents.forEach((event) => {
    if (event.employeeId !== employee.id || event.eventType !== 'clock_in') {
      return
    }
    const date = toKenyaDateString(event.occurredAt)
    if (date && date >= fromDate && date <= toDate) {
      dates.add(date)
    }
  })

  let total = 0
  dates.forEach((date) => {
    const role = getEmployeeRoleOnDate(employee, date)
    total += getEmployeeDailyWageKes(employee, { role, dailyWageRates })
  })
  return total
}

export function calculateHarvestWage(kg, employee, compensationRules, options = {}) {
  const workDate = options.workDate ?? toKenyaDateString(new Date())
  const role = getEmployeeRoleOnDate(employee, workDate)
  const dailyWageRates = getDailyWageRatesFromCompensation(compensationRules)
  const threshold = Number(compensationRules?.incentiveThresholdKg ?? 250)
  const incentiveRate = Number(compensationRules?.incentiveRateKesPerKg ?? 0)
  const baseWageKes = getEmployeeDailyWageKes(employee, { role, dailyWageRates })
  const incentiveKg = Math.max(0, Number(kg) - threshold)
  const incentiveKes = incentiveKg * incentiveRate

  return {
    baseWageKes,
    incentiveKes,
    wageKes: baseWageKes + incentiveKes,
  }
}
