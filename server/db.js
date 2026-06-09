import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const { Pool } = pg

let pool

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }
    pool = new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    })
  }
  return pool
}

export async function initDb() {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql')
  const schema = readFileSync(schemaPath, 'utf8')
  await getPool().query(schema)
}
