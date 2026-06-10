const WORKING_DAYS_PER_MONTH = 22

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

export function getEmployeeDailyWageKes(employee) {
  const dailyWage = Number(employee?.dailyWageKes)
  if (Number.isFinite(dailyWage) && dailyWage > 0) {
    return dailyWage
  }

  const monthlySalary = Number(employee?.monthlySalaryKes)
  if (employee?.contractType === 'regular' && Number.isFinite(monthlySalary) && monthlySalary > 0) {
    return Math.round(monthlySalary / WORKING_DAYS_PER_MONTH)
  }

  return 0
}

export function calculateHarvestWage(kg, employee, compensationRules) {
  const threshold = Number(compensationRules?.incentiveThresholdKg ?? 250)
  const incentiveRate = Number(compensationRules?.incentiveRateKesPerKg ?? 0)
  const baseWageKes = getEmployeeDailyWageKes(employee)
  const incentiveKg = Math.max(0, Number(kg) - threshold)
  const incentiveKes = incentiveKg * incentiveRate

  return {
    baseWageKes,
    incentiveKes,
    wageKes: baseWageKes + incentiveKes,
  }
}
