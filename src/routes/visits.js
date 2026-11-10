const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, pick, audit, notFound, bad, assignNo, int, isDate } = require('../utils');
const { createVisit } = require('../services/clinical');
const billing = require('../services/billing');

const r = Router();

const VISIT_SELECT = `SELECT v.*, CONCAT(p.first_name,' ',p.last_name) AS patient_name, p.mrn, p.gender, p.phone,
  TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age, p.allergies, u.name AS doctor_name, u.room AS doctor_room, d.name AS department,
  TIMESTAMPDIFF(MINUTE, v.checked_in_at, COALESCE(v.completed_at, NOW())) AS minutes_in
  FROM visits v JOIN patients p ON p.id=v.patient_id JOIN users u ON u.id=v.doctor_id LEFT JOIN departments d ON d.id=u.department_id`;
const PRIORITY_ORDER = "FIELD(v.priority,'emergency','urgent','normal')";

async function loadVisit(c, id) {
  const v = await c.one(`${VISIT_SELECT} WHERE v.id=?`, [id]);
  if (!v) throw notFound('Visit not found');
  return v;
}
function assertDoctorOwns(req, v) {
  if (req.user.role === 'doctor' && v.doctor_id !== req.user.id) throw bad('This patient is assigned to another doctor');
}

/* ---------- Check-in ---------- */
r.post('/visits', allow('receptionist', 'nurse'), async (req, res) => {
  need(req.body, ['patient_id', 'doctor_id']);
  res.json(await db.tx((c) => createVisit(c, req.body, req.user)));
});

/* ---------- Lists & queues ---------- */
r.get('/visits', async (req, res) => {
  const p = [];
  let sql = `${VISIT_SELECT} WHERE 1=1`;
  if (req.query.active) sql += " AND v.status NOT IN ('completed','cancelled')";
  if (req.query.date && isDate(req.query.date)) { sql += ' AND v.queue_date=?'; p.push(req.query.date); }
  else if (!req.query.all) sql += ' AND v.queue_date=CURDATE()';
  if (req.query.status) { sql += ' AND v.status IN (?)'; p.push(String(req.query.status).split(',')); }
  if (req.query.doctor_id) { sql += ' AND v.doctor_id=?'; p.push(req.query.doctor_id); }
  sql += ` ORDER BY ${PRIORITY_ORDER}, v.checked_in_at LIMIT 500`;
  res.json(await db.query(sql, p));
});

r.get('/queue/doctor', allow('doctor'), async (req, res) => {
  const doctorId = req.user.role === 'doctor' ? req.user.id : int(req.query.doctor_id);
  const rows = await db.query(
    `${VISIT_SELECT} WHERE v.doctor_id=? AND v.queue_date=CURDATE() AND v.status NOT IN ('completed','cancelled','waiting_triage')
     ORDER BY FIELD(v.status,'in_consultation','results_ready','waiting_doctor','waiting_lab','waiting_pharmacy'), ${PRIORITY_ORDER}, v.token_no`,
    [doctorId]);
  const waitingTriage = (await db.one("SELECT COUNT(*) n FROM visits WHERE doctor_id=? AND queue_date=CURDATE() AND status='waiting_triage'", [doctorId])).n;
  const done = (await db.one("SELECT COUNT(*) n FROM visits WHERE doctor_id=? AND queue_date=CURDATE() AND status='completed'", [doctorId])).n;
  res.json({ rows, waiting_triage: waitingTriage, completed: done });
});

/* ---------- Visit detail ---------- */
r.get('/visits/:id', async (req, res) => {
  const v = await loadVisit(db, req.params.id);
  const [vitals, labOrders, labItems, rx, rxItems, invoice, history] = await Promise.all([
    db.query('SELECT vt.*, u.name AS nurse_name FROM vitals vt LEFT JOIN users u ON u.id=vt.nurse_id WHERE visit_id=? ORDER BY id DESC', [v.id]),
    db.query('SELECT o.*, u.name AS technician FROM lab_orders o LEFT JOIN users u ON u.id=o.technician_id WHERE visit_id=? ORDER BY id', [v.id]),
    db.query('SELECT i.* FROM lab_order_items i JOIN lab_orders o ON o.id=i.lab_order_id WHERE o.visit_id=? ORDER BY i.id', [v.id]),
    db.query('SELECT rx.*, u.name AS pharmacist FROM prescriptions rx LEFT JOIN users u ON u.id=rx.pharmacist_id WHERE visit_id=? ORDER BY id', [v.id]),
    db.query(`SELECT pi.*, m.name, m.strength, m.form, m.unit_price FROM prescription_items pi JOIN medicines m ON m.id=pi.medicine_id
              JOIN prescriptions rx ON rx.id=pi.prescription_id WHERE rx.visit_id=? ORDER BY pi.id`, [v.id]),
    db.one("SELECT * FROM invoices WHERE visit_id=? AND status<>'cancelled' ORDER BY id LIMIT 1", [v.id]),
    db.query(`SELECT v.id, v.visit_no, v.queue_date, v.diagnosis, v.chief_complaint, u.name AS doctor_name FROM visits v JOIN users u ON u.id=v.doctor_id
              WHERE v.patient_id=? AND v.id<>? AND v.status='completed' ORDER BY v.id DESC LIMIT 10`, [v.patient_id, v.id]),
  ]);
  const patient = await db.one('SELECT p.*, TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age FROM patients p WHERE id=?', [v.patient_id]);
  for (const o of labOrders) o.items = labItems.filter((i) => i.lab_order_id === o.id);
  for (const p of rx) p.items = rxItems.filter((i) => i.prescription_id === p.id);
  let invoiceItems = [];
  if (invoice) invoiceItems = await db.query('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id', [invoice.id]);
  res.json({ visit: v, patient, vitals, lab_orders: labOrders, prescriptions: rx, invoice: invoice ? { ...invoice, items: invoiceItems } : null, history });
});

/* ---------- Nurse triage ---------- */
r.post('/visits/:id/vitals', allow('nurse', 'doctor'), async (req, res) => {
  const out = await db.tx(async (c) => {
    const v = await c.one('SELECT * FROM visits WHERE id=? FOR UPDATE', [req.params.id]);
    if (!v) throw notFound('Visit not found');
    if (['completed', 'cancelled'].includes(v.status)) throw bad('Visit is closed');
    const d = pick(req.body, ['temperature', 'bp_systolic', 'bp_diastolic', 'pulse', 'resp_rate', 'spo2', 'weight', 'height', 'pain_score', 'notes']);
    d.visit_id = v.id; d.patient_id = v.patient_id; d.nurse_id = req.user.id;
    await c.query('INSERT INTO vitals SET ?', [d]);
    if (v.status === 'waiting_triage') {
      const pr = ['normal', 'urgent', 'emergency'].includes(req.body.priority) ? req.body.priority : v.priority;
      await c.query("UPDATE visits SET status='waiting_doctor', triaged_at=NOW(), priority=?, chief_complaint=COALESCE(?, chief_complaint) WHERE id=?",
        [pr, req.body.chief_complaint || null, v.id]);
    }
    await audit(c, req.user, 'triage', 'visit', v.id, v.visit_no);
    return { ok: true };
  });
  res.json(out);
});

/* ---------- Doctor actions ---------- */
r.post('/visits/:id/call', allow('doctor'), async (req, res) => {
  const v = await loadVisit(db, req.params.id);
  assertDoctorOwns(req, v);
  if (!['waiting_doctor', 'results_ready', 'waiting_triage', 'in_consultation'].includes(v.status)) throw bad(`Patient is currently ${v.status.replace(/_/g, ' ')}`);
  await db.query("UPDATE visits SET status='in_consultation', called_at=NOW() WHERE id=?", [v.id]);
  res.json({ ok: true });
});

r.put('/visits/:id', allow('doctor'), async (req, res) => {
  const v = await loadVisit(db, req.params.id);
  assertDoctorOwns(req, v);
  const d = pick(req.body, ['chief_complaint', 'symptoms', 'examination', 'diagnosis', 'notes', 'follow_up_date']);
  if (!Object.keys(d).length) throw bad('Nothing to save');
  await db.query('UPDATE visits SET ? WHERE id=?', [d, v.id]);
  res.json({ ok: true });
});

r.post('/visits/:id/lab-orders', allow('doctor'), async (req, res) => {
  const tests = (req.body.tests || []).map(Number).filter(Boolean);
  if (!tests.length) throw bad('Select at least one test');
  const out = await db.tx(async (c) => {
    const v = await loadVisit(c, req.params.id);
    assertDoctorOwns(req, v);
    if (['completed', 'cancelled'].includes(v.status)) throw bad('Visit is closed');
    const rows = await c.query('SELECT * FROM lab_tests WHERE id IN (?) AND active=1', [tests]);
    if (!rows.length) throw bad('Invalid tests');
    const priority = ['normal', 'urgent', 'stat'].includes(req.body.priority) ? req.body.priority : 'normal';
    const o = await c.query('INSERT INTO lab_orders (visit_id, patient_id, doctor_id, priority, clinical_notes) VALUES (?,?,?,?,?)',
      [v.id, v.patient_id, v.doctor_id, priority, req.body.clinical_notes || null]);
    const orderNo = await assignNo(c, 'lab_orders', 'order_no', 'LAB-', o.insertId);
    const invId = await billing.ensureInvoice(c, { patient_id: v.patient_id, visit_id: v.id }, req.user);
    for (const t of rows) {
      await c.query('INSERT INTO lab_order_items (lab_order_id, test_id, test_name, unit, normal_range, price) VALUES (?,?,?,?,?,?)',
        [o.insertId, t.id, t.name, t.unit, t.normal_range, t.price]);
      await billing.addItem(c, invId, { item_type: 'lab', ref_id: o.insertId, description: `Lab: ${t.name}`, quantity: 1, unit_price: t.price }, req.user);
    }
    await c.query("UPDATE visits SET status='waiting_lab' WHERE id=?", [v.id]);
    await audit(c, req.user, 'lab_order', 'lab_order', o.insertId, `${orderNo}: ${rows.map((t) => t.code).join(', ')}`);
    return { id: o.insertId, order_no: orderNo };
  });
  res.json(out);
});

r.post('/visits/:id/prescriptions', allow('doctor'), async (req, res) => {
  const items = (req.body.items || []).filter((i) => i.medicine_id && Number(i.quantity) > 0);
  if (!items.length) throw bad('Add at least one medicine with a quantity');
  const out = await db.tx(async (c) => {
    const v = await loadVisit(c, req.params.id);
    assertDoctorOwns(req, v);
    if (['completed', 'cancelled'].includes(v.status)) throw bad('Visit is closed');
    const x = await c.query('INSERT INTO prescriptions (visit_id, patient_id, doctor_id, notes) VALUES (?,?,?,?)',
      [v.id, v.patient_id, v.doctor_id, req.body.notes || null]);
    const rxNo = await assignNo(c, 'prescriptions', 'rx_no', 'RX-', x.insertId);
    for (const i of items) {
      await c.query('INSERT INTO prescription_items (prescription_id, medicine_id, dosage, frequency, duration, quantity, instructions) VALUES (?,?,?,?,?,?,?)',
        [x.insertId, i.medicine_id, i.dosage || null, i.frequency || null, i.duration || null, int(i.quantity, 1), i.instructions || null]);
    }
    if (req.body.diagnosis) await c.query('UPDATE visits SET diagnosis=? WHERE id=?', [req.body.diagnosis, v.id]);
    await c.query("UPDATE visits SET status='waiting_pharmacy' WHERE id=?", [v.id]);
    await audit(c, req.user, 'prescribe', 'prescription', x.insertId, rxNo);
    return { id: x.insertId, rx_no: rxNo };
  });
  res.json(out);
});

r.post('/visits/:id/complete', allow('doctor'), async (req, res) => {
  const v = await loadVisit(db, req.params.id);
  assertDoctorOwns(req, v);
  if (['completed', 'cancelled'].includes(v.status)) throw bad('Visit already closed');
  const pendingLab = await db.one("SELECT COUNT(*) n FROM lab_orders WHERE visit_id=? AND status NOT IN ('completed','cancelled')", [v.id]);
  if (pendingLab.n && !req.body.force) throw bad('There are lab orders still pending. Wait for results or cancel them.');
  const pendingRx = await db.one("SELECT COUNT(*) n FROM prescriptions WHERE visit_id=? AND status IN ('pending','partial')", [v.id]);
  const status = pendingRx.n ? 'waiting_pharmacy' : 'completed';
  await db.query(`UPDATE visits SET status=?, completed_at=${status === 'completed' ? 'NOW()' : 'NULL'} WHERE id=?`, [status, v.id]);
  if (v.appointment_id && status === 'completed') await db.query("UPDATE appointments SET status='completed' WHERE id=?", [v.appointment_id]);
  await audit(db, req.user, 'complete', 'visit', v.id, v.visit_no);
  res.json({ ok: true, status });
});

r.post('/visits/:id/cancel', allow('receptionist', 'doctor', 'nurse'), async (req, res) => {
  await db.tx(async (c) => {
    const v = await c.one('SELECT * FROM visits WHERE id=? FOR UPDATE', [req.params.id]);
    if (!v) throw notFound();
    if (['completed', 'cancelled'].includes(v.status)) throw bad('Visit already closed');
    const inv = await c.one("SELECT * FROM invoices WHERE visit_id=? AND status<>'cancelled'", [v.id]);
    if (inv && inv.amount_paid > 0) throw bad('Visit has payments recorded; refund before cancelling');
    await c.query("UPDATE visits SET status='cancelled', completed_at=NOW() WHERE id=?", [v.id]);
    await c.query("UPDATE lab_orders SET status='cancelled' WHERE visit_id=? AND status<>'completed'", [v.id]);
    await c.query("UPDATE prescriptions SET status='cancelled' WHERE visit_id=? AND status='pending'", [v.id]);
    if (inv) await billing.cancelInvoice(c, inv.id, req.user);
    if (v.appointment_id) await c.query("UPDATE appointments SET status='cancelled' WHERE id=?", [v.appointment_id]);
    await audit(c, req.user, 'cancel', 'visit', v.id, `${v.visit_no}: ${req.body.reason || ''}`);
  });
  res.json({ ok: true });
});

module.exports = r;
