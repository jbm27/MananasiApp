import { useEffect, useMemo, useState } from 'react'
import { getContractTypeLabel } from './employeePay.js'
import { fetchAttendanceEventsForPeriod } from './api/client.js'
import {
  build445PayPeriods,
  getDefaultPayPeriodId,
  getFiscalYearForDate,
} from './payPeriods.js'
import {
  buildPayrollLines,
  canEditPayroll,
  createBlankPayrollAdjustment,
  sumPayrollColumn,
} from './payroll.js'

function formatDisplayDate(dateStr) {
  if (!dateStr) {
    return '—'
  }
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatMoney(value) {
  return Number(value ?? 0).toLocaleString()
}

function EditableNumberCell({ value, onChange, disabled, step = '0.1', min = '0' }) {
  return (
    <input
      className="payroll-input"
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  )
}

export default function PayrollPage({
  currentUser,
  employees,
  harvestRecords,
  compensationRules,
  payrollAdjustments,
  onUpdatePayrollAdjustment,
}) {
  const currentFiscalYear = getFiscalYearForDate(new Date().toISOString().slice(0, 10))
  const [selectedYear, setSelectedYear] = useState(currentFiscalYear)
  const [selectedPeriodId, setSelectedPeriodId] = useState(getDefaultPayPeriodId())
  const [contractTypeFilter, setContractTypeFilter] = useState('all')
  const [attendanceEvents, setAttendanceEvents] = useState([])
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceError, setAttendanceError] = useState('')

  const canEdit = canEditPayroll(currentUser)
  const periods = useMemo(() => build445PayPeriods(selectedYear), [selectedYear])
  const selectedPeriod =
    periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null

  useEffect(() => {
    if (!periods.some((period) => period.id === selectedPeriodId)) {
      setSelectedPeriodId(periods[0]?.id ?? getDefaultPayPeriodId())
    }
  }, [periods, selectedPeriodId])

  useEffect(() => {
    if (!selectedPeriod) {
      return
    }
    setAttendanceLoading(true)
    setAttendanceError('')
    fetchAttendanceEventsForPeriod(selectedPeriod.startDate, selectedPeriod.endDate)
      .then((events) => setAttendanceEvents(events))
      .catch((error) => {
        setAttendanceEvents([])
        setAttendanceError(error.message ?? 'Failed to load attendance for this period.')
      })
      .finally(() => setAttendanceLoading(false))
  }, [selectedPeriod])

  const payrollLines = useMemo(() => {
    if (!selectedPeriod) {
      return []
    }
    return buildPayrollLines({
      employees,
      period: selectedPeriod,
      payrollAdjustments,
      attendanceEvents,
      harvestRecords,
      incentiveThresholdKg: compensationRules.incentiveThresholdKg,
      contractTypeFilter,
    })
  }, [
    employees,
    selectedPeriod,
    payrollAdjustments,
    attendanceEvents,
    harvestRecords,
    compensationRules.incentiveThresholdKg,
    contractTypeFilter,
  ])

  function handleAdjustmentChange(employeeId, field, rawValue) {
    if (!selectedPeriod || !canEdit) {
      return
    }
    const numeric = Number(rawValue)
    const value = Number.isNaN(numeric) ? 0 : numeric
    const current = {
      ...createBlankPayrollAdjustment(),
      ...(payrollAdjustments[selectedPeriod.id]?.[employeeId] ?? {}),
    }
    onUpdatePayrollAdjustment(selectedPeriod.id, employeeId, {
      ...current,
      [field]: value,
    })
  }

  const totals = {
    daysWorked: sumPayrollColumn(payrollLines, 'daysWorked'),
    paidLeaveDays: sumPayrollColumn(payrollLines, 'paidLeaveDays'),
    regularPay: sumPayrollColumn(payrollLines, 'regularPay'),
    overtimePay: sumPayrollColumn(payrollLines, 'overtimePay'),
    totalIncentiveKes: sumPayrollColumn(payrollLines, 'totalIncentiveKes'),
    totalEarnings: sumPayrollColumn(payrollLines, 'totalEarnings'),
    salaryAdvance: sumPayrollColumn(payrollLines, 'salaryAdvance'),
    azimaSacco: sumPayrollColumn(payrollLines, 'azimaSacco'),
    shaDeductions: sumPayrollColumn(payrollLines, 'shaDeductions'),
    nssf: sumPayrollColumn(payrollLines, 'nssf'),
    ahl: sumPayrollColumn(payrollLines, 'ahl'),
    helb: sumPayrollColumn(payrollLines, 'helb'),
    ppeDeductions: sumPayrollColumn(payrollLines, 'ppeDeductions'),
    netPay: sumPayrollColumn(payrollLines, 'netPay'),
  }

  return (
    <section className="panel payroll-page">
      <h2>Payroll</h2>
      <p>
        Seasonal and supplementary employee payroll on a 4-4-5 calendar starting 27 December each
        year. Wages run to the last Friday of each period; payment is the following Monday.
      </p>

      <div className="form-grid payroll-toolbar">
        <label>
          Fiscal year
          <select
            value={selectedYear}
            onChange={(event) => {
              const year = Number(event.target.value)
              setSelectedYear(year)
              setSelectedPeriodId(`FY${year}-P01`)
            }}
          >
            {[currentFiscalYear - 1, currentFiscalYear, currentFiscalYear + 1].map((year) => (
              <option key={year} value={year}>
                FY{year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pay period
          <select
            value={selectedPeriod?.id ?? ''}
            onChange={(event) => setSelectedPeriodId(event.target.value)}
          >
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contract type
          <select
            value={contractTypeFilter}
            onChange={(event) => setContractTypeFilter(event.target.value)}
          >
            <option value="all">Seasonal and supplementary</option>
            <option value="seasonal">Seasonal only</option>
            <option value="supplementary">Supplementary only</option>
          </select>
        </label>
      </div>

      {selectedPeriod && (
        <div className="payroll-period-meta">
          <span>
            Period: {formatDisplayDate(selectedPeriod.startDate)} –{' '}
            {formatDisplayDate(selectedPeriod.endDate)}
          </span>
          <span>Payment date: {formatDisplayDate(selectedPeriod.paymentDate)}</span>
          <span>Advance Friday: {formatDisplayDate(selectedPeriod.advanceFriday)}</span>
          <span>{selectedPeriod.weekCount}-week month</span>
        </div>
      )}

      {attendanceLoading && <div className="placeholder">Loading attendance for this period…</div>}
      {attendanceError && <div className="placeholder">{attendanceError}</div>}
      {!canEdit && (
        <div className="placeholder">
          Payroll adjustments can only be edited by Naomi, Doreen, or James Boyd-Moss.
        </div>
      )}

      <div className="table-wrap payroll-table-wrap">
        <table className="payroll-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Department</th>
              <th>Contract</th>
              <th>Daily rate</th>
              <th>Days worked</th>
              <th>Sick</th>
              <th>Compassionate</th>
              <th>Maternity</th>
              <th>Unpaid</th>
              <th>Regular pay</th>
              <th>OT hrs</th>
              <th>OT pay</th>
              <th>Kg over 250</th>
              <th>Incentive</th>
              <th>Total earnings</th>
              <th>Advance</th>
              <th>Max advance</th>
              <th>Azima Sacco</th>
              <th>SHA</th>
              <th>NSSF</th>
              <th>AHL</th>
              <th>HELB</th>
              <th>PPE</th>
              <th>Net pay</th>
            </tr>
          </thead>
          <tbody>
            {payrollLines.length === 0 && (
              <tr>
                <td colSpan="24">No seasonal or supplementary employees match this filter.</td>
              </tr>
            )}
            {payrollLines.map((line) => (
              <tr key={line.employeeId}>
                <td>{line.name}</td>
                <td>{line.department}</td>
                <td>{getContractTypeLabel(line.contractType)}</td>
                <td>{formatMoney(line.dailyRate)}</td>
                <td>{line.daysWorked}</td>
                <td>
                  <EditableNumberCell
                    value={line.sickLeaveDays}
                    onChange={(value) => handleAdjustmentChange(line.employeeId, 'sickLeaveDays', value)}
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <EditableNumberCell
                    value={line.compassionateLeaveDays}
                    onChange={(value) =>
                      handleAdjustmentChange(line.employeeId, 'compassionateLeaveDays', value)
                    }
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <EditableNumberCell
                    value={line.maternityLeaveDays}
                    onChange={(value) =>
                      handleAdjustmentChange(line.employeeId, 'maternityLeaveDays', value)
                    }
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <EditableNumberCell
                    value={line.unpaidLeaveDays}
                    onChange={(value) =>
                      handleAdjustmentChange(line.employeeId, 'unpaidLeaveDays', value)
                    }
                    disabled={!canEdit}
                  />
                </td>
                <td>{formatMoney(line.regularPay)}</td>
                <td>
                  <EditableNumberCell
                    value={line.overtimeHours}
                    onChange={(value) => handleAdjustmentChange(line.employeeId, 'overtimeHours', value)}
                    disabled={!canEdit}
                    step="0.5"
                  />
                </td>
                <td>{formatMoney(line.overtimePay)}</td>
                <td>{formatMoney(line.kgsOver250)}</td>
                <td>{formatMoney(line.totalIncentiveKes)}</td>
                <td>{formatMoney(line.totalEarnings)}</td>
                <td>
                  <EditableNumberCell
                    value={line.salaryAdvance}
                    onChange={(value) => handleAdjustmentChange(line.employeeId, 'salaryAdvance', value)}
                    disabled={!canEdit}
                  />
                </td>
                <td>{formatMoney(line.maxSalaryAdvance)}</td>
                <td>
                  <EditableNumberCell
                    value={line.azimaSacco}
                    onChange={(value) => handleAdjustmentChange(line.employeeId, 'azimaSacco', value)}
                    disabled={!canEdit}
                  />
                </td>
                <td>{formatMoney(line.shaDeductions)}</td>
                <td>{formatMoney(line.nssf)}</td>
                <td>{formatMoney(line.ahl)}</td>
                <td>
                  <EditableNumberCell
                    value={line.helb}
                    onChange={(value) => handleAdjustmentChange(line.employeeId, 'helb', value)}
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <EditableNumberCell
                    value={line.ppeDeductions}
                    onChange={(value) =>
                      handleAdjustmentChange(line.employeeId, 'ppeDeductions', value)
                    }
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <strong>{formatMoney(line.netPay)}</strong>
                </td>
              </tr>
            ))}
            {payrollLines.length > 0 && (
              <tr className="payroll-totals-row">
                <td colSpan="4">
                  <strong>Totals</strong>
                </td>
                <td>{totals.daysWorked}</td>
                <td colSpan="4"></td>
                <td>{formatMoney(totals.regularPay)}</td>
                <td></td>
                <td>{formatMoney(totals.overtimePay)}</td>
                <td></td>
                <td>{formatMoney(totals.totalIncentiveKes)}</td>
                <td>{formatMoney(totals.totalEarnings)}</td>
                <td>{formatMoney(totals.salaryAdvance)}</td>
                <td></td>
                <td>{formatMoney(totals.azimaSacco)}</td>
                <td>{formatMoney(totals.shaDeductions)}</td>
                <td>{formatMoney(totals.nssf)}</td>
                <td>{formatMoney(totals.ahl)}</td>
                <td>{formatMoney(totals.helb)}</td>
                <td>{formatMoney(totals.ppeDeductions)}</td>
                <td>
                  <strong>{formatMoney(totals.netPay)}</strong>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rules-box">
        <strong>Calculations:</strong> Regular pay = daily rate × (days worked + sick + compassionate
        + maternity leave). Overtime = hours × hourly rate × 1.5. SHA = max(KES 300, 2.75% of total
        earnings). NSSF = 6%. AHL = 1.5%. Max advance = half of base earnings to the advance Friday
        (harvester incentives excluded).
      </div>
    </section>
  )
}
