import { Router } from 'express'
import { getAppState, saveAppState } from '../stateStore.js'

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const state = await getAppState()
    if (!state) {
      return res.status(404).json({ error: 'No saved app state yet' })
    }
    res.json({
      ...state.data,
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
    const { _meta, ...data } = body
    const updatedAt = await saveAppState(data)
    res.json({ ok: true, updatedAt })
  } catch (error) {
    console.error('PUT /api/state failed:', error)
    res.status(500).json({ error: 'Failed to save app state' })
  }
})

export default router
