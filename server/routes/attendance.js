import { Router } from 'express'
import { getPool } from '../db.js'
import { applyClockEvent } from '../stateStore.js'

const router = Router()

function buildEventId(sourceEventId, employeeId, eventType, occurredAt) {
  return sourceEventId ?? `${employeeId}-${eventType}-${occurredAt}`
}

router.post('/events', async (req, res) => {
  try {
    const { employeeId, eventType, occurredAt, deviceId, sourceEventId } = req.body ?? {}

    if (!employeeId || !eventType) {
      return res.status(400).json({ error: 'employeeId and eventType are required' })
    }
    if (eventType !== 'clock_in' && eventType !== 'clock_out') {
      return res.status(400).json({ error: 'eventType must be clock_in or clock_out' })
    }

    const timestamp = occurredAt ? new Date(occurredAt) : new Date()
    if (Number.isNaN(timestamp.getTime())) {
      return res.status(400).json({ error: 'occurredAt must be a valid date/time' })
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
        const clockedInIds = (await applyClockEvent({ employeeId, eventType })) ?? []
        return res.json({ ok: true, duplicate: true, clockedInIds })
      }
      throw error
    }

    const clockedInIds = await applyClockEvent({ employeeId, eventType })
    res.status(201).json({ ok: true, id, clockedInIds })
  } catch (error) {
    console.error('POST /api/attendance/events failed:', error)
    res.status(500).json({ error: 'Failed to record attendance event' })
  }
})

router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500)
    const result = await getPool().query(
      `SELECT id, employee_id AS "employeeId", event_type AS "eventType",
              occurred_at AS "occurredAt", device_id AS "deviceId",
              source_event_id AS "sourceEventId", created_at AS "createdAt"
       FROM attendance_events
       ORDER BY occurred_at DESC
       LIMIT $1`,
      [limit],
    )
    res.json(result.rows)
  } catch (error) {
    console.error('GET /api/attendance/events failed:', error)
    res.status(500).json({ error: 'Failed to load attendance events' })
  }
})

export default router
