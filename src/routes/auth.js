const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { Router, bad, need, audit, HttpError } = require('../utils');

const r = Router();

// Very small in-memory brute-force guard.
const attempts = new Map();
function tooMany(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(key, a);
  return a.length >= 10;
}

r.post('/login', async (req, res) => {
  need(req.body, ['email', 'password']);
  const email = String(req.body.email).trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  if (tooMany(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const u = await db.one('SELECT u.*, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.email=?', [email]);
  if (!u || !u.active || !(await bcrypt.compare(String(req.body.password), u.password_hash))) {
    attempts.get(key).push(Date.now());
    throw new HttpError(401, 'Invalid email or password');
  }
  attempts.delete(key);
  await db.query('UPDATE users SET last_login=NOW() WHERE id=?', [u.id]);
  const user = { id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, department_id: u.department_id };
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
  await audit(db, user, 'login', 'user', u.id);
  res.json({ token, user });
});

r.get('/me', auth, async (req, res) => {
  const u = await db.one('SELECT id, name, email, role, phone, department_id, specialization, room FROM users WHERE id=? AND active=1', [req.user.id]);
  if (!u) throw new HttpError(401, 'Account disabled');
  res.json(u);
});

r.post('/change-password', auth, async (req, res) => {
  need(req.body, ['current_password', 'new_password']);
  if (String(req.body.new_password).length < 6) throw bad('New password must be at least 6 characters');
  const u = await db.one('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.current_password), u.password_hash))) throw bad('Current password is incorrect');
  await db.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(String(req.body.new_password), 10), req.user.id]);
  await audit(db, req.user, 'change_password', 'user', req.user.id);
  res.json({ ok: true });
});

module.exports = r;
