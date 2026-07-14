import { useEffect, useMemo, useState } from 'react'
import {
  AUTO_CLOCK_OUT_HOURS,
  MINIMUM_WORK_HOURS_PER_DAY,
  buildAttendanceExceptionReport,
  getAttendanceExceptionLabel,
} from './attendanceProcessing.js'
import { getContractTypeLabel, getDailyWageRatesFromCompensation } from './employeePay.js'
import { fetchAttendanceEventsForPeriod } from './api/client.js'
import {
  buildAdvanceLines,
  sumAdvanceColumn,
} from './payrollAdvances.js'
import {
  build445PayPeriods,
  getDefaultPayPeriodId,
  getFiscalYearForDate,
} from './payPeriods.js'
import {
  buildPayrollLines,
  canApprovePayroll,
  canEditPayroll,
  canModifyPayrollSection,
  createBlankPayrollAdjustment,
  getPayrollSectionApproval,
  sumPayrollColumn,
} from './payroll.js'
import {
  buildSalaryPayrollLines,
  createBlankSalaryAdjustment,
  sumSalaryColumn,
} from './salaryPayroll.js'

function formatDisplayDateTime(isoDateTime) {
  if (!isoDateTime) {
    return '—'
  }
  return new Date(isoDateTime).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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

function formatMoney(value, decimals = 0) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function EditableNumberCell({ value, onChange, disabled, step = '1', min = '0' }) {
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

function PayrollSection({ title, isOpen, onToggle, children }) {
  return (
    <div className="payroll-section">
      <button type="button" className="payroll-section-toggle" onClick={onToggle}>
        <span>{title}</span>
        <span className="payroll-section-chevron">{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen ? <div className="payroll-section-body">{children}</div> : null}
    </div>
  )
}

function PayrollSectionApprovalFooter({
  sectionLabel,
  draftMessage,
  approval,
  canApprove,
  onApprove,
  onRelease,
}) {
  const isApproved = approval?.status === 'approved'

  return (
    <div
      className={`payroll-section-approval${isApproved ? ' payroll-section-approval--approved' : ''}`}
    >
      <div className="payroll-section-approval-main">
        {isApproved ? (
          <>
            <span className="payroll-approval-status payroll-approval-status--approved">
              Approved
            </span>
            <p>
              {sectionLabel} signed off by {approval.approvedByName} on{' '}
              {formatDisplayDateTime(approval.approvedAt)}.
            </p>
          </>
        ) : (
          <>
            <span className="payroll-approval-status payroll-approval-status--draft">Draft</span>
            <p>{draftMessage}</p>
          </>
        )}
      </div>
      {canApprove && (
        <div className="payroll-approval-actions">
          {isApproved ? (
            <button type="button" onClick={onRelease}>
              Release for editing
            </button>
          ) : (
            <button type="button" className="payroll-approve-button" onClick={onApprove}>
              Approve {sectionLabel.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function PayrollPage({
  currentUser,
  employees,
  harvestRecords,
  compensationRules,
  payrollAdjustments,
  salaryPayrollAdjustments,
  payrollApprovals,
  onUpdatePayrollAdjustment,
  onUpdateSalaryPayrollAdjustment,
  onApprovePayrollSection,
  onReleasePayrollSection,
}) {
  const currentFiscalYear = getFiscalYearForDate(new Date().toISOString().slice(0, 10))
  const [selectedYear, setSelectedYear] = useState(currentFiscalYear)
  const [selectedPeriodId, setSelectedPeriodId] = useState(getDefaultPayPeriodId())
  const [contractTypeFilter, setContractTypeFilter] = useState('all')
  const [showAdvances, setShowAdvances] = useState(false)
  const [showWages, setShowWages] = useState(false)
  const [showSalaries, setShowSalaries] = useState(false)
  const [showAttendanceExceptions, setShowAttendanceExceptions] = useState(false)
  const [attendanceEvents, setAttendanceEvents] = useState([])
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceError, setAttendanceError] = useState('')

  const canEdit = canEditPayroll(currentUser)
  const canApprove = canApprovePayroll(currentUser)
  const periods = useMemo(() => build445PayPeriods(selectedYear), [selectedYear])
  const selectedPeriod =
    periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null
  const advancesApproval = selectedPeriod
    ? getPayrollSectionApproval(payrollApprovals, selectedPeriod.id, 'advances')
    : null
  const wagesApproval = selectedPeriod
    ? getPayrollSectionApproval(payrollApprovals, selectedPeriod.id, 'wages')
    : null
  const salariesApproval = selectedPeriod
    ? getPayrollSectionApproval(payrollApprovals, selectedPeriod.id, 'salaries')
    : null
  const canModifyAdvances = canModifyPayrollSection(
    currentUser,
    payrollApprovals,
    selectedPeriod?.id,
    'advances',
  )
  const canModifyWages = canModifyPayrollSection(
    currentUser,
    payrollApprovals,
    selectedPeriod?.id,
    'wages',
  )
  const canModifySalaries = canModifyPayrollSection(
    currentUser,
    payrollApprovals,
    selectedPeriod?.id,
    'salaries',
  )

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

  const dailyWageRates = useMemo(
    () => getDailyWageRatesFromCompensation(compensationRules),
    [compensationRules],
  )

  const advanceLines = useMemo(() => {
    if (!selectedPeriod) {
      return []
    }
    return buildAdvanceLines({
      employees,
      period: selectedPeriod,
      payrollAdjustments,
      salaryPayrollAdjustments,
      attendanceEvents,
      harvestRecords,
      dailyWageRates,
    })
  }, [
    employees,
    selectedPeriod,
    payrollAdjustments,
    salaryPayrollAdjustments,
    attendanceEvents,
    harvestRecords,
    dailyWageRates,
  ])

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
      dailyWageRates,
    })
  }, [
    employees,
    selectedPeriod,
    payrollAdjustments,
    attendanceEvents,
    harvestRecords,
    compensationRules.incentiveThresholdKg,
    contractTypeFilter,
    dailyWageRates,
  ])

  const salaryLines = useMemo(() => {
    if (!selectedPeriod) {
      return []
    }
    return buildSalaryPayrollLines({
      employees,
      salaryPayrollAdjustments,
      periodId: selectedPeriod.id,
      period: selectedPeriod,
      attendanceEvents,
      harvestRecords,
    })
  }, [employees, selectedPeriod, salaryPayrollAdjustments, attendanceEvents, harvestRecords])

  const attendanceExceptionLines = useMemo(() => {
    if (!selectedPeriod) {
      return []
    }
    return buildAttendanceExceptionReport(employees, selectedPeriod, attendanceEvents)
  }, [employees, selectedPeriod, attendanceEvents])

  function handleAdvanceChange(line, rawValue) {
    if (!selectedPeriod || !canModifyAdvances) {
      return
    }
    if (line.adjustmentSource === 'wage') {
      handleWageAdvanceChange(line.employeeId, rawValue)
      return
    }
    handleSalaryAdvanceChange(line.employeeId, rawValue)
  }

  function handleWageAdvanceChange(employeeId, rawValue) {
    if (!selectedPeriod || !canModifyAdvances) {
      return
    }
    const numeric = Number(rawValue)
    const value = Number.isNaN(numeric) ? 0 : numeric
    const current = {
      ...createBlankPayrollAdjustment(),
      ...(payrollAdjustments[selectedPeriod.id]?.[employeeId] ?? {}),
    }
    onUpdatePayrollAdjustment(
      selectedPeriod.id,
      employeeId,
      { ...current, salaryAdvance: value },
      'advances',
    )
  }

  function handleSalaryAdvanceChange(employeeId, rawValue) {
    if (!selectedPeriod || !canModifyAdvances) {
      return
    }
    const numeric = Number(rawValue)
    const value = Number.isNaN(numeric) ? 0 : numeric
    const current = {
      ...createBlankSalaryAdjustment(),
      ...(salaryPayrollAdjustments[selectedPeriod.id]?.[employeeId] ?? {}),
    }
    onUpdateSalaryPayrollAdjustment(
      selectedPeriod.id,
      employeeId,
      { ...current, salaryAdvance: value },
      'advances',
    )
  }

  function handleWageAdjustmentChange(employeeId, field, rawValue) {
    if (!selectedPeriod || !canModifyWages) {
      return
    }
    const numeric = Number(rawValue)
    const value = Number.isNaN(numeric) ? 0 : numeric
    const current = {
      ...createBlankPayrollAdjustment(),
      ...(payrollAdjustments[selectedPeriod.id]?.[employeeId] ?? {}),
    }
    onUpdatePayrollAdjustment(
      selectedPeriod.id,
      employeeId,
      { ...current, [field]: value },
      'wages',
    )
  }

  function handleSalaryAdjustmentChange(employeeId, field, rawValue) {
    if (!selectedPeriod || !canModifySalaries) {
      return
    }
    const numeric = Number(rawValue)
    const value = Number.isNaN(numeric) ? 0 : numeric
    const current = {
      ...createBlankSalaryAdjustment(),
      ...(salaryPayrollAdjustments[selectedPeriod.id]?.[employeeId] ?? {}),
    }
    onUpdateSalaryPayrollAdjustment(
      selectedPeriod.id,
      employeeId,
      { ...current, [field]: value },
      'salaries',
    )
  }

  const advanceTotals = {
    earningsToDate: sumAdvanceColumn(advanceLines, 'earningsToDate'),
    maxClaimable: sumAdvanceColumn(advanceLines, 'maxClaimable'),
    amountClaimed: sumAdvanceColumn(advanceLines, 'amountClaimed'),
  }

  const wageTotals = {
    daysWorked: sumPayrollColumn(payrollLines, 'daysWorked'),
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

  const salaryTotals = {
    grossSalary: sumSalaryColumn(salaryLines, 'grossSalary'),
    grossPay: sumSalaryColumn(salaryLines, 'grossPay'),
    nssf: sumSalaryColumn(salaryLines, 'nssf'),
    pension: sumSalaryColumn(salaryLines, 'pension'),
    ahl: sumSalaryColumn(salaryLines, 'ahl'),
    sha: sumSalaryColumn(salaryLines, 'sha'),
    paye: sumSalaryColumn(salaryLines, 'paye'),
    helb: sumSalaryColumn(salaryLines, 'helb'),
    totalDeductions: sumSalaryColumn(salaryLines, 'totalDeductions'),
    salaryAdvance: sumSalaryColumn(salaryLines, 'salaryAdvance'),
    azimaSacco: sumSalaryColumn(salaryLines, 'azimaSacco'),
    welfareContribution: sumSalaryColumn(salaryLines, 'welfareContribution'),
    netPay: sumSalaryColumn(salaryLines, 'netPay'),
  }

  return (
    <section className="panel payroll-page">
      <h2>Payroll</h2>
      <p>
        Payroll on a 4-4-5 calendar starting 27 December each year. Seasonal and supplementary staff
        are paid <strong>wages</strong>; regular staff are paid <strong>salaries</strong>.
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

      <PayrollSection
        title="Advances"
        isOpen={showAdvances}
        onToggle={() => setShowAdvances((prev) => !prev)}
      >
        <p className="payroll-advance-intro">
          Each employee may claim up to half of earnings from the start of this pay period through
          advance Friday ({formatDisplayDate(selectedPeriod?.advanceFriday)}), excluding harvesting
          bonuses. Enter the actual amount claimed — it may be less than the maximum.
        </p>

        <div className="table-wrap payroll-table-wrap">
          <table className="payroll-table payroll-advance-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Earnings to date</th>
                <th>Max claimable</th>
                <th>Amount claimed</th>
              </tr>
            </thead>
            <tbody>
              {advanceLines.length === 0 && (
                <tr>
                  <td colSpan="4">No employees on record for this period.</td>
                </tr>
              )}
              {advanceLines.map((line) => (
                <tr
                  key={line.employeeId}
                  className={
                    line.amountClaimed > line.maxClaimable ? 'payroll-advance-over-max' : undefined
                  }
                >
                  <td>{line.name}</td>
                  <td>{formatMoney(line.earningsToDate)}</td>
                  <td>{formatMoney(line.maxClaimable)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.amountClaimed}
                      onChange={(value) => handleAdvanceChange(line, value)}
                      disabled={!canModifyAdvances}
                    />
                  </td>
                </tr>
              ))}
              {advanceLines.length > 0 && (
                <tr className="payroll-totals-row">
                  <td>
                    <strong>Totals</strong>
                  </td>
                  <td>{formatMoney(advanceTotals.earningsToDate)}</td>
                  <td>{formatMoney(advanceTotals.maxClaimable)}</td>
                  <td>{formatMoney(advanceTotals.amountClaimed)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedPeriod && (
          <PayrollSectionApprovalFooter
            sectionLabel="Advances"
            draftMessage="Advance amounts are editable. Approve before advance Friday payment; wages and salaries can still be edited separately."
            approval={advancesApproval}
            canApprove={canApprove}
            onApprove={() => onApprovePayrollSection(selectedPeriod.id, 'advances')}
            onRelease={() => onReleasePayrollSection(selectedPeriod.id, 'advances')}
          />
        )}

        <div className="rules-box">
          <strong>Advances:</strong> Max claimable = 50% of base earnings to advance Friday.
          Harvesters: daily base wage only (no kg incentive). Other wage staff: daily rate × days
          worked. Salaried staff: monthly salary prorated by calendar days in the period.
        </div>
      </PayrollSection>

      <PayrollSection title="Wages" isOpen={showWages} onToggle={() => setShowWages((prev) => !prev)}>
        <div className="form-grid payroll-toolbar">
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
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'sickLeaveDays', value)
                      }
                      disabled={!canModifyWages}
                      step="0.1"
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.compassionateLeaveDays}
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'compassionateLeaveDays', value)
                      }
                      disabled={!canModifyWages}
                      step="0.1"
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.maternityLeaveDays}
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'maternityLeaveDays', value)
                      }
                      disabled={!canModifyWages}
                      step="0.1"
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.unpaidLeaveDays}
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'unpaidLeaveDays', value)
                      }
                      disabled={!canModifyWages}
                      step="0.1"
                    />
                  </td>
                  <td>{formatMoney(line.regularPay)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.overtimeHours}
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'overtimeHours', value)
                      }
                      disabled={!canModifyWages}
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
                      onChange={(value) => handleWageAdvanceChange(line.employeeId, value)}
                      disabled={!canModifyAdvances}
                    />
                  </td>
                  <td>{formatMoney(line.maxSalaryAdvance)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.azimaSacco}
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'azimaSacco', value)
                      }
                      disabled={!canModifyWages}
                    />
                  </td>
                  <td>{formatMoney(line.shaDeductions)}</td>
                  <td>{formatMoney(line.nssf)}</td>
                  <td>{formatMoney(line.ahl)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.helb}
                      onChange={(value) => handleWageAdjustmentChange(line.employeeId, 'helb', value)}
                      disabled={!canModifyWages}
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.ppeDeductions}
                      onChange={(value) =>
                        handleWageAdjustmentChange(line.employeeId, 'ppeDeductions', value)
                      }
                      disabled={!canModifyWages}
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
                  <td>{wageTotals.daysWorked}</td>
                  <td colSpan="4"></td>
                  <td>{formatMoney(wageTotals.regularPay)}</td>
                  <td></td>
                  <td>{formatMoney(wageTotals.overtimePay)}</td>
                  <td></td>
                  <td>{formatMoney(wageTotals.totalIncentiveKes)}</td>
                  <td>{formatMoney(wageTotals.totalEarnings)}</td>
                  <td>{formatMoney(wageTotals.salaryAdvance)}</td>
                  <td></td>
                  <td>{formatMoney(wageTotals.azimaSacco)}</td>
                  <td>{formatMoney(wageTotals.shaDeductions)}</td>
                  <td>{formatMoney(wageTotals.nssf)}</td>
                  <td>{formatMoney(wageTotals.ahl)}</td>
                  <td>{formatMoney(wageTotals.helb)}</td>
                  <td>{formatMoney(wageTotals.ppeDeductions)}</td>
                  <td>
                    <strong>{formatMoney(wageTotals.netPay)}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedPeriod && (
          <PayrollSectionApprovalFooter
            sectionLabel="Wages"
            draftMessage="Seasonal and supplementary wage payroll is editable pending your approval at payment date."
            approval={wagesApproval}
            canApprove={canApprove}
            onApprove={() => onApprovePayrollSection(selectedPeriod.id, 'wages')}
            onRelease={() => onReleasePayrollSection(selectedPeriod.id, 'wages')}
          />
        )}

        <div className="rules-box">
          <strong>Wages:</strong> Regular pay = daily rate × (days worked + sick + compassionate +
          maternity leave). Overtime = hours × hourly rate × 1.5. SHA = max(KES 300, 2.75% of total
          earnings). NSSF = 6%. AHL = 1.5%.
        </div>
      </PayrollSection>

      <PayrollSection
        title="Salaries"
        isOpen={showSalaries}
        onToggle={() => setShowSalaries((prev) => !prev)}
      >
        <div className="table-wrap payroll-table-wrap">
          <table className="payroll-table payroll-salary-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Gross salary</th>
                <th>Overtime</th>
                <th>Allowances</th>
                <th>Backdated / unpaid leave</th>
                <th>Gross pay</th>
                <th>NSSF</th>
                <th>Tier 1</th>
                <th>Tier 2</th>
                <th>Pension</th>
                <th>AHL</th>
                <th>SHA</th>
                <th>Taxable salary</th>
                <th>Tax</th>
                <th>Tax relief</th>
                <th>PAYE</th>
                <th>HELB</th>
                <th>Total deductions</th>
                <th>Advance</th>
                <th>Max advance</th>
                <th>Azima Sacco</th>
                <th>Welfare</th>
                <th>Net pay</th>
              </tr>
            </thead>
            <tbody>
              {salaryLines.length === 0 && (
                <tr>
                  <td colSpan="24">No salaried employees with a monthly salary on record.</td>
                </tr>
              )}
              {salaryLines.map((line) => (
                <tr key={line.employeeId}>
                  <td>{line.name}</td>
                  <td>{line.department}</td>
                  <td>{formatMoney(line.grossSalary)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.overtime}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'overtime', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.allowances}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'allowances', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.backdatedPay}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'backdatedPay', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>{formatMoney(line.grossPay)}</td>
                  <td>{formatMoney(line.nssf)}</td>
                  <td>{formatMoney(line.nssfTier1)}</td>
                  <td>{formatMoney(line.nssfTier2)}</td>
                  <td>{formatMoney(line.pension)}</td>
                  <td>{formatMoney(line.ahl)}</td>
                  <td>{formatMoney(line.sha)}</td>
                  <td>{formatMoney(line.taxableSalary)}</td>
                  <td>{formatMoney(line.tax, 2)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.taxRelief}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'taxRelief', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>{formatMoney(line.paye, 2)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.helb}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'helb', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>{formatMoney(line.totalDeductions, 2)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.salaryAdvance}
                      onChange={(value) => handleSalaryAdvanceChange(line.employeeId, value)}
                      disabled={!canModifyAdvances}
                    />
                  </td>
                  <td>{formatMoney(line.maxSalaryAdvance)}</td>
                  <td>
                    <EditableNumberCell
                      value={line.azimaSacco}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'azimaSacco', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>
                    <EditableNumberCell
                      value={line.welfareContribution}
                      onChange={(value) =>
                        handleSalaryAdjustmentChange(line.employeeId, 'welfareContribution', value)
                      }
                      disabled={!canModifySalaries}
                    />
                  </td>
                  <td>
                    <strong>{formatMoney(line.netPay, 2)}</strong>
                  </td>
                </tr>
              ))}
              {salaryLines.length > 0 && (
                <tr className="payroll-totals-row">
                  <td colSpan="2">
                    <strong>Totals</strong>
                  </td>
                  <td>{formatMoney(salaryTotals.grossSalary)}</td>
                  <td colSpan="3"></td>
                  <td>{formatMoney(salaryTotals.grossPay)}</td>
                  <td>{formatMoney(salaryTotals.nssf)}</td>
                  <td colSpan="2"></td>
                  <td>{formatMoney(salaryTotals.pension)}</td>
                  <td>{formatMoney(salaryTotals.ahl)}</td>
                  <td>{formatMoney(salaryTotals.sha)}</td>
                  <td colSpan="3"></td>
                  <td>{formatMoney(salaryTotals.paye, 2)}</td>
                  <td></td>
                  <td>{formatMoney(salaryTotals.totalDeductions, 2)}</td>
                  <td>{formatMoney(salaryTotals.salaryAdvance)}</td>
                  <td></td>
                  <td>{formatMoney(salaryTotals.azimaSacco)}</td>
                  <td>{formatMoney(salaryTotals.welfareContribution)}</td>
                  <td>
                    <strong>{formatMoney(salaryTotals.netPay, 2)}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedPeriod && (
          <PayrollSectionApprovalFooter
            sectionLabel="Salaries"
            draftMessage="Regular staff salary payroll is editable pending your approval at payment date."
            approval={salariesApproval}
            canApprove={canApprove}
            onApprove={() => onApprovePayrollSection(selectedPeriod.id, 'salaries')}
            onRelease={() => onReleasePayrollSection(selectedPeriod.id, 'salaries')}
          />
        )}

        <div className="rules-box">
          <strong>Salaries:</strong> Gross pay = gross salary + overtime + allowances + backdated
          pay. NSSF = Tier 1 (540) + Tier 2 (min((gross pay − 9,000) × 5%, 5,940)). Pension = 5%.
          AHL = 1.5%. SHA = 2.75%. PAYE = tax − tax relief (default KES 2,400 personal relief; set to
          0 if not applicable). Net pay = gross pay − total deductions − advance − Sacco − welfare.
        </div>
      </PayrollSection>

      <PayrollSection
        title="Attendance exceptions"
        isOpen={showAttendanceExceptions}
        onToggle={() => setShowAttendanceExceptions((prev) => !prev)}
      >
        <p className="payroll-advance-intro">
          Monday–Saturday workdays in the selected pay period. Only abnormal attendance is listed:
          clock-out without a same-day clock-in (scanner left in the wrong mode), worked fewer than{' '}
          {MINIMUM_WORK_HOURS_PER_DAY} hours after clocking in, or forgot to clock out (system auto
          clock-out after {AUTO_CLOCK_OUT_HOURS} hours). Days with no scanner activity are omitted.
        </p>

        <div className="table-wrap payroll-table-wrap">
          <table className="payroll-table payroll-attendance-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Department</th>
                <th>Issue</th>
                <th>Hours worked</th>
              </tr>
            </thead>
            <tbody>
              {attendanceExceptionLines.length === 0 && (
                <tr>
                  <td colSpan="5">No attendance exceptions for this period.</td>
                </tr>
              )}
              {attendanceExceptionLines.map((line) => (
                <tr
                  key={`${line.employeeId}-${line.date}-${line.issue}`}
                  className={
                    line.issue === 'clock_out_without_clock_in'
                      ? 'payroll-attendance-row--orphan-clock-out'
                      : line.issue === 'auto_clock_out'
                        ? 'payroll-attendance-row--auto-clock-out'
                        : 'payroll-attendance-row--under-hours'
                  }
                >
                  <td>{formatDisplayDate(line.date)}</td>
                  <td>{line.name}</td>
                  <td>{line.department || '—'}</td>
                  <td>{getAttendanceExceptionLabel(line.issue)}</td>
                  <td>{line.hoursWorked.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rules-box">
          <strong>Attendance:</strong> Hours are calculated from clock-in and clock-out events in
          Kenya time. Missing clock-outs are assumed at {AUTO_CLOCK_OUT_HOURS} hours after
          clock-in for hour calculations and are flagged here as exceptions. Employees with no
          scanner events on a day are not listed.
        </div>
      </PayrollSection>
    </section>
  )
}
