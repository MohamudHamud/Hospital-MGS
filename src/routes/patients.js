const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, pick, audit, notFound, int } = require('../utils');
const { createPatient } = require('../services/clinical');

const r = Router();
const FIELDS = ['first_name', 'last_name', 'gender', 'dob', 'phone', 'email', 'address', 'blood_group', 'allergies',
  'chronic_conditions', 'emergency_contact', 'emergency_phone', 'insurance_provider', 'insurance_no'];

r.get('/patients', async (req, res) => {
  const p = [];
  let where = 'WHERE 1=1';
  if (req.query.q) {
    const q = `%${String(req.query.q).trim()}%`;
    where += " AND (CONCAT(first_name,' ',last_name) LIKE ? OR mrn LIKE ? OR phone LIKE ? OR email LIKE ?)";
    p.push(q, q, q, q);
  }
  const limit = Math.min(int(req.query.limit, 25), 200), offset = Math.max(int(req.query.offset, 0), 0);
  const total = (await db.one(`SELECT COUNT(*) n FROM patients ${where}`, p)).n;
  const rows = await db.query(
    `SELECT p.*, TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age,
       (SELECT MAX(queue_date) FROM visits v WHERE v.patient_id=p.id) AS last_visit
     FROM patients p ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  res.json({ rows, total });
});

r.get('/patients/:id', async (req, res) => {
  const id = req.params.id;
  const patient = await db.one('SELECT p.*, TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age FROM patients p WHERE id=?', [id]);
  if (!patient) throw notFound('Patient not found');
  const [visits, appointments, labs, prescriptions, invoices, vitals] = await Promise.all([
    db.query(`SELECT v.*, u.name AS doctor_name FROM visits v JOIN users u ON u.id=v.doctor_id WHERE v.patient_id=? ORDER BY v.id DESC`, [id]),
    db.query(`SELECT a.*, u.name AS doctor_name, d.name AS department FROM appointments a LEFT JOIN users u ON u.id=a.doctor_id
              LEFT JOIN departments d ON d.id=a.department_id WHERE a.patient_id=? ORDER BY a.appt_date DESC, a.appt_time DESC`, [id]),
    db.query(`SELECT i.*, o.order_no, o.status AS order_status, o.created_at, o.completed_at FROM lab_order_items i
              JOIN lab_orders o ON o.id=i.lab_order_id WHERE o.patient_id=? ORDER BY o.id DESC, i.id`, [id]),
    db.query(`SELECT rx.*, u.name AS doctor_name,
                (SELECT GROUP_CONCAT(CONCAT(m.name,' ',COALESCE(m.strength,''),' x',pi.quantity) SEPARATOR ', ')
                 FROM prescription_items pi JOIN medicines m ON m.id=pi.medicine_id WHERE pi.prescription_id=rx.id) AS items
              FROM prescriptions rx LEFT JOIN users u ON u.id=rx.doctor_id WHERE rx.patient_id=? ORDER BY rx.id DESC`, [id]),
    db.query('SELECT * FROM invoices WHERE patient_id=? ORDER BY id DESC', [id]),
    db.query('SELECT * FROM vitals WHERE patient_id=? ORDER BY id DESC LIMIT 20', [id]),
  ]);
  res.json({ patient, visits, appointments, labs, prescriptions, invoices, vitals });
});

r.post('/patients', allow('receptionist', 'nurse', 'doctor', 'pharmacist'), async (req, res) => {
  need(req.body, ['first_name', 'last_name', 'phone']);
  const id = await createPatient(db, pick(req.body, FIELDS));
  await audit(db, req.user, 'create', 'patient', id, `${req.body.first_name} ${req.body.last_name}`);
  res.json(await db.one('SELECT * FROM patients WHERE id=?', [id]));
});

r.put('/patients/:id', allow('receptionist', 'nurse', 'doctor'), async (req, res) => {
  const d = pick(req.body, FIELDS);
  await db.query('UPDATE patients SET ? WHERE id=?', [d, req.params.id]);
  await audit(db, req.user, 'update', 'patient', req.params.id);
  res.json({ ok: true });
});

module.exports = r;
