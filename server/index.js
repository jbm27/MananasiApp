import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDb } from './db.js'
import stateRoutes from './routes/state.js'
import attendanceRoutes from './routes/attendance.js'
import iclockRoutes from './routes/iclock.js'
import leadershipAuthRoutes from './routes/leadershipAuth.js'

const app = express()
const port = Number(process.env.PORT ?? 3001)

const allowedOrigins = String(process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
  }),
)

app.use((req, _res, next) => {
  if (
    req.path.startsWith('/iclock') ||
    req.path.startsWith('/cdata') ||
    req.path.includes('cdata')
  ) {
    console.log(`[scanner-http] ${req.method} ${req.originalUrl}`)
  }
  next()
})

app.use('/iclock', express.text({ type: '*/*', limit: '2mb' }), iclockRoutes)
app.use(express.json({ limit: '15mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'mananasi-api' })
})

app.use('/api/state', stateRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/auth/leadership', leadershipAuthRoutes)

async function start() {
  await initDb()
  app.listen(port, () => {
    console.log(`Mananasi API listening on port ${port}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
