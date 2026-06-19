import { Router } from 'express'
import {
  changeLeadershipPasswordForUser,
  listLeadershipAccountsForAdmin,
  setLeadershipPasswordForAdmin,
  verifyLeadershipLogin,
} from '../services/leadershipAuth.js'

const router = Router()

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {}
    const result = await verifyLeadershipLogin(username, password)
    if (!result.ok) {
      return res.status(401).json({ error: result.error })
    }
    res.json(result.employee)
  } catch (error) {
    console.error('POST /api/auth/leadership/login failed:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

router.post('/accounts', async (req, res) => {
  try {
    const { adminEmployeeId, adminPassword } = req.body ?? {}
    const result = await listLeadershipAccountsForAdmin(adminEmployeeId, adminPassword)
    if (!result.ok) {
      return res.status(403).json({ error: result.error })
    }
    res.json({ accounts: result.accounts })
  } catch (error) {
    console.error('POST /api/auth/leadership/accounts failed:', error)
    res.status(500).json({ error: 'Failed to load leadership accounts' })
  }
})

router.post('/change-password', async (req, res) => {
  try {
    const result = await changeLeadershipPasswordForUser(req.body ?? {})
    if (!result.ok) {
      return res.status(403).json({ error: result.error })
    }
    res.json({ ok: true })
  } catch (error) {
    console.error('POST /api/auth/leadership/change-password failed:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

router.post('/set-password', async (req, res) => {
  try {
    const result = await setLeadershipPasswordForAdmin(req.body ?? {})
    if (!result.ok) {
      return res.status(403).json({ error: result.error })
    }
    res.json({ ok: true })
  } catch (error) {
    console.error('POST /api/auth/leadership/set-password failed:', error)
    res.status(500).json({ error: 'Failed to save password' })
  }
})

export default router
