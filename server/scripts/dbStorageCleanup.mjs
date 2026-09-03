#!/usr/bin/env node
/**
 * Inspect Postgres table sizes and purge unbounded app_state_history rows.
 *
 * Usage (from repo root, with DATABASE_URL in server/.env or the environment):
 *   node server/scripts/dbStorageCleanup.mjs --analyze
 *   node server/scripts/dbStorageCleanup.mjs --purge-history
 *
 * Emergency on Railway when the volume is full — Postgres → Console:
 *   TRUNCATE app_state_history;
 */
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(scriptDir, '../.env') })

const { Pool } = pg

function getPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (add it to server/.env or the environment)')
  }
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  })
}

async function analyzeStorage(pool) {
  const tables = await pool.query(
    `SELECT c.relname AS table_name,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
            pg_total_relation_size(c.oid) AS bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'public'
     ORDER BY bytes DESC`,
  )

  console.log('\nTable sizes (public schema):')
  for (const row of tables.rows) {
    console.log(`  ${row.table_name.padEnd(24)} ${row.total_size}`)
  }

  const historyStats = await pool.query(
    `SELECT COUNT(*)::bigint AS row_count,
            pg_size_pretty(pg_total_relation_size('app_state_history')) AS table_size,
            pg_size_pretty(COALESCE(SUM(octet_length(previous_data::text) + octet_length(next_data::text)), 0)) AS json_payload_size
     FROM app_state_history`,
  )
  const stats = historyStats.rows[0]
  console.log('\napp_state_history:')
  console.log(`  rows:         ${stats.row_count}`)
  console.log(`  table size:   ${stats.table_size}`)
  console.log(`  JSON payload: ${stats.json_payload_size}`)

  const mainState = await pool.query(
    `SELECT pg_size_pretty(pg_total_relation_size('app_state')) AS table_size,
            pg_size_pretty(octet_length(data::text)) AS main_row_size
     FROM app_state
     WHERE id = 'main'`,
  )
  if (mainState.rowCount > 0) {
    console.log('\napp_state (main row):')
    console.log(`  table size: ${mainState.rows[0].table_size}`)
    console.log(`  data size:  ${mainState.rows[0].main_row_size}`)
  }

  const attendanceStats = await pool.query(
    `SELECT COUNT(*)::bigint AS row_count,
            pg_size_pretty(pg_total_relation_size('attendance_events')) AS table_size
     FROM attendance_events`,
  )
  const attendance = attendanceStats.rows[0]
  console.log('\nattendance_events:')
  console.log(`  rows:       ${attendance.row_count}`)
  console.log(`  table size: ${attendance.table_size}`)
}

async function purgeHistory(pool) {
  const before = await pool.query('SELECT COUNT(*)::bigint AS count FROM app_state_history')
  console.log(`Purging ${before.rows[0].count} app_state_history rows...`)
  await pool.query('TRUNCATE app_state_history')
  console.log('Done. app_state_history is empty.')
  console.log('Restart the API service, then redeploy with the updated server code.')
}

async function main() {
  const analyze = process.argv.includes('--analyze')
  const purge = process.argv.includes('--purge-history')
  if (!analyze && !purge) {
    console.log('Usage:')
    console.log('  node server/scripts/dbStorageCleanup.mjs --analyze')
    console.log('  node server/scripts/dbStorageCleanup.mjs --purge-history')
    process.exit(1)
  }

  const pool = getPool()
  try {
    if (analyze) {
      await analyzeStorage(pool)
    }
    if (purge) {
      await purgeHistory(pool)
      if (!analyze) {
        await analyzeStorage(pool)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
