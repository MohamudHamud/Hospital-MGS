const bcrypt = require('bcryptjs');
const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, bad, need, pick, audit, notFound, int } = require('../utils');
const { settings } = require('../services/clinical');

const r = Router();
const ROLES = ['admin', 'receptionist', 'doctor', 'nurse', 'lab', 'pharmacist', 'accountant'];
const USER_FIELDS = ['name', 'email', 'role', 'phone', 'department_id', 'specialization', 'consultation_fee', 'room', 'bio', 'active'];

/* ---------- Users ---------- */
r.get('/users', async (req, res) => {
  const p = [];
  let sql = `SELECT u.id,u.name,u.email,u.role,u.phone,u.department_id,u.specialization,u.consultation_fee,u.room,u.bio,u.active,u.last_login,u.created_at,d.name AS department
             FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE 1=1`;
  if (req.query.role) { sql += ' AND u.role=?'; p.push(req.query.role); }
  if (req.query.active) { sql += ' AND u.active=1'; }
  res.json(await db.query(sql + ' ORDER BY u.role, u.name', p));
});

r.post('/users', allow(), async (req, res) => {
  need(req.body, ['name', 'email', 'role', 'password']);
  if (!ROLES.includes(req.body.role)) throw bad('Invalid role');
  if (String(req.body.password).length < 6) throw bad('Password must be at least 6 characters');
  const d = pick(req.body, USER_FIELDS);
  d.email = String(d.email).trim().toLowerCase();
  d.password_hash = await bcrypt.hash(String(req.body.password), 10);
  d.consultation_fee = Number(d.consultation_fee || 0);
  d.active = d.active === undefined || d.active === null ? 1 : (d.active ? 1 : 0);
  const x = await db.query('INSERT INTO users SET ?', [d]);
  await audit(db, req.user, 'create', 'user', x.insertId, `${d.name} (${d.role})`);
  res.json({ id: x.insertId });
});

r.put('/users/:id', allow(), async (req, res) => {
  const d = pick(req.body, USER_FIELDS);
  if (d.role && !ROLES.includes(d.role)) throw bad('Invalid role');
  if (d.email) d.email = String(d.email).trim().toLowerCase();
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  if (d.consultation_fee !== undefined) d.consultation_fee = Number(d.consultation_fee || 0);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw bad('Password must be at least 6 characters');
    d.password_hash = await bcrypt.hash(String(req.body.password), 10);
  }
  if (Number(req.params.id) === req.user.id && d.active === 0) throw bad('You cannot deactivate your own account');
  if (!Object.keys(d).length) throw bad('Nothing to update');
  await db.query('UPDATE users SET ? WHERE id=?', [d, req.params.id]);
  await audit(db, req.user, 'update', 'user', req.params.id);
  res.json({ ok: true });
});

/* ---------- Departments ---------- */
r.get('/departments', async (req, res) => {
  res.json(await db.query(`SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id=d.id AND u.role='doctor' AND u.active=1) AS doctors
                           FROM departments d ORDER BY d.name`));
});
r.post('/departments', allow(), async (req, res) => {
  need(req.body, ['name']);
  const x = await db.query('INSERT INTO departments SET ?', [pick(req.body, ['name', 'description', 'room', 'icon', 'active'])]);
  await audit(db, req.user, 'create', 'department', x.insertId, req.body.name);
  res.json({ id: x.insertId });
});
r.put('/departments/:id', allow(), async (req, res) => {
  const d = pick(req.body, ['name', 'description', 'room', 'icon', 'active']);
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  await db.query('UPDATE departments SET ? WHERE id=?', [d, req.params.id]);
  res.json({ ok: true });
});

/* ---------- Services catalog ---------- */
r.get('/services', async (req, res) => res.json(await db.query('SELECT * FROM services ORDER BY category, name')));
r.post('/services', allow('accountant'), async (req, res) => {
  need(req.body, ['name', 'price']);
  const x = await db.query('INSERT INTO services SET ?', [pick(req.body, ['name', 'category', 'price', 'active'])]);
  res.json({ id: x.insertId });
});
r.put('/services/:id', allow('accountant'), async (req, res) => {
  const d = pick(req.body, ['name', 'category', 'price', 'active']);
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  await db.query('UPDATE services SET ? WHERE id=?', [d, req.params.id]);
  res.json({ ok: true });
});

/* ---------- Settings ---------- */
const SETTING_KEYS = ['hospital_name', 'tagline', 'address', 'phone', 'email', 'currency', 'slot_start', 'slot_end', 'slot_minutes', 'expiry_alert_days'];
r.get('/settings', async (req, res) => res.json(await settings(db)));
r.put('/settings', allow(), async (req, res) => {
  for (const k of SETTING_KEYS) {
    if (req.body[k] !== undefined) {
      await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, String(req.body[k])]);
    }
  }
  await audit(db, req.user, 'update', 'settings', null);
  res.json(await settings(db));
});

/* ---------- Audit ---------- */
r.get('/audit', allow(), async (req, res) => {
  const p = [];
  let sql = 'SELECT a.*, u.name AS user_name, u.role FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1';
  if (req.query.entity) { sql += ' AND a.entity=?'; p.push(req.query.entity); }
  if (req.query.q) { sql += ' AND (a.details LIKE ? OR a.action LIKE ? OR u.name LIKE ?)'; const q = `%${req.query.q}%`; p.push(q, q, q); }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  p.push(Math.min(int(req.query.limit, 300), 1000));
  res.json(await db.query(sql, p));
});

module.exports = r;
