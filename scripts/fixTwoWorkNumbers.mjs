#!/usr/bin/env node
/**
 * Remap two employees who missed the work-number migration:
 *   5068 Brian Mwinami Nyangule -> 0104
 *   5069 Grainton Pamba Ameyo   -> 0105
 *
 * Usage (from repo root):
 *   node scripts/fixTwoWorkNumbers.mjs
 *   node scripts/fixTwoWorkNumbers.mjs --dry-run
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { remapEmployeeIdsInAppState } from '../src/employeeIdMigration.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const require = createRequire(path.join(root, 'server', 'index.js'))
const pg = require('pg')
const dryRun = process.argv.includes('--dry-run')

const ID_MAP = new Map([
  ['5068', '0104'],
  ['5069', '0105'],
])

const EXPECTED_NAMES = {
  5068: /brian.*nyangule/i,
  5069: /(?:grainton|graiton|graiston).*pamba/i,
}

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const separator = trimmed.indexOf('=')
      if (separator === -1) {
        continue
      }
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // optional env file
  }
}

loadEnvFile(path.join(root, 'server', '.env'))
loadEnvFile(path.join(root, '.env'))

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
})

try {
  const mainResult = await pool.query(`SELECT data FROM app_state WHERE id = 'main'`)
  if (mainResult.rowCount === 0) {
    console.error('No main app_state row found.')
    process.exit(1)
  }

  const current = mainResult.rows[0].data ?? {}
  const employees = Array.isArray(current.employees) ? current.employees : []
  const pending = new Map()

  for (const [oldId, newId] of ID_MAP) {
    const employee = employees.find((item) => String(item.id) === oldId)
    if (!employee) {
      const already = employees.find((item) => String(item.id) === newId)
      console.log(
        already
          ? `OK: ${oldId} already remapped; ${newId} is ${already.name}`
          : `WARN: neither ${oldId} nor ${newId} found`,
      )
      continue
    }
    const expected = EXPECTED_NAMES[oldId]
    if (expected && !expected.test(employee.name ?? '')) {
      console.error(`Refusing remap ${oldId}: unexpected name "${employee.name}"`)
      process.exit(1)
    }
    const collision = employees.find((item) => String(item.id) === newId)
    if (collision) {
      console.error(`Cannot remap ${oldId} -> ${newId}: ${newId} already used by ${collision.name}`)
      process.exit(1)
    }
    console.log(`Will remap ${oldId} -> ${newId}  ${employee.name}`)
    pending.set(oldId, newId)
  }

  if (pending.size === 0) {
    console.log('\nNothing to change.')
    process.exit(0)
  }

  const nextData = remapEmployeeIdsInAppState(current, pending)

  if (dryRun) {
    console.log('\n[dry-run] Would update app_state and attendance_events.')
  } else {
    await pool.query(
      `UPDATE app_state SET data = $1::jsonb, updated_at = NOW() WHERE id = 'main'`,
      [JSON.stringify(nextData)],
    )
    console.log('\nUpdated app_state (main).')

    for (const [oldId, newId] of pending) {
      const updated = await pool.query(
        `UPDATE attendance_events SET employee_id = $2 WHERE employee_id = $1`,
        [oldId, newId],
      )
      console.log(`Attendance events ${oldId} -> ${newId}: ${updated.rowCount} row(s)`)
    }
  }
} finally {
  await pool.end()
}

console.log(dryRun ? '\nDry run complete.' : '\nDone.')
