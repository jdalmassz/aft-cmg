require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool;

function config() {
  return {
    connectionString:
      process.env.DATABASE_URL ||
      `postgres://${process.env.PGUSER || 'aft'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'aft_cmg'}`,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

function connect() {
  pool = new Pool(config());
  pool.on('error', (err) => console.error('Error inesperado en la pool de PostgreSQL:', err.message));
  return pool;
}

function getPool() {
  if (!pool) connect();
  return pool;
}

async function initSchema() {
  const db = getPool();
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_seeds (nombre TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`
  );
  const seedFiles = ['seed_activos.sql', 'seed_limpieza_custodios.sql', 'seed_areas.sql'];
  const seedDir = path.join(__dirname, 'data');
  for (const f of seedFiles) {
    const p = path.join(seedDir, f);
    if (!fs.existsSync(p)) continue;
    const done = await db.query('SELECT 1 FROM schema_seeds WHERE nombre = $1', [f]);
    if (done.rowCount > 0) {
      console.log(`Seed ya aplicado: ${f}`);
      continue;
    }
    await db.query('BEGIN');
    try {
      await db.query(fs.readFileSync(p, 'utf8'));
      await db.query('INSERT INTO schema_seeds (nombre) VALUES ($1)', [f]);
      await db.query('COMMIT');
      console.log(`Seed aplicado: ${f}`);
    } catch (e) {
      await db.query('ROLLBACK');
      if (e.message.includes('duplicate key value violates unique constraint')) {
        console.log(`Seed omitido (datos ya presentes): ${f}`);
      } else {
        throw e;
      }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDb({ attempts = 12, delayMs = 5000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await getPool().query('SELECT version()');
      console.log(`PostgreSQL conectado (intento ${i}): ${r.rows[0].version.slice(0, 30)}`);
      return;
    } catch (e) {
      lastErr = e;
      console.log(`Esperando PostgreSQL (intento ${i}/${attempts}): ${e.message}`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

module.exports = { connect, getPool, initSchema, waitForDb };