import { toKenyaDateString } from './kenyaTime.js'

const WORKING_DAYS_PER_MONTH = 22

export const DAILY_WAGE_RATE_KEYS = [
  'seasonalHarvester',
  'supplementaryHarvester',
  'seasonalFactory',
  'supplementaryFactory',
  'supervisor',
  'supplementaryDriver',
]

export const DAILY_WAGE_RATE_LABELS = {
  seasonalHarvester: 'Seasonal harvester',
  supplementaryHarvester: 'Supplementary harvester',
  seasonalFactory: 'Seasonal factory worker',
  supplementaryFactory: 'Supplementary factory worker',
  supervisor: 'Supervisor (harvesting or factory)',
  supplementaryDriver: 'Supplementary driver',
}

export function createDefaultDailyWageRates() {
  return {
    seasonalHarvester: 550,
    supplementaryHarvester: 530,
    seasonalFactory: 732,
    supplementaryFactory: 712,
    supervisor: 807,
    supplementaryDriver: 1000,
  }
}

export function normalizeDailyWageRates(rates) {
  const defaults = createDefaultDailyWageRates()
  const next = { ...defaults }
  if (rates && typeof rates === 'object') {
    DAILY_WAGE_RATE_KEYS.forEach((key) => {
      const value = Number(rates[key])
      if (Number.isFinite(value) && value > 0) {
        next[key] = Math.round(value)
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

export function isDriverRole(role) {
  return role === 'truck-driver'
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
  if (isSupervisorRole(role)) {
    return rates.supervisor
  }
  if (isHarvesterRole(role)) {
    return contractType === 'seasonal' ? rates.seasonalHarvester : rates.supplementaryHarvester
  }
  if (isDriverRole(role) && contractType === 'supplementary') {
    return rates.supplementaryDriver
  }
  return contractType === 'seasonal' ? rates.seasonalFactory : rates.supplementaryFactory
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
  const rate = getRuleBasedDailyWageKes(employee, role, dailyWageRates)
  if (rate === null) {
    return optionLabel
  }
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
