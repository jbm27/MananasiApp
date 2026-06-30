import { toKenyaDateString } from './kenyaTime.js'

export const LEAVE_TYPES = [
  { value: 'annual', label: 'Annual leave' },
  { value: 'sick', label: 'Sick leave' },
  { value: 'compassionate', label: 'Compassionate leave' },
  { value: 'unpaid', label: 'Unpaid leave' },
]

export const SICK_LEAVE_DAYS_PER_YEAR = 10.5
export const COMPASSIONATE_LEAVE_DAYS_PER_YEAR = 5

export function getLeaveTypeLabel(leaveType) {
  return LEAVE_TYPES.find((item) => item.value === leaveType)?.label ?? leaveType
}

export function formatLeaveDays(value) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function publicHolidayDateSet(publicHolidays) {
  return new Set(
    (publicHolidays ?? [])
      .map((holiday) => holiday.date)
      .filter(Boolean),
  )
}

export function isWorkingDay(dateStr, publicHolidays = []) {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  if (day === 0) {
    return false
  }
  return !publicHolidayDateSet(publicHolidays).has(dateStr)
}

export function countLeaveDays(startDate, endDate, publicHolidays = []) {
  if (!startDate || !endDate || startDate > endDate) {
    return 0
  }
  let count = 0
  const cursor = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10)
    if (isWorkingDay(dateStr, publicHolidays)) {
      count += 1
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

export function countWorkingDaysInRange(fromDate, toDate, publicHolidays = []) {
  return countLeaveDays(fromDate, toDate, publicHolidays)
}

export function parseContractEndDate(endDate) {
  const raw = String(endDate ?? '').trim()
  if (!raw || raw === 'N/A') {
    return null
  }
  return raw
}

export function contractDurationDays(startDate, endDate) {
  const parsedEnd = parseContractEndDate(endDate)
  if (!startDate || !parsedEnd || startDate > parsedEnd) {
    return 0
  }
  const start = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${parsedEnd}T12:00:00`)
  return Math.floor((end - start) / 86400000) + 1
}

export function proRataAnnualEntitlement(annualDays, contractStart, contractEnd) {
  const parsedAnnual = Number(annualDays)
  if (!Number.isFinite(parsedAnnual) || parsedAnnual < 0) {
    return null
  }
  const contractDays = contractDurationDays(contractStart, contractEnd)
  if (!contractStart || contractDays <= 0) {
    return null
  }
  const fraction = Math.min(1, contractDays / 365)
  return Math.round(parsedAnnual * fraction * 10) / 10
}

export function getSickLeaveEntitlement(contractStart, contractEnd) {
  return proRataAnnualEntitlement(SICK_LEAVE_DAYS_PER_YEAR, contractStart, contractEnd)
}

export function getCompassionateLeaveEntitlement(contractStart, contractEnd) {
  return proRataAnnualEntitlement(COMPASSIONATE_LEAVE_DAYS_PER_YEAR, contractStart, contractEnd)
}

export function getAnnualLeaveEntitlement(employee) {
  if (employee?.annualLeaveDaysPerYear == null || employee.annualLeaveDaysPerYear === '') {
    return null
  }
  return proRataAnnualEntitlement(
    employee.annualLeaveDaysPerYear,
    employee.contractStartDate,
    employee.contractEndDate,
  )
}

function overlapDateRange(recordStart, recordEnd, filterStart, filterEnd) {
  const start = recordStart > filterStart ? recordStart : filterStart
  const end = recordEnd < filterEnd ? recordEnd : filterEnd
  if (start > end) {
    return null
  }
  return { start, end }
}

export function sumLeaveDaysForEmployee(
  leaveRecords,
  employeeId,
  leaveType,
  fromDate,
  toDate,
  publicHolidays = [],
) {
  return (leaveRecords ?? [])
    .filter((record) => record.employeeId === employeeId && record.leaveType === leaveType)
    .reduce((sum, record) => {
      const overlap = overlapDateRange(record.startDate, record.endDate, fromDate, toDate)
      if (!overlap) {
        return sum
      }
      return sum + countLeaveDays(overlap.start, overlap.end, publicHolidays)
    }, 0)
}

export function summarizeLeaveForEmployee(
  leaveRecords,
  employeeId,
  fromDate,
  toDate,
  publicHolidays = [],
) {
  return {
    annual: sumLeaveDaysForEmployee(leaveRecords, employeeId, 'annual', fromDate, toDate, publicHolidays),
    sick: sumLeaveDaysForEmployee(leaveRecords, employeeId, 'sick', fromDate, toDate, publicHolidays),
    compassionate: sumLeaveDaysForEmployee(
      leaveRecords,
      employeeId,
      'compassionate',
      fromDate,
      toDate,
      publicHolidays,
    ),
    unpaid: sumLeaveDaysForEmployee(leaveRecords, employeeId, 'unpaid', fromDate, toDate, publicHolidays),
  }
}

export function getLeaveSummaryPeriod(
  employee,
  filterMode,
  periodFrom,
  periodTo,
  referenceDate = toKenyaDateString(new Date()),
) {
  if (filterMode === 'contract-term') {
    const contractStart = employee.contractStartDate
    const contractEnd = parseContractEndDate(employee.contractEndDate)
    if (!contractStart) {
      return null
    }
    const cappedTo = [periodTo, referenceDate, contractEnd].filter(Boolean).sort()[0]
    if (!cappedTo || contractStart > cappedTo) {
      return null
    }
    return { from: contractStart, to: cappedTo }
  }
  if (!periodFrom || !periodTo || periodFrom > periodTo) {
    return null
  }
  return { from: periodFrom, to: periodTo }
}

export function countWorkingDaysRemainingOnContract(
  contractEndDate,
  publicHolidays = [],
  referenceDate = toKenyaDateString(new Date()),
) {
  const contractEnd = parseContractEndDate(contractEndDate)
  if (!contractEnd) {
    return null
  }
  if (contractEnd < referenceDate) {
    return 0
  }
  return countWorkingDaysInRange(referenceDate, contractEnd, publicHolidays)
}

export function nextLeaveRecordId(leaveRecords) {
  const maxNumber = (leaveRecords ?? []).reduce((max, record) => {
    const digits = Number(String(record.id ?? '').replace(/\D/g, ''))
    return Number.isFinite(digits) ? Math.max(max, digits) : max
  }, 0)
  return `leave-${maxNumber + 1}`
}

export function nextPublicHolidayId(publicHolidays) {
  const maxNumber = (publicHolidays ?? []).reduce((max, holiday) => {
    const digits = Number(String(holiday.id ?? '').replace(/\D/g, ''))
    return Number.isFinite(digits) ? Math.max(max, digits) : max
  }, 0)
  return `holiday-${maxNumber + 1}`
}

export function buildLeaveRecord(input, publicHolidays = []) {
  const days = countLeaveDays(input.startDate, input.endDate, publicHolidays)
  return {
    id: input.id,
    employeeId: input.employeeId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    recordedById: input.recordedById ?? null,
  }
}
