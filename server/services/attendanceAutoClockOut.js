import { getPool } from '../db.js'
import { recordAttendanceEvent } from './attendanceService.js'

/** Must match AUTO_CLOCK_OUT_HOURS in src/attendanceProcessing.js */
const AUTO_CLOCK_OUT_HOURS = 12
const AUTO_CLOCK_OUT_MS = AUTO_CLOCK_OUT_HOURS * 60 * 60 * 1000

export async function ensureAutoClockOutsPersisted(referenceNow = new Date()) {
  const cutoff = new Date(referenceNow.getTime() - AUTO_CLOCK_OUT_MS).toISOString()
  const result = await getPool().query(
    `WITH latest AS (
       SELECT DISTINCT ON (employee_id)
         employee_id,
         id,
         event_type,
         occurred_at
       FROM attendance_events
       ORDER BY employee_id, occurred_at DESC
     )
     SELECT employee_id AS "employeeId", id, occurred_at AS "occurredAt"
     FROM latest
     WHERE event_type = 'clock_in'
       AND occurred_at <= $1`,
    [cutoff],
  )

  const applied = []
  for (const row of result.rows) {
    const sourceEventId = `auto-12h-${row.id}`
    const autoOutTime = new Date(new Date(row.occurredAt).getTime() + AUTO_CLOCK_OUT_MS)
    try {
      const recorded = await recordAttendanceEvent({
        employeeId: row.employeeId,
        eventType: 'clock_out',
        occurredAt: autoOutTime.toISOString(),
        deviceId: 'AUTO-12H',
        sourceEventId,
      })
      if (!recorded.duplicate) {
        applied.push(row.employeeId)
      }
    } catch (error) {
      console.error(`Auto clock-out failed for ${row.employeeId}:`, error)
    }
  }

  return applied
}
