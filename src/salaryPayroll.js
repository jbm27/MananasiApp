import { calculateMaxAdvanceClaimable } from './payrollAdvances.js'
import { isPayrollParticipant } from './employeePay.js'

const NSSF_TIER_1_KES = 540
const NSSF_TIER_2_LOWER_LIMIT_KES = 9000
const NSSF_TIER_2_RATE = 0.05
const NSSF_TIER_2_CAP_KES = 5940
const PENSION_RATE = 0.05
const AHL_RATE = 0.015
const SHA_RATE = 0.0275
const PERSONAL_TAX_RELIEF_KES = 2400

export function isSalariedEmployee(employee) {
  return (
    isPayrollParticipant(employee) &&
    employee?.contractType === 'regular' &&
    Number(employee?.monthlySalaryKes) > 0
  )
}

export function createBlankSalaryAdjustment() {
  return {
    overtime: 0,
    allowances: 0,
    backdatedPay: 0,
    helb: 0,
    salaryAdvance: 0,
    azimaSacco: 0,
    welfareContribution: 0,
    taxRelief: PERSONAL_TAX_RELIEF_KES,
  }
}

export function calculateNssfTier2(grossPay) {
  if (grossPay <= NSSF_TIER_2_LOWER_LIMIT_KES) {
    return 0
  }
  return Math.min((grossPay - NSSF_TIER_2_LOWER_LIMIT_KES) * NSSF_TIER_2_RATE, NSSF_TIER_2_CAP_KES)
}

export function calculateMonthlyTax(taxableSalary) {
  const taxable = Number(taxableSalary) || 0
  if (taxable <= 0) {
    return 0
  }
  if (taxable < 24000) {
    return taxable * 0.1
  }
  if (taxable < 32333) {
    return (taxable - 24000) * 0.25 + 2400
  }
  return (taxable - 32333.33) * 0.3 + 4483.33
}

export function calculateSalaryLine({
  employee,
  adjustment = createBlankSalaryAdjustment(),
  maxSalaryAdvance = 0,
}) {
  const grossSalary = Math.round(Number(employee.monthlySalaryKes) || 0)
  const overtime = Number(adjustment.overtime) || 0
  const allowances = Number(adjustment.allowances) || 0
  const backdatedPay = Number(adjustment.backdatedPay) || 0
  const grossPay = grossSalary + overtime + allowances + backdatedPay

  const nssfTier1 = NSSF_TIER_1_KES
  const nssfTier2 = Math.round(calculateNssfTier2(grossPay))
  const nssf = nssfTier1 + nssfTier2
  const pension = Math.round(grossPay * PENSION_RATE)
  const ahl = Math.round(grossPay * AHL_RATE)
  const sha = Math.round(grossPay * SHA_RATE)
  const taxableSalary = grossPay - nssfTier1 - nssfTier2 - pension - ahl - sha
  const tax = calculateMonthlyTax(taxableSalary)
  const taxRelief =
    adjustment.taxRelief === undefined || adjustment.taxRelief === null
      ? PERSONAL_TAX_RELIEF_KES
      : Number(adjustment.taxRelief) || 0
  const paye = Math.max(0, tax - taxRelief)
  const helb = Number(adjustment.helb) || 0
  const totalDeductions = nssfTier1 + nssfTier2 + pension + ahl + sha + paye + helb
  const salaryAdvance = Number(adjustment.salaryAdvance) || 0
  const azimaSacco = Number(adjustment.azimaSacco) || 0
  const welfareContribution = Number(adjustment.welfareContribution) || 0
  const netPay = grossPay - totalDeductions - salaryAdvance - azimaSacco - welfareContribution
  const employerPension = pension

  return {
    employeeId: employee.id,
    name: employee.name,
    department: employee.department ?? '—',
    grossSalary,
    overtime,
    allowances,
    backdatedPay,
    grossPay,
    nssfTier1,
    nssfTier2,
    nssf,
    pension,
    ahl,
    sha,
    taxableSalary: Math.round(taxableSalary),
    tax: Math.round(tax * 100) / 100,
    taxRelief,
    paye: Math.round(paye * 100) / 100,
    helb,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    salaryAdvance,
    maxSalaryAdvance,
    azimaSacco,
    welfareContribution,
    netPay: Math.round(netPay * 100) / 100,
    employerPension,
    totalPension: pension + employerPension,
  }
}

export function buildSalaryPayrollLines({
  employees,
  salaryPayrollAdjustments = {},
  periodId,
  period = null,
  attendanceEvents = [],
  harvestRecords = [],
}) {
  const periodAdjustments = salaryPayrollAdjustments[periodId] ?? {}
  return employees
    .filter((employee) => isSalariedEmployee(employee))
    .sort((a, b) => {
      const dept = (a.department ?? '').localeCompare(b.department ?? '')
      if (dept !== 0) {
        return dept
      }
      return a.name.localeCompare(b.name)
    })
    .map((employee) => {
      const maxSalaryAdvance = period
        ? calculateMaxAdvanceClaimable(employee, period, attendanceEvents, harvestRecords)
        : 0
      return calculateSalaryLine({
        employee,
        maxSalaryAdvance,
        adjustment: {
          ...createBlankSalaryAdjustment(),
          ...(periodAdjustments[employee.id] ?? {}),
        },
      })
    })
}

export function sumSalaryColumn(lines, key) {
  return lines.reduce((sum, line) => sum + Number(line[key] ?? 0), 0)
}
