import { getPool } from './db.js'

const STATE_ID = 'main'

function toTimestampOrNull(value) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function sameTimestamp(left, right) {
  if (!left || !right) {
    return false
  }
  return left.getTime() === right.getTime()
}

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

/**
 * Persist app state without always bumping updated_at.
 * Use bumpVersion:false for side effects (attendance clockedInIds) that should not
 * invalidate concurrent client business-data saves.
 */
export async function saveAppState(data, { bumpVersion = true } = {}) {
  if (bumpVersion) {
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

  const result = await getPool().query(
    `INSERT INTO app_state (id, data, updated_at)
     VALUES ($1, $2::jsonb, COALESCE((SELECT updated_at FROM app_state WHERE id = $1), NOW()))
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data
     RETURNING updated_at`,
    [STATE_ID, JSON.stringify(data)],
  )
  return result.rows[0].updated_at
}

export async function saveAppStateWithGuard(
  data,
  { expectedUpdatedAt = null, changeSource = 'api', bumpVersion = true } = {},
) {
  const pool = getPool()
  const client = await pool.connect()
  const expectedTimestamp = toTimestampOrNull(expectedUpdatedAt)

  try {
    await client.query('BEGIN')

    const currentResult = await client.query(
      'SELECT data, updated_at FROM app_state WHERE id = $1 FOR UPDATE',
      [STATE_ID],
    )
    const currentRow = currentResult.rows[0] ?? null
    const previousData = currentRow?.data ?? {}
    const previousUpdatedAt = currentRow?.updated_at ?? null

    // Only enforce concurrency when the client explicitly provides a version.
    // Attendance / side-effect writers omit expectedUpdatedAt.
    if (expectedTimestamp && previousUpdatedAt && !sameTimestamp(previousUpdatedAt, expectedTimestamp)) {
      await client.query('ROLLBACK')
      return {
        ok: false,
        conflict: true,
        previousUpdatedAt,
        latestData: previousData,
      }
    }

    const nextResult = bumpVersion
      ? await client.query(
          `INSERT INTO app_state (id, data, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id)
           DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
           RETURNING updated_at`,
          [STATE_ID, JSON.stringify(data)],
        )
      : await client.query(
          `INSERT INTO app_state (id, data, updated_at)
           VALUES ($1, $2::jsonb, COALESCE((SELECT updated_at FROM app_state WHERE id = $1), NOW()))
           ON CONFLICT (id)
           DO UPDATE SET data = EXCLUDED.data
           RETURNING updated_at`,
          [STATE_ID, JSON.stringify(data)],
        )
    const nextUpdatedAt = nextResult.rows[0].updated_at

    await client.query(
      `INSERT INTO app_state_history (
        state_id,
        change_source,
        expected_updated_at,
        previous_updated_at,
        next_updated_at,
        previous_data,
        next_data
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        STATE_ID,
        String(changeSource || 'api'),
        expectedTimestamp,
        previousUpdatedAt,
        nextUpdatedAt,
        JSON.stringify(previousData),
        JSON.stringify(data),
      ],
    )

    await client.query('COMMIT')
    return {
      ok: true,
      conflict: false,
      updatedAt: nextUpdatedAt,
      previousUpdatedAt,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
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
  // Do not bump business-data version — otherwise open browser tabs fail every save
  // after any scanner clock event.
  await saveAppStateWithGuard(nextData, {
    changeSource: 'attendance',
    bumpVersion: false,
  })
  return clockedInIds
}
