// Versioned database migrations.
//   npm run migrate           apply pending migrations (creates the database if missing)
//   npm run migrate:status    list applied / pending migrations
//
// Migrations live in /migrations and run in file-name order:
//   NNN_description.sql   plain SQL, statements separated by ";" at line end
//   NNN_description.js    exports async up(c) where c = { query, one }
// Applied versions are recorded in the schema_migrations table. Never edit a
// migration that has been deployed; add a new numbered file instead.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DIR = path.join(__dirname, '..', 'migrations');
const DB = process.env.DB_NAME || 'hospital_mgs';
if (!/^[A-Za-z0-9_]+$/.test(DB)) throw new Error('DB_NAME may only contain letters, digits and underscores');

const connOpts = () => ({
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, dateStrings: true, decimalNumbers: true,
});

async function createDatabase() {
  const conn = await mysql.createConnection(connOpts());
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) {
    // A restricted app user may not be allowed to create databases; that is fine if it already exists.
    if (!['ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(e.code)) throw e;
  } finally {
    await conn.end();
  }
}

function splitSql(sql) {
  return sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n')
    .split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
}

function files() {
  return fs.readdirSync(DIR).filter((f) => /^\d+_[\w-]+\.(sql|js)$/.test(f)).sort();
}

// c = { query, one } bound to a connection or pool on the target database
async function migrate(c, { log = console.log } = {}) {
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(120) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const done = new Set((await c.query('SELECT version FROM schema_migrations')).map((r) => r.version));
  const pending = files().filter((f) => !done.has(f));
  for (const f of pending) {
    log(`  → applying ${f}`);
    const full = path.join(DIR, f);
    if (f.endsWith('.sql')) {
      for (const stmt of splitSql(fs.readFileSync(full, 'utf8'))) await c.query(stmt);
    } else {
      await require(full).up(c);
    }
    await c.query('INSERT INTO schema_migrations (version) VALUES (?)', [f]);
  }
  return pending;
}

async function withConnection(fn) {
  await createDatabase();
  const conn = await mysql.createConnection({ ...connOpts(), database: DB });
  const q = async (sql, p) => (await conn.query(sql, p))[0];
  try { return await fn({ query: q, one: async (sql, p) => (await q(sql, p))[0] || null }); } finally { await conn.end(); }
}

async function status() {
  return withConnection(async (c) => {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    const applied = new Map((await c.query('SELECT version, applied_at FROM schema_migrations')).map((r) => [r.version, r.applied_at]));
    for (const f of files()) console.log(`  ${applied.has(f) ? '✔ applied ' + applied.get(f) : '… pending            '}  ${f}`);
  });
}

module.exports = { migrate, createDatabase, withConnection, DB };

if (require.main === module) {
  const run = process.argv.includes('--status') ? status()
    : withConnection(async (c) => {
      console.log(`Migrating database "${DB}"...`);
      const applied = await migrate(c);
      console.log(applied.length ? `Done. Applied ${applied.length} migration(s).` : 'Database is up to date.');
    });
  run.catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
}
