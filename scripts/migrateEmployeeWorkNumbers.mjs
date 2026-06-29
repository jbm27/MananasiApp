#!/usr/bin/env node
/**
 * One-time migration: renumber employees to official 0001–0106 work numbers.
 *
 * Usage (from repo root, with server/.env containing DATABASE_URL):
 *   node scripts/migrateEmployeeWorkNumbers.mjs
 *
 * Dry run (no writes):
 *   node scripts/migrateEmployeeWorkNumbers.mjs --dry-run
 */
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { mananasiStaffEmployees } from '../src/mananasiStaffEmployees.js'
import { buildEmployeeIdMap } from '../src/employeeWorkNumberAssignments.js'
import {
  remapEmployeeIdsInAppState,
  remapLeadershipPasswordHashes,
} from '../src/employeeIdMigration.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const require = createRequire(path.join(root, 'server', 'index.js'))
const pg = require('pg')
const dryRun = process.argv.includes('--dry-run')

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

const idMap = buildEmployeeIdMap(mananasiStaffEmployees)
if (idMap.size === 0) {
  console.log('No employee ID changes required.')
  process.exit(0)
}

console.log(`Planned employee ID changes (${idMap.size}):`)
for (const [oldId, newId] of [...idMap.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  const employee = mananasiStaffEmployees.find((item) => item.id === oldId)
  console.log(`  ${oldId} -> ${newId}  ${employee?.name ?? ''}`)
}

const unmigrated = mananasiStaffEmployees.filter(
  (employee) => !idMap.has(employee.id) && !/^\d{4}$/.test(employee.id),
)
if (unmigrated.length > 0) {
  console.log('\nEmployees kept on existing IDs (not in official list):')
  for (const employee of unmigrated) {
    console.log(`  ${employee.id}  ${employee.name}`)
  }
}

async function migrateDatabase() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.warn('\nDATABASE_URL not set — skipping database migration.')
    return
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  })

  try {
    const mainResult = await pool.query(`SELECT data FROM app_state WHERE id = 'main'`)
    if (mainResult.rowCount === 0) {
      console.warn('No main app_state row found.')
    } else {
      const current = mainResult.rows[0].data ?? {}
      const employees = Array.isArray(current.employees) ? current.employees : mananasiStaffEmployees
      const dbIdMap = buildEmployeeIdMap(employees)
      for (const [oldId, newId] of idMap) {
        dbIdMap.set(oldId, newId)
      }
      const nextData = remapEmployeeIdsInAppState(current, dbIdMap)
      if (dryRun) {
        console.log('\n[dry-run] Would update app_state main row.')
      } else {
        await pool.query(
          `UPDATE app_state SET data = $1::jsonb, updated_at = NOW() WHERE id = 'main'`,
          [JSON.stringify(nextData)],
        )
        console.log('\nUpdated app_state (main).')
      }
    }

    const passwordResult = await pool.query(`SELECT data FROM app_state WHERE id = 'leadership-passwords'`)
    if (passwordResult.rowCount > 0) {
      const hashes = passwordResult.rows[0].data?.hashes
      const nextHashes = remapLeadershipPasswordHashes(hashes, idMap)
      if (dryRun) {
        console.log('[dry-run] Would update leadership password hashes.')
      } else {
        await pool.query(
          `UPDATE app_state SET data = $1::jsonb, updated_at = NOW() WHERE id = 'leadership-passwords'`,
          [JSON.stringify({ hashes: nextHashes })],
        )
        console.log('Updated leadership password hashes.')
      }
    }

    for (const [oldId, newId] of idMap) {
      if (dryRun) {
        const count = await pool.query(
          `SELECT COUNT(*)::int AS count FROM attendance_events WHERE employee_id = $1`,
          [oldId],
        )
        if (count.rows[0].count > 0) {
          console.log(`[dry-run] Would update ${count.rows[0].count} attendance events ${oldId} -> ${newId}`)
        }
      } else {
        const updated = await pool.query(
          `UPDATE attendance_events SET employee_id = $2 WHERE employee_id = $1`,
          [oldId, newId],
        )
        if (updated.rowCount > 0) {
          console.log(`Updated ${updated.rowCount} attendance events: ${oldId} -> ${newId}`)
        }
      }
    }
  } finally {
    await pool.end()
  }
}

function migrateStaffSeedFile() {
  const staffPath = path.join(root, 'src', 'mananasiStaffEmployees.js')
  let content = readFileSync(staffPath, 'utf8')
  for (const [oldId, newId] of idMap) {
    content = content.replaceAll(`"id": "${oldId}"`, `"id": "${newId}"`)
  }
  if (dryRun) {
    console.log('\n[dry-run] Would update src/mananasiStaffEmployees.js')
    return
  }
  writeFileSync(staffPath, content, 'utf8')
  console.log('\nUpdated src/mananasiStaffEmployees.js')
}

await migrateDatabase()
migrateStaffSeedFile()

console.log(dryRun ? '\nDry run complete. Re-run without --dry-run to apply.' : '\nMigration complete.')
