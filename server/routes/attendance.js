import { Router } from 'express'
import { getPool } from '../db.js'
import { recordAttendanceEvent } from '../services/attendanceService.js'

const router = Router()

router.post('/events', async (req, res) => {
  try {
    const { employeeId, eventType, occurredAt, deviceId, sourceEventId } = req.body ?? {}
    const result = await recordAttendanceEvent({
      employeeId,
      eventType,
      occurredAt,
      deviceId,
      sourceEventId,
    })
    res.status(result.duplicate ? 200 : 201).json(result)
  } catch (error) {
    const message = error.message ?? 'Failed to record attendance event'
    const status = message.includes('required') || message.includes('must be') ? 400 : 500
    console.error('POST /api/attendance/events failed:', error)
    res.status(status).json({ error: message })
  }
})

router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 5000)
    const fromDate = req.query.from ? String(req.query.from) : null
    const toDate = req.query.to ? String(req.query.to) : null
    const conditions = []
    const params = []

    if (fromDate) {
      params.push(fromDate)
      conditions.push(
        `(occurred_at AT TIME ZONE 'Africa/Nairobi')::date >= $${params.length}::date`,
      )
    }
    if (toDate) {
      params.push(toDate)
      conditions.push(
        `(occurred_at AT TIME ZONE 'Africa/Nairobi')::date <= $${params.length}::date`,
      )
    }

    params.push(limit)
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await getPool().query(
      `SELECT id, employee_id AS "employeeId", event_type AS "eventType",
              occurred_at AS "occurredAt", device_id AS "deviceId",
              source_event_id AS "sourceEventId", created_at AS "createdAt"
       FROM attendance_events
       ${whereClause}
       ORDER BY occurred_at DESC
       LIMIT $${params.length}`,
      params,
    )
    res.json(result.rows)
  } catch (error) {
    console.error('GET /api/attendance/events failed:', error)
    res.status(500).json({ error: 'Failed to load attendance events' })
  }
})

export default router
