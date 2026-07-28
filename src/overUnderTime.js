import { isPayrollParticipant } from './employeePay.js'
import { getPayPeriodForDate } from './payPeriods.js'

export const OVER_UNDER_TIME_TYPES = [
  { value: 'overtime', label: 'Overtime' },
  { value: 'undertime', label: 'Undertime' },
]

export const HOURS_PER_DAY = 8
export const OVERTIME_MULTIPLIER = 1.5
export const WORKING_DAYS_PER_MONTH = 22

export function getOverUnderTimeTypeLabel(adjustmentType) {
  return OVER_UNDER_TIME_TYPES.find((item) => item.value === adjustmentType)?.label ?? adjustmentType
}

export function formatHours(value) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function nextOverUnderTimeRecordId(records) {
  const maxNumber = (records ?? []).reduce((max, record) => {
    const digits = Number(String(record.id ?? '').replace(/\D/g, ''))
    return Number.isFinite(digits) ? Math.max(max, digits) : max
  }, 0)
  return `out-${maxNumber + 1}`
}

export function buildOverUnderTimeRecord(input) {
  const hours = Number(input.hours)
  return {
    id: input.id,
    employeeId: input.employeeId,
    adjustmentType: input.adjustmentType,
    hours: Number.isFinite(hours) ? hours : 0,
    date: input.date,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    recordedById: input.recordedById ?? null,
  }
}

export function sumOverUnderTimeHoursForEmployee(
  records,
  employeeId,
  adjustmentType,
  fromDate,
  toDate,
) {
  if (!fromDate || !toDate || fromDate > toDate) {
    return 0
  }
  return (records ?? [])
    .filter(
      (record) =>
        record.employeeId === employeeId &&
        record.adjustmentType === adjustmentType &&
        record.date >= fromDate &&
        record.date <= toDate,
    )
    .reduce((sum, record) => sum + (Number(record.hours) || 0), 0)
}

export function summarizeOverUnderTimeForEmployee(records, employeeId, fromDate, toDate) {
  return {
    overtime: sumOverUnderTimeHoursForEmployee(
      records,
      employeeId,
      'overtime',
      fromDate,
      toDate,
    ),
    undertime: sumOverUnderTimeHoursForEmployee(
      records,
      employeeId,
      'undertime',
      fromDate,
      toDate,
    ),
  }
}

export function getOverUnderTimePayrollSection(employee) {
  if (!isPayrollParticipant(employee)) {
    return null
  }
  if (employee?.contractType === 'seasonal' || employee?.contractType === 'supplementary') {
    return 'wages'
  }
  if (employee?.contractType === 'regular' && Number(employee?.monthlySalaryKes) > 0) {
    return 'salaries'
  }
  return null
}

function isPayrollSectionApprovedLocal(payrollApprovals, periodId, section) {
  const periodApprovals = payrollApprovals?.[periodId]
  if (!periodApprovals || typeof periodApprovals !== 'object') {
    return false
  }
  // Legacy: one approval covered all sections
  if (periodApprovals.status === 'approved' && !periodApprovals.advances) {
    return true
  }
  return periodApprovals[section]?.status === 'approved'
}

/**
 * OT/UT entries that fall in an approved wages or salaries period cannot be changed.
 */
export function isOverUnderTimeRecordLocked(record, employee, payrollApprovals) {
  if (!record?.date || !employee) {
    return false
  }
  const section = getOverUnderTimePayrollSection(employee)
  if (!section) {
    return false
  }
  const period = getPayPeriodForDate(record.date)
  if (!period) {
    return false
  }
  return isPayrollSectionApprovedLocal(payrollApprovals, period.id, section)
}

export function getOverUnderTimeLockMessage(record, employee, payrollApprovals) {
  if (!isOverUnderTimeRecordLocked(record, employee, payrollApprovals)) {
    return ''
  }
  const section = getOverUnderTimePayrollSection(employee)
  const period = getPayPeriodForDate(record.date)
  const sectionLabel = section === 'wages' ? 'wages' : 'salaries'
  return `This entry is locked because ${sectionLabel} payroll for ${period?.label ?? 'this period'} has been approved.`
}

export function calculateOvertimePay(hours, hourlyRate) {
  return Math.round((Number(hours) || 0) * hourlyRate * OVERTIME_MULTIPLIER)
}

export function calculateUndertimeDeduction(hours, hourlyRate) {
  return Math.round((Number(hours) || 0) * hourlyRate)
}

export function getSalariedHourlyRateKes(monthlySalaryKes) {
  const monthly = Number(monthlySalaryKes) || 0
  if (monthly <= 0) {
    return 0
  }
  return monthly / WORKING_DAYS_PER_MONTH / HOURS_PER_DAY
}
