require('dotenv').config();
const path = require('path');
const express = require('express');
const { auth } = require('./src/middleware/auth');
const db = require('./src/db');

const PROD = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET || (PROD && process.env.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET is missing (or shorter than 32 characters in production). Copy .env.example to .env and set it.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
// Behind nginx / a load balancer set TRUST_PROXY (e.g. "1") so client IPs (rate limiting) are correct.
app.set('trust proxy', process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (PROD && req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// Health check for load balancers / uptime monitors
app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true, db: 'up', time: new Date().toISOString() }); }
  catch { res.status(503).json({ ok: false, db: 'down' }); }
});

// Public (no login)
app.use('/api/public', require('./src/routes/public'));
app.use('/api/auth', require('./src/routes/auth'));

// Staff API (login required)
app.use('/api', auth);
for (const name of ['admin', 'dashboard', 'patients', 'appointments', 'visits', 'lab', 'pharmacy', 'inventory', 'finance', 'accounting']) {
  app.use('/api', require(`./src/routes/${name}`));
}
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));

// Front-ends
const pub = path.join(__dirname, 'public');
const cache = { maxAge: PROD ? '1h' : 0 };
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist'), cache));
app.use('/app', express.static(path.join(pub, 'app'), cache));
app.use('/display', express.static(path.join(pub, 'display'), cache));
app.use('/', express.static(path.join(pub, 'site'), cache));

// Errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with that value already exists (duplicate code, email or number).' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'A referenced record does not exist.' });
  if (err.code === 'ER_TRUNCATED_WRONG_VALUE' || err.code === 'WARN_DATA_TRUNCATED' || err.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD')
    return res.status(400).json({ error: 'One of the values has an invalid format.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const port = Number(process.env.PORT || 3000);

async function start() {
  // Apply pending database migrations before serving (disable with AUTO_MIGRATE=false).
  if (process.env.AUTO_MIGRATE !== 'false') {
    const { migrate, createDatabase } = require('./src/migrate');
    await createDatabase();
    const applied = await migrate(db);
    if (applied.length) console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
  }
  const users = await db.one('SELECT COUNT(*) n FROM users');
  if (!users.n) console.warn('\n  ⚠ No user accounts yet. Run:  npm run create-admin\n');
  const server = app.listen(port, () => {
    console.log(`\n  MediCircle HMS running (${PROD ? 'production' : 'development'})`);
    console.log(`  Patient website : http://localhost:${port}/`);
    console.log(`  Staff portal    : http://localhost:${port}/app/`);
    console.log(`  Queue display   : http://localhost:${port}/display/\n`);
  });
  const stop = () => { server.close(() => db.pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
start().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
