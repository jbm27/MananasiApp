import { compareEmployeesByName } from './employeeFields.js'
import { getEmployeeDailyWageKes, isPayrollParticipant, sumAttendanceDailyPay } from './employeePay.js'
import { toKenyaDateString } from './kenyaTime.js'

function isWageEmployee(employee) {
  return employee?.contractType === 'seasonal' || employee?.contractType === 'supplementary'
}

function countDaysWorkedFromAttendance(attendanceEvents, employeeId, fromDate, toDate) {
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

function daysInclusive(fromDate, toDate) {
  const from = new Date(`${fromDate}T12:00:00`)
  const to = new Date(`${toDate}T12:00:00`)
  return Math.round((to - from) / (24 * 60 * 60 * 1000)) + 1
}

function sumHarvesterBaseEarnings(records, employeeId, fromDate, toDate, dailyRate) {
  return records
    .filter(
      (record) =>
        record.harvesterId === employeeId &&
        record.harvestedOn >= fromDate &&
        record.harvestedOn <= toDate,
    )
    .reduce((sum, record) => sum + Number(record.baseWageKes ?? dailyRate), 0)
}

export function isAdvanceEligibleEmployee(employee) {
  if (!isPayrollParticipant(employee)) {
    return false
  }
  const contractType = employee?.contractType
  return (
    contractType === 'regular' || contractType === 'seasonal' || contractType === 'supplementary'
  )
}

export function getAdvanceAdjustmentSource(employee) {
  return isWageEmployee(employee) ? 'wage' : 'salary'
}

export function calculateEarningsToAdvanceDate(
  employee,
  period,
  attendanceEvents = [],
  harvestRecords = [],
  dailyWageRates,
) {
  const fromDate = period.startDate
  const toDate = period.advanceFriday
  if (!toDate || toDate < fromDate) {
    return 0
  }

  const dailyRate = getEmployeeDailyWageKes(employee, { dailyWageRates })

  if (employee.role === 'harvester') {
    return sumHarvesterBaseEarnings(harvestRecords, employee.id, fromDate, toDate, dailyRate)
  }

  if (employee.contractType === 'regular') {
    const monthlySalary = Number(employee.monthlySalaryKes) || 0
    if (monthlySalary > 0) {
      const periodDays = daysInclusive(period.startDate, period.endDate)
      const daysToAdvance = daysInclusive(fromDate, toDate)
      return Math.round(monthlySalary * (daysToAdvance / periodDays))
    }
  }

  return sumAttendanceDailyPay(attendanceEvents, employee, fromDate, toDate, dailyWageRates)
}

export function calculateMaxAdvanceClaimable(
  employee,
  period,
  attendanceEvents = [],
  harvestRecords = [],
  dailyWageRates,
) {
  return Math.floor(
    calculateEarningsToAdvanceDate(
      employee,
      period,
      attendanceEvents,
      harvestRecords,
      dailyWageRates,
    ) / 2,
  )
}

export function buildAdvanceLines({
  employees,
  period,
  payrollAdjustments = {},
  salaryPayrollAdjustments = {},
  attendanceEvents = [],
  harvestRecords = [],
  dailyWageRates,
}) {
  if (!period) {
    return []
  }
  const wageAdjustments = payrollAdjustments[period.id] ?? {}
  const salaryAdjustments = salaryPayrollAdjustments[period.id] ?? {}

  return employees
    .filter(isAdvanceEligibleEmployee)
    .sort(compareEmployeesByName)
    .map((employee) => {
      const earningsToDate = calculateEarningsToAdvanceDate(
        employee,
        period,
        attendanceEvents,
        harvestRecords,
        dailyWageRates,
      )
      const maxClaimable = Math.floor(earningsToDate / 2)
      const adjustmentSource = getAdvanceAdjustmentSource(employee)
      const adjustment =
        adjustmentSource === 'wage'
          ? wageAdjustments[employee.id]
          : salaryAdjustments[employee.id]
      const amountClaimed = Number(adjustment?.salaryAdvance) || 0

      return {
        employeeId: employee.id,
        name: employee.name,
        earningsToDate,
        maxClaimable,
        amountClaimed,
        adjustmentSource,
      }
    })
}

export function sumAdvanceColumn(lines, key) {
  return lines.reduce((sum, line) => sum + Number(line[key] ?? 0), 0)
}
