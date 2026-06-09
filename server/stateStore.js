import { getPool } from './db.js'

const STATE_ID = 'main'

export async function getAppState() {
  const result = await getPool().query('SELECT data, updated_at FROM app_state WHERE id = $1', [
    STATE_ID,
  ])
  if (result.rowCount === 0) {
    return null
  }
  return {
    data: result.rows[0].data,
    updatedAt: result.rows[0].updated_at,
  }
}

export async function saveAppState(data) {
  const result = await getPool().query(
    `INSERT INTO app_state (id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
     RETURNING updated_at`,
    [STATE_ID, JSON.stringify(data)],
  )
  return result.rows[0].updated_at
}

export async function applyClockEvent({ employeeId, eventType }) {
  const current = await getAppState()
  const data = current?.data ?? {}
  const clockedInIds = Array.isArray(data.clockedInIds) ? [...data.clockedInIds] : []

  if (eventType === 'clock_in' && !clockedInIds.includes(employeeId)) {
    clockedInIds.push(employeeId)
  }
  if (eventType === 'clock_out') {
    const index = clockedInIds.indexOf(employeeId)
    if (index >= 0) {
      clockedInIds.splice(index, 1)
    }
  }

  const nextData = {
    ...data,
    clockedInIds,
  }
  await saveAppState(nextData)
  return clockedInIds
}
