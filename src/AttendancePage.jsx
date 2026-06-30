import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAttendanceEventsForPeriod } from './api/client.js'
import {
  COMPASSIONATE_LEAVE_DAYS_PER_YEAR,
  SICK_LEAVE_DAYS_PER_YEAR,
  countLeaveDays,
  formatLeaveDays,
  getAnnualLeaveEntitlement,
  getCompassionateLeaveEntitlement,
  getLeaveSummaryPeriod,
  getLeaveTypeLabel,
  getSickLeaveEntitlement,
  LEAVE_TYPES,
  countWorkingDaysRemainingOnContract,
  summarizeLeaveForEmployee,
} from './leave.js'
import { countDaysWorkedFromAttendance } from './payroll.js'
import { toKenyaDateString } from './kenyaTime.js'

function CollapsibleSection({ title, isOpen, onToggle, children }) {
  return (
    <section className="collapsible-section">
      <button type="button" className="section-toggle" onClick={onToggle}>
        <span>{title}</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </section>
  )
}

function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

export default function AttendancePage({
  employees,
  clockedInIds,
  onRefreshAttendance,
  attendanceRefreshing,
  dateFrom,
  dateTo,
  getRoleLabel = (role) => role,
  leaveRecords,
  publicHolidays,
  onAddLeaveRecord,
  onRemoveLeaveRecord,
  onAddPublicHoliday,
  onRemovePublicHoliday,
  readOnly = false,
}) {
  const today = toKenyaDateString(new Date())
  const [showRegister, setShowRegister] = useState(false)
  const [showRecordLeave, setShowRecordLeave] = useState(false)
  const [showPublicHolidays, setShowPublicHolidays] = useState(false)
  const [periodFrom, setPeriodFrom] = useState(dateFrom)
  const [periodTo, setPeriodTo] = useState(dateTo)
  const [registerFilterMode, setRegisterFilterMode] = useState('date-range')
  const [periodAttendanceEvents, setPeriodAttendanceEvents] = useState([])
  const [periodLoading, setPeriodLoading] = useState(false)
  const [leaveEmployeeId, setLeaveEmployeeId] = useState('')
  const [leaveEmployeeSearch, setLeaveEmployeeSearch] = useState('')
  const [leaveEmployeePickerOpen, setLeaveEmployeePickerOpen] = useState(false)
  const [leaveType, setLeaveType] = useState('annual')
  const [leaveStartDate, setLeaveStartDate] = useState(today)
  const [leaveEndDate, setLeaveEndDate] = useState(today)
  const [leaveStatus, setLeaveStatus] = useState('')
  const [holidayDate, setHolidayDate] = useState(today)
  const [holidayName, setHolidayName] = useState('')
  const [holidayStatus, setHolidayStatus] = useState('')
  const [holidayYear, setHolidayYear] = useState(today.slice(0, 4))

  const clockedInCount = clockedInIds.length
  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  )
  const pendingLeaveDays = useMemo(
    () => countLeaveDays(leaveStartDate, leaveEndDate, publicHolidays),
    [leaveStartDate, leaveEndDate, publicHolidays],
  )
  const leaveEmployeeSearchQuery = leaveEmployeeSearch.trim().toLowerCase()
  const leaveEmployeeSearchResults = useMemo(() => {
    if (!leaveEmployeeSearchQuery) {
      return []
    }
    return sortedEmployees
      .filter((employee) => {
        const searchableText = [
          employee.name,
          employee.id,
          employee.phone,
          employee.email,
          employee.position,
          getRoleLabel(employee.role),
        ]
          .map((value) => String(value ?? '').toLowerCase())
          .join(' ')
        return searchableText.includes(leaveEmployeeSearchQuery)
      })
      .slice(0, 25)
  }, [sortedEmployees, leaveEmployeeSearchQuery, getRoleLabel])
  const selectedLeaveEmployee = useMemo(
    () => employees.find((employee) => employee.id === leaveEmployeeId) ?? null,
    [employees, leaveEmployeeId],
  )

  const loadPeriodAttendance = useCallback(async () => {
    if (!periodFrom || !periodTo) {
      setPeriodAttendanceEvents([])
      return
    }
    setPeriodLoading(true)
    try {
      const events = await fetchAttendanceEventsForPeriod(periodFrom, periodTo)
      setPeriodAttendanceEvents(events)
    } catch {
      setPeriodAttendanceEvents([])
    } finally {
      setPeriodLoading(false)
    }
  }, [periodFrom, periodTo])

  useEffect(() => {
    if (!showRegister) {
      return
    }
    loadPeriodAttendance()
  }, [showRegister, loadPeriodAttendance])

  const registerRows = useMemo(
    () =>
      sortedEmployees.map((employee) => {
        const leavePeriod = getLeaveSummaryPeriod(
          employee,
          registerFilterMode,
          periodFrom,
          periodTo,
          today,
        )
        const leaveSummary = leavePeriod
          ? summarizeLeaveForEmployee(
              leaveRecords,
              employee.id,
              leavePeriod.from,
              leavePeriod.to,
              publicHolidays,
            )
          : { annual: 0, sick: 0, compassionate: 0, unpaid: 0 }
        const contractDaysRemaining =
          registerFilterMode === 'contract-term'
            ? countWorkingDaysRemainingOnContract(employee.contractEndDate, publicHolidays, today)
            : null

        return {
          id: employee.id,
          name: employee.name,
          role: getRoleLabel(employee.role),
          clockedIn: clockedInIds.includes(employee.id),
          daysWorked: countDaysWorkedFromAttendance(
            periodAttendanceEvents,
            employee.id,
            periodFrom,
            periodTo,
          ),
          leaveSummary,
          contractDaysRemaining,
          annualEntitlement: getAnnualLeaveEntitlement(employee),
          sickEntitlement: getSickLeaveEntitlement(
            employee.contractStartDate,
            employee.contractEndDate,
          ),
          compassionateEntitlement: getCompassionateLeaveEntitlement(
            employee.contractStartDate,
            employee.contractEndDate,
          ),
        }
      }),
    [
      sortedEmployees,
      registerFilterMode,
      periodFrom,
      periodTo,
      today,
      leaveRecords,
      publicHolidays,
      clockedInIds,
      periodAttendanceEvents,
      getRoleLabel,
    ],
  )

  const holidaysForYear = useMemo(
    () =>
      [...publicHolidays]
        .filter((holiday) => holiday.date?.startsWith(holidayYear))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [publicHolidays, holidayYear],
  )

  const recentLeaveRecords = useMemo(
    () =>
      [...leaveRecords]
        .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.recordedAt.localeCompare(a.recordedAt))
        .slice(0, 50),
    [leaveRecords],
  )

  async function handleRefresh() {
    await onRefreshAttendance()
    await loadPeriodAttendance()
  }

  function handleLeaveEmployeeSearchChange(value) {
    setLeaveEmployeeSearch(value)
    setLeaveEmployeePickerOpen(true)
    setLeaveEmployeeId('')
  }

  function selectLeaveEmployee(employee) {
    setLeaveEmployeeId(employee.id)
    setLeaveEmployeeSearch(`${employee.name} (${employee.id})`)
    setLeaveEmployeePickerOpen(false)
  }

  function handleRecordLeave(event) {
    event.preventDefault()
    setLeaveStatus('')
    if (!leaveEmployeeId) {
      setLeaveStatus('Select an employee.')
      return
    }
    if (!leaveStartDate || !leaveEndDate) {
      setLeaveStatus('Enter leave start and end dates.')
      return
    }
    if (leaveStartDate > leaveEndDate) {
      setLeaveStatus('Leave end date must be on or after the start date.')
      return
    }
    if (pendingLeaveDays <= 0) {
      setLeaveStatus('The selected dates do not include any working leave days.')
      return
    }
    onAddLeaveRecord({
      employeeId: leaveEmployeeId,
      leaveType,
      startDate: leaveStartDate,
      endDate: leaveEndDate,
    })
    setLeaveStatus(`Recorded ${formatLeaveDays(pendingLeaveDays)} day(s) of ${getLeaveTypeLabel(leaveType).toLowerCase()}.`)
    setLeaveEmployeeId('')
    setLeaveEmployeeSearch('')
    setLeaveEndDate(leaveStartDate)
  }

  function handleAddHoliday(event) {
    event.preventDefault()
    setHolidayStatus('')
    const name = holidayName.trim()
    if (!holidayDate) {
      setHolidayStatus('Select a holiday date.')
      return
    }
    if (!name) {
      setHolidayStatus('Enter a holiday name.')
      return
    }
    if (publicHolidays.some((holiday) => holiday.date === holidayDate)) {
      setHolidayStatus('A public holiday is already recorded on that date.')
      return
    }
    onAddPublicHoliday({ date: holidayDate, name })
    setHolidayName('')
    setHolidayStatus(`Added ${name} on ${formatDisplayDate(holidayDate)}.`)
    setHolidayYear(holidayDate.slice(0, 4))
  }

  const sickLeaveHeader =
    registerFilterMode === 'contract-term'
      ? `Sick leave (max ${formatLeaveDays(SICK_LEAVE_DAYS_PER_YEAR)} p.a., pro-rata)`
      : 'Sick leave'
  const compassionateLeaveHeader =
    registerFilterMode === 'contract-term'
      ? `Compassionate leave (max ${formatLeaveDays(COMPASSIONATE_LEAVE_DAYS_PER_YEAR)} p.a., pro-rata)`
      : 'Compassionate leave'

  return (
    <section className="panel">
      <h2>Attendance</h2>
      <p>
        Review clock-in status, record employee leave, and manage Kenyan public holidays. Leave days
        exclude Sundays and public holidays; Saturdays count as working days.
      </p>

      <CollapsibleSection
        title="Register"
        isOpen={showRegister}
        onToggle={() => setShowRegister((prev) => !prev)}
      >
        <p className="inline-hint">
          <strong>{clockedInCount}</strong> of {employees.length} employees are clocked in right now.
          Days worked counts distinct clock-in days in the selected date range (Kenya time).
        </p>
        <div className="form-grid">
          <label>
            Period basis
            <select
              value={registerFilterMode}
              onChange={(event) => setRegisterFilterMode(event.target.value)}
            >
              <option value="date-range">Date range</option>
              <option value="contract-term">Contract term</option>
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={periodFrom}
              onChange={(event) => setPeriodFrom(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={periodTo}
              onChange={(event) => setPeriodTo(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={attendanceRefreshing || periodLoading}
          >
            {attendanceRefreshing || periodLoading ? 'Refreshing…' : 'Refresh clock-in status'}
          </button>
        </div>
        {registerFilterMode === 'contract-term' ? (
          <p className="inline-hint">
            Leave columns summarise days taken from each employee&apos;s contract start to the earlier
            of their contract end, today, and the &ldquo;To&rdquo; date above. Contract days remaining
            counts working days from today through contract end.
          </p>
        ) : (
          <p className="inline-hint">
            Leave columns summarise days taken within the date range above.
          </p>
        )}
        {periodLoading ? (
          <p className="inline-hint">Loading attendance for the selected period…</p>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Work No</th>
                <th>Name</th>
                <th>Role</th>
                <th>Clock-in status</th>
                <th>Days worked</th>
                <th>Annual leave</th>
                <th>{sickLeaveHeader}</th>
                <th>{compassionateLeaveHeader}</th>
                <th>Unpaid leave</th>
                {registerFilterMode === 'contract-term' ? <th>Contract days remaining</th> : null}
              </tr>
            </thead>
            <tbody>
              {registerRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <code>{row.id}</code>
                  </td>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td>
                    <span className={row.clockedIn ? 'badge badge-on' : 'badge badge-off'}>
                      {row.clockedIn ? 'Clocked In' : 'Not Clocked In'}
                    </span>
                  </td>
                  <td>{row.daysWorked}</td>
                  <td>
                    {formatLeaveDays(row.leaveSummary.annual)}
                    {registerFilterMode === 'contract-term' && row.annualEntitlement != null
                      ? ` / ${formatLeaveDays(row.annualEntitlement)}`
                      : ''}
                  </td>
                  <td>
                    {formatLeaveDays(row.leaveSummary.sick)}
                    {registerFilterMode === 'contract-term' && row.sickEntitlement != null
                      ? ` / ${formatLeaveDays(row.sickEntitlement)}`
                      : ''}
                  </td>
                  <td>
                    {formatLeaveDays(row.leaveSummary.compassionate)}
                    {registerFilterMode === 'contract-term' && row.compassionateEntitlement != null
                      ? ` / ${formatLeaveDays(row.compassionateEntitlement)}`
                      : ''}
                  </td>
                  <td>{formatLeaveDays(row.leaveSummary.unpaid)}</td>
                  {registerFilterMode === 'contract-term' ? (
                    <td>
                      {row.contractDaysRemaining == null
                        ? 'Open-ended'
                        : formatLeaveDays(row.contractDaysRemaining)}
                    </td>
                  ) : null}
                </tr>
              ))}
              {registerRows.length === 0 && (
                <tr>
                  <td colSpan={registerFilterMode === 'contract-term' ? 10 : 9}>
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Record leave"
        isOpen={showRecordLeave}
        onToggle={() => setShowRecordLeave((prev) => !prev)}
      >
        {readOnly ? (
          <p className="inline-hint">Director view: leave cannot be recorded or removed.</p>
        ) : (
          <form className="form-grid" onSubmit={handleRecordLeave}>
            <label className="employee-search-field employee-picker-field">
              Employee
              <div className="employee-picker">
                <input
                  type="search"
                  value={leaveEmployeeSearch}
                  onChange={(event) => handleLeaveEmployeeSearchChange(event.target.value)}
                  onFocus={() => setLeaveEmployeePickerOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setLeaveEmployeePickerOpen(false), 150)
                  }}
                  placeholder="Search by name, work no, phone, email, or role"
                  autoComplete="off"
                  required={!leaveEmployeeId}
                />
                {leaveEmployeePickerOpen && leaveEmployeeSearchQuery ? (
                  <ul className="employee-picker-results" role="listbox">
                    {leaveEmployeeSearchResults.map((employee) => (
                      <li key={employee.id}>
                        <button
                          type="button"
                          role="option"
                          className="employee-picker-option"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectLeaveEmployee(employee)}
                        >
                          <span>{employee.name}</span>
                          <code>{employee.id}</code>
                        </button>
                      </li>
                    ))}
                    {leaveEmployeeSearchResults.length === 0 ? (
                      <li className="employee-picker-empty">No matching employees.</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              {selectedLeaveEmployee ? (
                <p className="inline-hint">
                  Selected: {selectedLeaveEmployee.name} (<code>{selectedLeaveEmployee.id}</code>)
                </p>
              ) : null}
            </label>
            <label>
              Leave type
              <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}>
                {LEAVE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={leaveStartDate}
                onChange={(event) => setLeaveStartDate(event.target.value)}
                required
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={leaveEndDate}
                onChange={(event) => setLeaveEndDate(event.target.value)}
                required
              />
            </label>
            <p className="inline-hint">
              Leave days: <strong>{formatLeaveDays(pendingLeaveDays)}</strong> (excludes Sundays and
              public holidays)
            </p>
            <button type="submit">Record leave</button>
          </form>
        )}
        {leaveStatus ? <p className="inline-hint">{leaveStatus}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                {!readOnly ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {recentLeaveRecords.map((record) => {
                const employee = employees.find((item) => item.id === record.employeeId)
                return (
                  <tr key={record.id}>
                    <td>{employee?.name ?? record.employeeId}</td>
                    <td>{getLeaveTypeLabel(record.leaveType)}</td>
                    <td>{formatDisplayDate(record.startDate)}</td>
                    <td>{formatDisplayDate(record.endDate)}</td>
                    <td>
                      {formatLeaveDays(
                        countLeaveDays(record.startDate, record.endDate, publicHolidays),
                      )}
                    </td>
                    {!readOnly ? (
                      <td>
                        <button type="button" onClick={() => onRemoveLeaveRecord(record.id)}>
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
              {recentLeaveRecords.length === 0 && (
                <tr>
                  <td colSpan={readOnly ? 5 : 6}>No leave recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Public holidays"
        isOpen={showPublicHolidays}
        onToggle={() => setShowPublicHolidays((prev) => !prev)}
      >
        <p className="inline-hint">
          Assign Kenyan public holidays manually. These dates are excluded when calculating leave days
          and contract working days remaining.
        </p>
        {readOnly ? (
          <p className="inline-hint">Director view: public holidays cannot be changed.</p>
        ) : (
          <form className="form-grid" onSubmit={handleAddHoliday}>
            <label>
              Date
              <input
                type="date"
                value={holidayDate}
                onChange={(event) => setHolidayDate(event.target.value)}
                required
              />
            </label>
            <label>
              Holiday name
              <input
                type="text"
                value={holidayName}
                onChange={(event) => setHolidayName(event.target.value)}
                placeholder="e.g. Madaraka Day"
                required
              />
            </label>
            <button type="submit">Add public holiday</button>
          </form>
        )}
        {holidayStatus ? <p className="inline-hint">{holidayStatus}</p> : null}
        <div className="form-grid">
          <label>
            Calendar year
            <input
              type="number"
              min="2000"
              max="2100"
              value={holidayYear}
              onChange={(event) => setHolidayYear(event.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Holiday</th>
                {!readOnly ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {holidaysForYear.map((holiday) => {
                const dayName = new Date(`${holiday.date}T12:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'long',
                })
                return (
                  <tr key={holiday.id}>
                    <td>{formatDisplayDate(holiday.date)}</td>
                    <td>{dayName}</td>
                    <td>{holiday.name}</td>
                    {!readOnly ? (
                      <td>
                        <button type="button" onClick={() => onRemovePublicHoliday(holiday.id)}>
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
              {holidaysForYear.length === 0 && (
                <tr>
                  <td colSpan={readOnly ? 3 : 4}>No public holidays recorded for {holidayYear}.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}
