const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, pick, audit, notFound, bad, isDate } = require('../utils');
const { createPatient, createVisit, uniqueRef, slots } = require('../services/clinical');

const r = Router();

r.get('/appointments', async (req, res) => {
  const p = [];
  let sql = `SELECT a.*, TIME_FORMAT(a.appt_time,'%H:%i') AS time, CONCAT(pt.first_name,' ',pt.last_name) AS patient_name, pt.phone, pt.mrn,
               u.name AS doctor_name, d.name AS department
             FROM appointments a JOIN patients pt ON pt.id=a.patient_id
             LEFT JOIN users u ON u.id=a.doctor_id LEFT JOIN departments d ON d.id=a.department_id WHERE 1=1`;
  if (req.query.from && isDate(req.query.from)) { sql += ' AND a.appt_date>=?'; p.push(req.query.from); }
  if (req.query.to && isDate(req.query.to)) { sql += ' AND a.appt_date<=?'; p.push(req.query.to); }
  if (req.query.date && isDate(req.query.date)) { sql += ' AND a.appt_date=?'; p.push(req.query.date); }
  if (req.query.status) { sql += ' AND a.status=?'; p.push(req.query.status); }
  if (req.query.source) { sql += ' AND a.source=?'; p.push(req.query.source); }
  if (req.user.role === 'doctor') { sql += ' AND a.doctor_id=?'; p.push(req.user.id); }
  else if (req.query.doctor_id) { sql += ' AND a.doctor_id=?'; p.push(req.query.doctor_id); }
  if (req.query.q) { sql += " AND (CONCAT(pt.first_name,' ',pt.last_name) LIKE ? OR a.ref_code LIKE ? OR pt.phone LIKE ?)"; const q = `%${req.query.q}%`; p.push(q, q, q); }
  sql += ' ORDER BY a.appt_date, a.appt_time LIMIT 500';
  res.json(await db.query(sql, p));
});

r.get('/appointments/slots', async (req, res) => {
  if (!req.query.doctor_id || !isDate(req.query.date)) throw bad('doctor and date are required');
  res.json(await slots(db, req.query.doctor_id, req.query.date));
});

r.post('/appointments', allow('receptionist'), async (req, res) => {
  need(req.body, ['doctor_id', 'appt_date', 'appt_time']);
  if (!isDate(req.body.appt_date)) throw bad('Invalid date');
  const result = await db.tx(async (c) => {
    let patientId = req.body.patient_id;
    if (!patientId) {
      need(req.body, ['first_name', 'last_name', 'phone']);
      patientId = await createPatient(c, pick(req.body, ['first_name', 'last_name', 'phone', 'gender', 'dob', 'email']));
    }
    const doc = await c.one("SELECT id, department_id FROM users WHERE id=? AND role='doctor'", [req.body.doctor_id]);
    if (!doc) throw bad('Invalid doctor');
    const clash = await c.one("SELECT id FROM appointments WHERE doctor_id=? AND appt_date=? AND appt_time=? AND status NOT IN ('cancelled','no_show')",
      [doc.id, req.body.appt_date, req.body.appt_time]);
    if (clash) throw bad('That time slot is already booked');
    const ref = await uniqueRef(c);
    const x = await c.query(
      "INSERT INTO appointments (ref_code, patient_id, doctor_id, department_id, appt_date, appt_time, reason, source, status, created_by) VALUES (?,?,?,?,?,?,?,?, 'confirmed', ?)",
      [ref, patientId, doc.id, req.body.department_id || doc.department_id, req.body.appt_date, req.body.appt_time, req.body.reason || null,
        req.body.source === 'phone' ? 'phone' : 'reception', req.user.id]);
    await audit(c, req.user, 'create', 'appointment', x.insertId, ref);
    return { id: x.insertId, ref_code: ref };
  });
  res.json(result);
});

r.put('/appointments/:id/status', allow('receptionist', 'doctor'), async (req, res) => {
  const allowed = ['pending', 'confirmed', 'cancelled', 'no_show', 'completed'];
  if (!allowed.includes(req.body.status)) throw bad('Invalid status');
  const a = await db.one('SELECT * FROM appointments WHERE id=?', [req.params.id]);
  if (!a) throw notFound();
  if (a.status === 'checked_in' && req.body.status !== 'completed') throw bad('Appointment already checked in');
  await db.query('UPDATE appointments SET status=? WHERE id=?', [req.body.status, a.id]);
  await audit(db, req.user, `appointment_${req.body.status}`, 'appointment', a.id, a.ref_code);
  res.json({ ok: true });
});

r.put('/appointments/:id', allow('receptionist'), async (req, res) => {
  const d = pick(req.body, ['doctor_id', 'department_id', 'appt_date', 'appt_time', 'reason']);
  await db.query('UPDATE appointments SET ? WHERE id=?', [d, req.params.id]);
  res.json({ ok: true });
});

r.post('/appointments/:id/checkin', allow('receptionist', 'nurse'), async (req, res) => {
  const out = await db.tx(async (c) => {
    const a = await c.one('SELECT * FROM appointments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!a) throw notFound('Appointment not found');
    if (!['pending', 'confirmed'].includes(a.status)) throw bad(`Cannot check in an appointment that is ${a.status}`);
    const doctorId = req.body.doctor_id || a.doctor_id;
    if (!doctorId) throw bad('Assign a doctor first');
    return createVisit(c, { patient_id: a.patient_id, doctor_id: doctorId, appointment_id: a.id, priority: req.body.priority,
      skip_triage: !!req.body.skip_triage, chief_complaint: req.body.chief_complaint || a.reason }, req.user);
  });
  res.json(out);
});

module.exports = r;
