import { Router } from 'express'
import { getAppState, saveAppStateWithGuard } from '../stateStore.js'
import { mergeIncomingAppState, sanitizeAppStateForRead } from '../stateMerge.js'
import { migrateLeadershipPasswordsFromMainState } from '../services/leadershipAuthStore.js'
import { syncClockedInIdsToAppState } from '../services/attendanceAutoClockOut.js'
import { remapLegacyAttendanceEmployeeIds } from '../services/attendanceService.js'

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
    await remapLegacyAttendanceEmployeeIds()
    await syncClockedInIdsToAppState()
    const state = await getAppState()
    if (!state) {
      return res.status(404).json({ error: 'No saved app state yet' })
    }
    res.json({
      ...sanitizeAppStateForRead(stripSensitiveStateFields(state.data)),
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
    await remapLegacyAttendanceEmployeeIds()
    const clockedInIds = await syncClockedInIdsToAppState()
    const current = await getAppState()
    const { _meta, leaderPasswordHashes: _ignored, clockedInIds: _clientClockedIn, ...incoming } = body
    const saveResult = await saveAppStateWithGuard(
      {
      ...mergeIncomingAppState(
        stripSensitiveStateFields(current?.data),
        stripSensitiveStateFields(incoming),
      ),
      clockedInIds,
      },
      {
        expectedUpdatedAt: _meta?.expectedUpdatedAt ?? null,
        changeSource: _meta?.changeSource ?? 'api',
      },
    )
    if (saveResult.conflict) {
      return res.status(409).json({
        error: 'Data changed on another device/session. Reload latest data before saving again.',
        code: 'STATE_VERSION_CONFLICT',
        latestUpdatedAt: saveResult.previousUpdatedAt,
      })
    }
    res.json({ ok: true, updatedAt: saveResult.updatedAt })
  } catch (error) {
    console.error('PUT /api/state failed:', error)
    res.status(500).json({ error: 'Failed to save app state' })
  }
})

export default router
