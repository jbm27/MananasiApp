import { getPool } from '../db.js'
import { applyClockEvent } from '../stateStore.js'

function buildEventId(sourceEventId, employeeId, eventType, occurredAt) {
  return sourceEventId ?? `${employeeId}-${eventType}-${occurredAt}`
}

/** One-time / idempotent remaps for employees who missed the work-number migration. */
const LEGACY_ATTENDANCE_EMPLOYEE_IDS = new Map([
  ['5068', '0104'], // Brian Mwinami Nyangule
  ['5069', '0105'], // Grainton Pamba Ameyo
  ['5071', '0102'], // Tomas Jumbi Akhonya
  ['5072', '0103'], // Timothy Kamau Ndungu
  ['1022', 'D001'], // Zeid Shehadeh
  ['1024', 'D002'], // Riikka Juva
  ['1025', 'D003'], // Raquel Prado
  ['1023', 'D004'], // Zakariya Ali Musleh
  ['1026', 'D005'], // Zainab Haquon
])

export async function remapLegacyAttendanceEmployeeIds() {
  const pool = getPool()
  let total = 0
  for (const [oldId, newId] of LEGACY_ATTENDANCE_EMPLOYEE_IDS) {
    const result = await pool.query(
      `UPDATE attendance_events SET employee_id = $2 WHERE employee_id = $1`,
      [oldId, newId],
    )
    total += result.rowCount ?? 0
  }
  return total
}

export async function recordAttendanceEvent({
  employeeId,
  eventType,
  occurredAt,
  deviceId,
  sourceEventId,
}) {
  if (!employeeId || !eventType) {
    throw new Error('employeeId and eventType are required')
  }
  if (eventType !== 'clock_in' && eventType !== 'clock_out') {
    throw new Error('eventType must be clock_in or clock_out')
  }

  const timestamp = occurredAt ? new Date(occurredAt) : new Date()
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('occurredAt must be a valid date/time')
  }

  const id = buildEventId(sourceEventId, employeeId, eventType, timestamp.toISOString())

  try {
    await getPool().query(
      `INSERT INTO attendance_events (id, employee_id, event_type, occurred_at, device_id, source_event_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, employeeId, eventType, timestamp.toISOString(), deviceId ?? null, sourceEventId ?? id],
    )
  } catch (error) {
    if (error.code === '23505') {
      const clockedInIds = await applyClockEvent({ employeeId, eventType })
      return { ok: true, duplicate: true, id, clockedInIds }
    }
    throw error
  }

  const clockedInIds = await applyClockEvent({ employeeId, eventType })
  return { ok: true, duplicate: false, id, clockedInIds }
}
