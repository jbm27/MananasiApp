import { toKenyaDateString } from './kenyaTime.js'
import { normalizeEmployeeName } from './employeeWorkNumberAssignments.js'

export const CONTRACT_TYPE_OPTIONS = [
  { value: 'regular', label: 'Regular' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'supplementary', label: 'Supplementary' },
]

export const SEASONAL_GRADE_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'grade-1', label: 'Grade 1' },
  { value: 'grade-2', label: 'Grade 2' },
  { value: 'grade-3', label: 'Grade 3' },
]

export function createEmptyEmployeeDetails() {
  return {
    dateOfBirth: '',
    dateOfJoining: '',
    gender: '',
    nationality: '',
    bankBranch: '',
    highestQualification: '',
    relevantQualification: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactNumber: '',
  }
}

export function createBlankEmployeeTemplate(id, role = 'harvester') {
  return {
    id,
    name: '',
    role,
    contractType: 'seasonal',
    seasonalGrade: null,
    roleHistory: [{ effectiveDate: toKenyaDateString(new Date()), role }],
    monthlySalaryKes: null,
    position: '',
    department: '',
    phone: '',
    email: '',
    idNumber: '',
    nssfNumber: '',
    pinNumber: '',
    bankName: '',
    bankAccountNumber: '',
    contractStartDate: '',
    contractEndDate: '',
    annualLeaveDaysPerYear: null,
    reportingManager: '',
    ...createEmptyEmployeeDetails(),
  }
}

export function employeeRecordsNeedSeedMerge(employees) {
  if (!Array.isArray(employees) || employees.length === 0) {
    return true
  }
  if (employees.some((employee) => String(employee.id).startsWith('EMP-'))) {
    return true
  }
  return employees.some((employee) => !('dateOfBirth' in employee) || !('bankBranch' in employee))
}

export function mergeEmployeesWithSeed(storedEmployees, seedEmployees) {
  const seedById = new Map(seedEmployees.map((employee) => [employee.id, employee]))
  const seedByName = new Map(
    seedEmployees.map((employee) => [normalizeEmployeeName(employee.name), employee]),
  )
  const mergedNames = new Set()
  const merged = storedEmployees.map((employee) => {
    const seed =
      seedById.get(employee.id) ?? seedByName.get(normalizeEmployeeName(employee.name)) ?? null
    if (!seed) {
      return { ...createEmptyEmployeeDetails(), ...employee }
    }
    mergedNames.add(normalizeEmployeeName(seed.name))
    const next = { ...seed }
    for (const [key, value] of Object.entries(employee)) {
      if (key === 'id') {
        continue
      }
      if (value !== undefined && value !== null && value !== '') {
        next[key] = value
      }
    }
    if (employee.role) {
      next.role = employee.role
    }
    next.id = seed.id
    return next
  })

  for (const seed of seedEmployees) {
    if (
      merged.some((employee) => employee.id === seed.id) ||
      mergedNames.has(normalizeEmployeeName(seed.name))
    ) {
      continue
    }
    merged.push(seed)
  }

  return merged.sort(compareEmployeeWorkNumbers)
}

function parseOptionalNumber(value) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return null
  }
  const parsed = Number(raw.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function parseEmployeeProfileFromForm(formData) {
  const contractType = String(formData.get('contractType') ?? 'regular').trim() || 'regular'
  const seasonalGradeRaw = String(formData.get('seasonalGrade') ?? '').trim()
  const roleRaw = String(formData.get('profileRole') ?? '').trim()

  return {
    ...(roleRaw ? { role: roleRaw } : {}),
    name: String(formData.get('profileName') ?? '').trim(),
    position: String(formData.get('profilePosition') ?? '').trim(),
    department: String(formData.get('profileDepartment') ?? '').trim(),
    dateOfBirth: String(formData.get('profileDateOfBirth') ?? '').trim(),
    dateOfJoining: String(formData.get('profileDateOfJoining') ?? '').trim(),
    gender: String(formData.get('profileGender') ?? '').trim(),
    nationality: String(formData.get('profileNationality') ?? '').trim(),
    phone: String(formData.get('profilePhone') ?? '').trim(),
    email: String(formData.get('profileEmail') ?? '').trim(),
    contractType,
    seasonalGrade: contractType === 'seasonal' && seasonalGradeRaw ? seasonalGradeRaw : null,
    monthlySalaryKes:
      contractType === 'regular' ? parseOptionalNumber(formData.get('monthlySalaryKes')) : null,
    contractStartDate: String(formData.get('profileContractStartDate') ?? '').trim(),
    contractEndDate: String(formData.get('profileContractEndDate') ?? '').trim(),
    annualLeaveDaysPerYear: parseOptionalNumber(formData.get('annualLeaveDaysPerYear')),
    reportingManager: String(formData.get('profileReportingManager') ?? '').trim(),
    idNumber: String(formData.get('profileIdNumber') ?? '').trim(),
    nssfNumber: String(formData.get('profileNssfNumber') ?? '').trim(),
    pinNumber: String(formData.get('profilePinNumber') ?? '').trim(),
    bankName: String(formData.get('profileBankName') ?? '').trim(),
    bankBranch: String(formData.get('profileBankBranch') ?? '').trim(),
    bankAccountNumber: String(formData.get('profileBankAccountNumber') ?? '').trim(),
    highestQualification: String(formData.get('profileHighestQualification') ?? '').trim(),
    relevantQualification: String(formData.get('profileRelevantQualification') ?? '').trim(),
    emergencyContactName: String(formData.get('profileEmergencyContactName') ?? '').trim(),
    emergencyContactRelation: String(formData.get('profileEmergencyContactRelation') ?? '').trim(),
    emergencyContactNumber: String(formData.get('profileEmergencyContactNumber') ?? '').trim(),
  }
}

export function formatEmployeeFieldValue(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not set'
  }
  return String(value)
}

/** Sort by full name (first name first) for employee lists and dropdowns. */
export function compareEmployeesByName(a, b) {
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, {
    sensitivity: 'base',
  })
}

export function sortEmployeesByName(employees) {
  return [...(employees ?? [])].sort(compareEmployeesByName)
}

/** Regular staff work numbers are 0001, 0002, … Director numbers use D001, D002, … */
export function isRegularWorkNumber(id) {
  const raw = String(id ?? '').trim()
  if (!/^\d{4}$/.test(raw)) {
    return false
  }
  const num = Number(raw)
  // Official staff series is 0001–0999. Ignore legacy/out-of-series stubs (2xxx, 5xxx, …).
  return Number.isFinite(num) && num >= 1 && num < 1000
}

export function isDirectorWorkNumber(id) {
  return /^D\d{3}$/i.test(String(id ?? '').trim())
}

/**
 * Next regular employee work number (0001–9999 series).
 * Floors at 0106 so numbering continues after the current staff list.
 */
export function nextEmployeeWorkNumber(employees, { minimumNext = 106 } = {}) {
  const maxNumber = (employees ?? []).reduce((max, employee) => {
    if (!isRegularWorkNumber(employee?.id)) {
      return max
    }
    return Math.max(max, Number(employee.id))
  }, minimumNext - 1)
  return String(maxNumber + 1).padStart(4, '0')
}

export function nextDirectorWorkNumber(employees) {
  const maxNumber = (employees ?? []).reduce((max, employee) => {
    const match = String(employee?.id ?? '')
      .trim()
      .match(/^D(\d+)$/i)
    if (!match) {
      return max
    }
    return Math.max(max, Number(match[1]))
  }, 0)
  return `D${String(maxNumber + 1).padStart(3, '0')}`
}

export function compareEmployeeWorkNumbers(a, b) {
  const aId = String(a?.id ?? a ?? '')
  const bId = String(b?.id ?? b ?? '')
  const aDirector = isDirectorWorkNumber(aId)
  const bDirector = isDirectorWorkNumber(bId)
  if (aDirector !== bDirector) {
    return aDirector ? 1 : -1
  }
  if (aDirector && bDirector) {
    return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' })
  }
  if (isRegularWorkNumber(aId) && isRegularWorkNumber(bId)) {
    return Number(aId) - Number(bId)
  }
  return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' })
}
