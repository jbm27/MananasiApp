import { Router } from 'express'
import { getAppState, saveAppState } from '../stateStore.js'
import { mergeIncomingAppState } from '../stateMerge.js'
import { migrateLeadershipPasswordsFromMainState } from '../services/leadershipAuthStore.js'
import { syncClockedInIdsToAppState } from '../services/attendanceAutoClockOut.js'

const router = Router()

function stripSensitiveStateFields(data) {
  if (!data || typeof data !== 'object') {
    return {}
  }
  const { leaderPasswordHashes: _removed, ...safe } = data
  return safe
}

router.get('/', async (_req, res) => {
  try {
    await migrateLeadershipPasswordsFromMainState()
    await syncClockedInIdsToAppState()
    const state = await getAppState()
    if (!state) {
      return res.status(404).json({ error: 'No saved app state yet' })
    }
    res.json({
      ...stripSensitiveStateFields(state.data),
      _meta: { updatedAt: state.updatedAt },
    })
  } catch (error) {
    console.error('GET /api/state failed:', error)
    res.status(500).json({ error: 'Failed to load app state' })
  }
})

router.put('/', async (req, res) => {
  try {
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Expected JSON object body' })
    }
    await migrateLeadershipPasswordsFromMainState()
    const clockedInIds = await syncClockedInIdsToAppState()
    const current = await getAppState()
    const { _meta, leaderPasswordHashes: _ignored, clockedInIds: _clientClockedIn, ...incoming } = body
    const updatedAt = await saveAppState({
      ...mergeIncomingAppState(
        stripSensitiveStateFields(current?.data),
        stripSensitiveStateFields(incoming),
      ),
      clockedInIds,
    })
    res.json({ ok: true, updatedAt })
  } catch (error) {
    console.error('PUT /api/state failed:', error)
    res.status(500).json({ error: 'Failed to save app state' })
  }
})

export default router
