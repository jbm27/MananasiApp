import { getEmployeeDailyWageKes } from './employeePay.js'
import { toKenyaDateString } from './kenyaTime.js'
import { calculateMaxAdvanceClaimable } from './payrollAdvances.js'

const HOURS_PER_DAY = 8
const SHA_RATE = 0.0275
const SHA_MINIMUM_KES = 300
const NSSF_RATE = 0.06
const AHL_RATE = 0.015
const OVERTIME_MULTIPLIER = 1.5

export const PAYROLL_EDITOR_EMPLOYEE_IDS = new Set(['1002', '1010', '1019'])
export const PAYROLL_APPROVER_EMPLOYEE_ID = '1019'

export function canEditPayroll(user) {
  if (!user) {
    return false
  }
  if (user.role === 'admin') {
    return true
  }
  return PAYROLL_EDITOR_EMPLOYEE_IDS.has(user.id)
}

export function canApprovePayroll(user) {
  return user?.id === PAYROLL_APPROVER_EMPLOYEE_ID
}

export function isPayrollPeriodApproved(payrollApprovals, periodId) {
  return payrollApprovals?.[periodId]?.status === 'approved'
}

export function getPayrollPeriodApproval(payrollApprovals, periodId) {
  return payrollApprovals?.[periodId] ?? null
}

export function canModifyPayrollPeriod(user, payrollApprovals, periodId) {
  if (!periodId) {
    return false
  }
  return canEditPayroll(user) && !isPayrollPeriodApproved(payrollApprovals, periodId)
}

export function createPayrollApproval(user) {
  return {
    status: 'approved',
    approvedById: user.id,
    approvedByName: user.name,
    approvedAt: new Date().toISOString(),
  }
}

export function isPayrollEmployee(employee) {
  return employee?.contractType === 'seasonal' || employee?.contractType === 'supplementary'
}

export function createBlankPayrollAdjustment() {
  return {
    sickLeaveDays: 0,
    compassionateLeaveDays: 0,
    unpaidLeaveDays: 0,
    maternityLeaveDays: 0,
    overtimeHours: 0,
    salaryAdvance: 0,
    azimaSacco: 0,
    helb: 0,
    ppeDeductions: 0,
  }
}

export function countDaysWorkedFromAttendance(attendanceEvents, employeeId, fromDate, toDate) {
  const dates = new Set()
  attendanceEvents.forEach((event) => {
    if (event.employeeId !== employeeId || event.eventType !== 'clock_in') {
      return
    }
    const date = toKenyaDateString(event.occurredAt)
    if (date && date >= fromDate && date <= toDate) {
      dates.add(date)
    }
  })
  return dates.size
}

function sumHarvestMetrics(records, employeeId, fromDate, toDate, incentiveThresholdKg) {
  const employeeRecords = records.filter(
    (record) =>
      record.harvesterId === employeeId &&
      record.harvestedOn >= fromDate &&
      record.harvestedOn <= toDate,
  )
  const totalIncentiveKes = employeeRecords.reduce(
    (sum, record) => sum + Number(record.incentiveKes ?? 0),
    0,
  )
  const kgsOver250 = employeeRecords.reduce((sum, record) => {
    const kg = Number(record.kg ?? 0)
    return sum + Math.max(0, kg - incentiveThresholdKg)
  }, 0)
  return { totalIncentiveKes, kgsOver250 }
}

export function calculatePayrollLine({
  employee,
  period,
  adjustment = createBlankPayrollAdjustment(),
  attendanceEvents = [],
  harvestRecords = [],
  incentiveThresholdKg = 250,
}) {
  const dailyRate = getEmployeeDailyWageKes(employee)
  const hourlyRate = dailyRate / HOURS_PER_DAY
  const daysWorked = countDaysWorkedFromAttendance(
    attendanceEvents,
    employee.id,
    period.startDate,
    period.endDate,
  )
  const sickLeaveDays = Number(adjustment.sickLeaveDays) || 0
  const compassionateLeaveDays = Number(adjustment.compassionateLeaveDays) || 0
  const unpaidLeaveDays = Number(adjustment.unpaidLeaveDays) || 0
  const maternityLeaveDays = Number(adjustment.maternityLeaveDays) || 0
  const paidLeaveDays = sickLeaveDays + compassionateLeaveDays + maternityLeaveDays
  const regularPay = Math.round(dailyRate * (daysWorked + paidLeaveDays))
  const overtimeHours = Number(adjustment.overtimeHours) || 0
  const overtimePay = Math.round(overtimeHours * hourlyRate * OVERTIME_MULTIPLIER)
  const { totalIncentiveKes, kgsOver250 } = sumHarvestMetrics(
    harvestRecords,
    employee.id,
    period.startDate,
    period.endDate,
    incentiveThresholdKg,
  )
  const totalEarnings = regularPay + overtimePay + totalIncentiveKes
  const shaDeductions = Math.round(Math.max(SHA_MINIMUM_KES, totalEarnings * SHA_RATE))
  const nssf = Math.round(totalEarnings * NSSF_RATE)
  const ahl = Math.round(totalEarnings * AHL_RATE)
  const salaryAdvance = Number(adjustment.salaryAdvance) || 0
  const azimaSacco = Number(adjustment.azimaSacco) || 0
  const helb = Number(adjustment.helb) || 0
  const ppeDeductions = Number(adjustment.ppeDeductions) || 0
  const totalDeductions = salaryAdvance + azimaSacco + shaDeductions + nssf + ahl + helb + ppeDeductions
  const netPay = totalEarnings - totalDeductions
  const maxSalaryAdvance = calculateMaxAdvanceClaimable(
    employee,
    period,
    attendanceEvents,
    harvestRecords,
  )

  return {
    employeeId: employee.id,
    name: employee.name,
    department: employee.department ?? '—',
    phone: employee.phone ?? '—',
    idNumber: employee.idNumber ?? '—',
    nssfNumber: employee.nssfNumber ?? '—',
    pinNumber: employee.pinNumber ?? '—',
    bankName: employee.bankName ?? '—',
    bankAccountNumber: employee.bankAccountNumber ?? '—',
    contractType: employee.contractType,
    dailyRate,
    daysWorked,
    sickLeaveDays,
    compassionateLeaveDays,
    unpaidLeaveDays,
    maternityLeaveDays,
    paidLeaveDays,
    overtimeHours,
    regularPay,
    overtimePay,
    incentiveRate: 1,
    kgsOver250,
    totalIncentiveKes,
    totalEarnings,
    salaryAdvance,
    maxSalaryAdvance,
    azimaSacco,
    shaDeductions,
    nssf,
    ahl,
    helb,
    ppeDeductions,
    totalDeductions,
    netPay,
  }
}

export function buildPayrollLines({
  employees,
  period,
  payrollAdjustments = {},
  attendanceEvents = [],
  harvestRecords = [],
  incentiveThresholdKg = 250,
  contractTypeFilter = 'all',
}) {
  const periodAdjustments = payrollAdjustments[period.id] ?? {}
  return employees
    .filter((employee) => isPayrollEmployee(employee))
    .filter((employee) =>
      contractTypeFilter === 'all' ? true : employee.contractType === contractTypeFilter,
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((employee) =>
      calculatePayrollLine({
        employee,
        period,
        adjustment: {
          ...createBlankPayrollAdjustment(),
          ...(periodAdjustments[employee.id] ?? {}),
        },
        attendanceEvents,
        harvestRecords,
        incentiveThresholdKg,
      }),
    )
}

export function sumPayrollColumn(lines, key) {
  return lines.reduce((sum, line) => sum + Number(line[key] ?? 0), 0)
}
