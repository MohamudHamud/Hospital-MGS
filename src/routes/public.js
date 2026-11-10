// Unauthenticated endpoints for the patient website and the queue display screen.
const db = require('../db');
const { Router, need, bad, notFound, isDate, today, HttpError, pick } = require('../utils');
const { createPatient, uniqueRef, settings, slots } = require('../services/clinical');

const r = Router();

// Tiny rate limiter for public writes.
const hits = new Map();
function limit(req, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const a = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) throw new HttpError(429, 'Too many requests. Please try again later.');
  a.push(now);
  hits.set(req.ip, a);
}
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

r.get('/info', async (req, res) => {
  const s = await settings(db);
  res.json({ ...pick(s, ['hospital_name', 'tagline', 'address', 'phone', 'email', 'currency', 'slot_start', 'slot_end']), demo: process.env.DEMO_MODE === 'true' });
});

r.get('/departments', async (req, res) => {
  res.json(await db.query(`SELECT d.id, d.name, d.description, d.icon,
    (SELECT COUNT(*) FROM users u WHERE u.department_id=d.id AND u.role='doctor' AND u.active=1) doctors
    FROM departments d WHERE d.active=1 ORDER BY d.name`));
});

r.get('/doctors', async (req, res) => {
  const p = [];
  let sql = `SELECT u.id, u.name, u.specialization, u.bio, u.consultation_fee, u.department_id, d.name department
             FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.role='doctor' AND u.active=1`;
  if (req.query.department_id) { sql += ' AND u.department_id=?'; p.push(req.query.department_id); }
  res.json(await db.query(sql + ' ORDER BY u.name', p));
});

r.get('/slots', async (req, res) => {
  if (!req.query.doctor_id || !isDate(req.query.date)) throw bad('doctor and date are required');
  if (req.query.date < today()) return res.json([]);
  res.json(await slots(db, req.query.doctor_id, req.query.date));
});

r.post('/appointments', async (req, res) => {
  limit(req);
  need(req.body, ['doctor_id', 'date', 'time', 'first_name', 'last_name', 'phone']);
  const b = req.body;
  if (!isDate(b.date) || b.date < today()) throw bad('Choose today or a future date');
  const max = new Date(); max.setDate(max.getDate() + 90);
  if (new Date(b.date) > max) throw bad('Bookings are open up to 90 days ahead');
  if (!/^\d{2}:\d{2}$/.test(b.time)) throw bad('Invalid time');
  const phone = normPhone(b.phone);
  if (phone.length < 6) throw bad('Enter a valid phone number');
  const out = await db.tx(async (c) => {
    const doc = await c.one("SELECT id, name, department_id FROM users WHERE id=? AND role='doctor' AND active=1", [b.doctor_id]);
    if (!doc) throw bad('Doctor not available');
    const free = (await slots(c, doc.id, b.date)).find((s) => s.time === b.time && s.available);
    if (!free) throw bad('That time is no longer available, please pick another slot');
    let patient = await c.one('SELECT id FROM patients WHERE phone=? AND LOWER(first_name)=LOWER(?) ORDER BY id LIMIT 1', [phone, String(b.first_name).trim()]);
    let patientId = patient && patient.id;
    if (!patientId) {
      patientId = await createPatient(c, {
        first_name: String(b.first_name).trim().slice(0, 80), last_name: String(b.last_name).trim().slice(0, 80), phone,
        email: b.email ? String(b.email).slice(0, 120) : null, gender: ['male', 'female', 'other'].includes(b.gender) ? b.gender : null,
        dob: isDate(b.dob) ? b.dob : null,
      });
    }
    const ref = await uniqueRef(c);
    await c.query("INSERT INTO appointments (ref_code, patient_id, doctor_id, department_id, appt_date, appt_time, reason, source, status) VALUES (?,?,?,?,?,?,?, 'web', 'pending')",
      [ref, patientId, doc.id, b.department_id || doc.department_id, b.date, b.time, b.reason ? String(b.reason).slice(0, 1000) : null]);
    await c.query("INSERT INTO audit_logs (action, entity, details) VALUES ('web_booking','appointment',?)", [ref]);
    return { ref_code: ref, doctor: doc.name, date: b.date, time: b.time };
  });
  res.json(out);
});

async function findAppt(ref, phone) {
  const a = await db.one(`SELECT a.id, a.ref_code, a.appt_date, TIME_FORMAT(a.appt_time,'%H:%i') time, a.status, a.reason, pt.phone,
    CONCAT(pt.first_name,' ',pt.last_name) patient_name, u.name doctor_name, d.name department, v.token_no, v.status visit_status
    FROM appointments a JOIN patients pt ON pt.id=a.patient_id LEFT JOIN users u ON u.id=a.doctor_id
    LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN visits v ON v.id=a.visit_id WHERE a.ref_code=?`, [String(ref).toUpperCase().trim()]);
  if (!a || normPhone(a.phone) !== normPhone(phone)) throw notFound('No appointment matches that reference and phone number');
  delete a.phone;
  return a;
}

r.post('/appointments/lookup', async (req, res) => {
  limit(req, 30);
  need(req.body, ['ref_code', 'phone']);
  res.json(await findAppt(req.body.ref_code, req.body.phone));
});

r.post('/appointments/cancel', async (req, res) => {
  limit(req, 10);
  need(req.body, ['ref_code', 'phone']);
  const a = await findAppt(req.body.ref_code, req.body.phone);
  if (!['pending', 'confirmed'].includes(a.status)) throw bad(`This appointment is ${a.status.replace('_', ' ')} and cannot be cancelled`);
  await db.query("UPDATE appointments SET status='cancelled' WHERE id=?", [a.id]);
  await db.query("INSERT INTO audit_logs (action, entity, entity_id, details) VALUES ('web_cancel','appointment',?,?)", [a.id, a.ref_code]);
  res.json({ ok: true });
});

// Queue display board: tokens only, no patient names.
r.get('/display', async (req, res) => {
  const rows = await db.query(`SELECT v.token_no, v.status, v.priority, v.called_at, v.doctor_id, u.name doctor_name, u.room, d.name department
    FROM visits v JOIN users u ON u.id=v.doctor_id LEFT JOIN departments d ON d.id=u.department_id
    WHERE v.queue_date=CURDATE() AND v.status IN ('waiting_doctor','in_consultation','results_ready','waiting_triage')
    ORDER BY u.name, FIELD(v.priority,'emergency','urgent','normal'), v.token_no`);
  const doctors = new Map();
  for (const x of rows) {
    if (!doctors.has(x.doctor_id)) doctors.set(x.doctor_id, { doctor: x.doctor_name, room: x.room, department: x.department, serving: null, next: [], triage: 0 });
    const d = doctors.get(x.doctor_id);
    if (x.status === 'in_consultation') { if (!d.serving || x.called_at > d.serving.called_at) d.serving = { token: x.token_no, called_at: x.called_at }; }
    else if (x.status === 'waiting_triage') d.triage++;
    else d.next.push({ token: x.token_no, priority: x.priority, results: x.status === 'results_ready' });
  }
  const pharmacy = await db.query(`SELECT v.token_no, u.name doctor_name FROM prescriptions rx JOIN visits v ON v.id=rx.visit_id JOIN users u ON u.id=v.doctor_id
    WHERE rx.status IN ('pending','partial') AND v.queue_date=CURDATE() ORDER BY rx.id`);
  const s = await settings(db);
  res.json({ hospital: s.hospital_name, doctors: [...doctors.values()], pharmacy, time: new Date().toISOString() });
});

module.exports = r;
