import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAttendanceEventsForPeriod } from './api/client.js'
import { countDaysWorkedFromAttendance } from './payroll.js'

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

export default function AttendancePage({
  employees,
  clockedInIds,
  onRefreshAttendance,
  attendanceRefreshing,
  dateFrom,
  dateTo,
  getRoleLabel = (role) => role,
}) {
  const [showRegister, setShowRegister] = useState(false)
  const [periodFrom, setPeriodFrom] = useState(dateFrom)
  const [periodTo, setPeriodTo] = useState(dateTo)
  const [periodAttendanceEvents, setPeriodAttendanceEvents] = useState([])
  const [periodLoading, setPeriodLoading] = useState(false)

  const clockedInCount = clockedInIds.length

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
      employees
        .map((employee) => ({
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
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees, clockedInIds, periodAttendanceEvents, periodFrom, periodTo, getRoleLabel],
  )

  async function handleRefresh() {
    await onRefreshAttendance()
    await loadPeriodAttendance()
  }

  return (
    <section className="panel">
      <h2>Attendance</h2>
      <p>
        Review clock-in status and days worked from biometric scanner events. Scanner User ID on each
        device matches the employee work number.
      </p>

      <CollapsibleSection
        title="Register"
        isOpen={showRegister}
        onToggle={() => setShowRegister((prev) => !prev)}
      >
        <p className="inline-hint">
          <strong>{clockedInCount}</strong> of {employees.length} employees are clocked in right now.
          Days worked counts distinct clock-in days in the selected period (Kenya time).
        </p>
        <div className="form-grid">
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
                </tr>
              ))}
              {registerRows.length === 0 && (
                <tr>
                  <td colSpan="5">No employees found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}
