// Dump the database to backups/<db>-YYYYMMDD-HHMM.sql using mysqldump.
//   npm run backup
// Set MYSQLDUMP to the full path if mysqldump is not on PATH, e.g.
//   MYSQLDUMP="C:\Program Files\MySQL\MySQL Server 9.6\bin\mysqldump.exe"
// Restore with:  mysql -u USER -p DB_NAME < backups/file.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const db = process.env.DB_NAME || 'hospital_mgs';
const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const d = new Date();
const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
const file = path.join(dir, `${db}-${stamp}.sql`);
const out = fs.createWriteStream(file);

const p = spawn(process.env.MYSQLDUMP || 'mysqldump', [
  '-h', process.env.DB_HOST || 'localhost', '-P', String(process.env.DB_PORT || 3306), '-u', process.env.DB_USER,
  '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', db,
], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' } });
p.stdout.pipe(out);
p.stderr.on('data', (x) => process.stderr.write(x));
p.on('error', (e) => { console.error(`Could not run mysqldump (${e.message}). Set MYSQLDUMP to its full path.`); process.exit(1); });
p.on('close', (code) => {
  if (code !== 0) { fs.rmSync(file, { force: true }); console.error('Backup failed.'); process.exit(code || 1); }
  console.log(`Backup written: ${file}`);
});
