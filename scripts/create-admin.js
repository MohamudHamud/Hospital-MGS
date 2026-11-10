// Create (or reset the password of) an administrator account.
//   npm run create-admin
//   npm run create-admin -- --email admin@myhospital.com --name "Admin Name" --password "S3cure!pass"
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { withConnection } = require('../src/migrate');

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
function ask(q, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
  return new Promise((res) => rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); res(a.trim()); }));
}

(async () => {
  const email = (arg('email') || (await ask('Admin email: '))).toLowerCase();
  const name = arg('name') || (await ask('Full name: ')) || 'Administrator';
  const password = arg('password') || (await ask('Password (min 8 chars): ', true));
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');
  await withConnection(async (c) => {
    const hash = await bcrypt.hash(password, 10);
    const existing = await c.one('SELECT id FROM users WHERE email=?', [email]);
    if (existing) {
      await c.query("UPDATE users SET password_hash=?, role='admin', active=1, name=? WHERE id=?", [hash, name, existing.id]);
      console.log(`Updated ${email}: role admin, password reset.`);
    } else {
      await c.query("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?, 'admin')", [name, email, hash]);
      console.log(`Created admin ${email}.`);
    }
  });
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
