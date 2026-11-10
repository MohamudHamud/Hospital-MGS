const { assignNo, bad, notFound, HttpError, audit, randomRef, today } = require('../utils');
const billing = require('./billing');

async function createPatient(c, d) {
  const r = await c.query('INSERT INTO patients SET ?', [d]);
  await c.query("UPDATE patients SET mrn=CONCAT('MRN', LPAD(?, 6, '0')) WHERE id=?", [r.insertId, r.insertId]);
  return r.insertId;
}

// Check a patient in: create the visit, queue token and the visit invoice with the consultation fee.
async function createVisit(c, { patient_id, doctor_id, appointment_id = null, priority = 'normal', skip_triage = false, chief_complaint = null }, user) {
  if (!['normal', 'urgent', 'emergency'].includes(priority)) priority = 'normal';
  const doctor = await c.one("SELECT id, name, consultation_fee FROM users WHERE id=? AND role='doctor' AND active=1", [doctor_id]);
  if (!doctor) throw bad('Select a valid, active doctor');
  const patient = await c.one('SELECT id, first_name, last_name FROM patients WHERE id=?', [patient_id]);
  if (!patient) throw notFound('Patient not found');
  const active = await c.one("SELECT id, visit_no FROM visits WHERE patient_id=? AND queue_date=CURDATE() AND status NOT IN ('completed','cancelled')", [patient_id]);
  if (active) throw new HttpError(409, `Patient already has an active visit today (${active.visit_no})`);

  const t = await c.one('SELECT COALESCE(MAX(token_no),0)+1 AS t FROM visits WHERE doctor_id=? AND queue_date=CURDATE() FOR UPDATE', [doctor_id]);
  const status = skip_triage || priority === 'emergency' ? 'waiting_doctor' : 'waiting_triage';
  const r = await c.query(
    'INSERT INTO visits (patient_id, doctor_id, appointment_id, queue_date, token_no, priority, status, chief_complaint, created_by) VALUES (?,?,?,CURDATE(),?,?,?,?,?)',
    [patient_id, doctor_id, appointment_id, t.t, priority, status, chief_complaint || null, user ? user.id : null]);
  const visitNo = await assignNo(c, 'visits', 'visit_no', 'V-', r.insertId);

  const invId = await billing.ensureInvoice(c, { patient_id, visit_id: r.insertId }, user);
  if (doctor.consultation_fee > 0) {
    await billing.addItem(c, invId, {
      item_type: 'consultation', ref_id: r.insertId,
      description: `Consultation - ${doctor.name}`, quantity: 1, unit_price: doctor.consultation_fee,
    }, user);
  }
  if (appointment_id) {
    await c.query("UPDATE appointments SET status='checked_in', visit_id=? WHERE id=?", [r.insertId, appointment_id]);
  }
  await audit(c, user, 'check_in', 'visit', r.insertId, `${visitNo} token ${t.t} for ${patient.first_name} ${patient.last_name}`);
  return { id: r.insertId, visit_no: visitNo, token_no: t.t, status };
}

async function uniqueRef(c) {
  for (let i = 0; i < 5; i++) {
    const ref = randomRef('APT-');
    if (!(await c.one('SELECT id FROM appointments WHERE ref_code=?', [ref]))) return ref;
  }
  throw new Error('Could not generate reference');
}

async function settings(c) {
  const rows = await c.query('SELECT k, v FROM settings');
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

// Available appointment slots for a doctor on a date.
async function slots(c, doctorId, date) {
  const s = await settings(c);
  const start = s.slot_start || '08:00', end = s.slot_end || '17:00', step = Math.max(5, Number(s.slot_minutes || 30));
  const taken = new Set((await c.query(
    "SELECT TIME_FORMAT(appt_time,'%H:%i') t FROM appointments WHERE doctor_id=? AND appt_date=? AND status NOT IN ('cancelled','no_show')",
    [doctorId, date])).map((r) => r.t));
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (let m = toMin(start); m + step <= toMin(end); m += step) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (date === today() && m <= nowMin) continue;
    out.push({ time: t, available: !taken.has(t) });
  }
  return out;
}

module.exports = { createPatient, createVisit, uniqueRef, settings, slots };
