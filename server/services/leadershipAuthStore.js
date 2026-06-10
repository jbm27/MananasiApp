import { getAppState, saveAppState } from '../stateStore.js'
import { getPool } from '../db.js'

const PASSWORDS_STATE_ID = 'leadership-passwords'

async function readPasswordRow() {
  const result = await getPool().query('SELECT data FROM app_state WHERE id = $1', [
    PASSWORDS_STATE_ID,
  ])
  if (result.rowCount === 0) {
    return {}
  }
  const hashes = result.rows[0].data?.hashes
  return hashes && typeof hashes === 'object' ? hashes : {}
}

async function writePasswordRow(hashes) {
  await getPool().query(
    `INSERT INTO app_state (id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [PASSWORDS_STATE_ID, JSON.stringify({ hashes })],
  )
}

export async function migrateLeadershipPasswordsFromMainState() {
  const main = await getAppState()
  const legacy = main?.data?.leaderPasswordHashes
  if (!legacy || typeof legacy !== 'object' || Object.keys(legacy).length === 0) {
    return
  }

  const existing = await readPasswordRow()
  const merged = { ...legacy, ...existing }
  await writePasswordRow(merged)

  const { leaderPasswordHashes: _removed, ...rest } = main.data
  await saveAppState(rest)
}

export async function getLeadershipPasswordHashes() {
  await migrateLeadershipPasswordsFromMainState()
  return readPasswordRow()
}

export async function setLeadershipPasswordHash(employeeId, hash) {
  const hashes = await getLeadershipPasswordHashes()
  hashes[employeeId] = hash
  await writePasswordRow(hashes)
}
