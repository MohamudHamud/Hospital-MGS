const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, pick, audit, notFound, bad, isDate } = require('../utils');

const r = Router();
const TEST_FIELDS = ['code', 'name', 'category', 'sample_type', 'unit', 'normal_range', 'price', 'turnaround', 'active'];

/* ---------- Test catalog ---------- */
r.get('/lab/tests', async (req, res) => {
  res.json(await db.query(`SELECT * FROM lab_tests ${req.query.active ? 'WHERE active=1' : ''} ORDER BY category, name`));
});
r.post('/lab/tests', allow('lab'), async (req, res) => {
  need(req.body, ['code', 'name', 'price']);
  const x = await db.query('INSERT INTO lab_tests SET ?', [pick(req.body, TEST_FIELDS)]);
  await audit(db, req.user, 'create', 'lab_test', x.insertId, req.body.name);
  res.json({ id: x.insertId });
});
r.put('/lab/tests/:id', allow('lab'), async (req, res) => {
  const d = pick(req.body, TEST_FIELDS);
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  await db.query('UPDATE lab_tests SET ? WHERE id=?', [d, req.params.id]);
  res.json({ ok: true });
});

/* ---------- Orders ---------- */
const ORDER_SELECT = `SELECT o.*, CONCAT(p.first_name,' ',p.last_name) AS patient_name, p.mrn, p.gender, TIMESTAMPDIFF(YEAR,p.dob,CURDATE()) AS age,
  u.name AS doctor_name, t.name AS technician, v.visit_no, v.token_no,
  (SELECT GROUP_CONCAT(i.test_name SEPARATOR ', ') FROM lab_order_items i WHERE i.lab_order_id=o.id) AS tests,
  (SELECT SUM(i.result_flag IN ('high','low','critical','abnormal')) FROM lab_order_items i WHERE i.lab_order_id=o.id) AS abnormal_count,
  TIMESTAMPDIFF(MINUTE, o.created_at, COALESCE(o.completed_at, NOW())) AS minutes
  FROM lab_orders o JOIN patients p ON p.id=o.patient_id LEFT JOIN users u ON u.id=o.doctor_id
  LEFT JOIN users t ON t.id=o.technician_id LEFT JOIN visits v ON v.id=o.visit_id`;

r.get('/lab/orders', async (req, res) => {
  const p = [];
  let sql = `${ORDER_SELECT} WHERE 1=1`;
  if (req.query.status) { sql += ' AND o.status IN (?)'; p.push(String(req.query.status).split(',')); }
  if (req.query.date && isDate(req.query.date)) { sql += ' AND DATE(o.created_at)=?'; p.push(req.query.date); }
  if (req.query.q) { sql += " AND (CONCAT(p.first_name,' ',p.last_name) LIKE ? OR o.order_no LIKE ? OR p.mrn LIKE ?)"; const q = `%${req.query.q}%`; p.push(q, q, q); }
  sql += " ORDER BY FIELD(o.priority,'stat','urgent','normal'), o.id DESC LIMIT 300";
  res.json(await db.query(sql, p));
});

r.get('/lab/orders/:id', async (req, res) => {
  const o = await db.one(`${ORDER_SELECT} WHERE o.id=?`, [req.params.id]);
  if (!o) throw notFound('Lab order not found');
  o.items = await db.query('SELECT i.*, t.code, t.sample_type, t.category FROM lab_order_items i JOIN lab_tests t ON t.id=i.test_id WHERE lab_order_id=? ORDER BY i.id', [o.id]);
  res.json(o);
});

r.post('/lab/orders/:id/collect', allow('lab', 'nurse'), async (req, res) => {
  const o = await db.one('SELECT * FROM lab_orders WHERE id=?', [req.params.id]);
  if (!o) throw notFound();
  if (o.status !== 'pending') throw bad('Sample already collected');
  await db.query("UPDATE lab_orders SET status='sample_collected', collected_at=NOW(), technician_id=? WHERE id=?", [req.user.id, o.id]);
  await audit(db, req.user, 'sample_collected', 'lab_order', o.id, o.order_no);
  res.json({ ok: true });
});

r.post('/lab/orders/:id/results', allow('lab'), async (req, res) => {
  const out = await db.tx(async (c) => {
    const o = await c.one('SELECT * FROM lab_orders WHERE id=? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (['completed', 'cancelled'].includes(o.status) && !req.body.amend) throw bad(`Order is already ${o.status}`);
    const flags = ['normal', 'low', 'high', 'critical', 'abnormal'];
    for (const it of req.body.items || []) {
      await c.query('UPDATE lab_order_items SET result_value=?, result_flag=?, remarks=? WHERE id=? AND lab_order_id=?',
        [it.result_value || null, flags.includes(it.result_flag) ? it.result_flag : null, it.remarks || null, it.id, o.id]);
    }
    if (req.body.complete) {
      const missing = await c.one("SELECT COUNT(*) n FROM lab_order_items WHERE lab_order_id=? AND (result_value IS NULL OR result_value='')", [o.id]);
      if (missing.n) throw bad('Enter a result for every test before completing');
      await c.query("UPDATE lab_orders SET status='completed', completed_at=NOW(), technician_id=?, collected_at=COALESCE(collected_at,NOW()) WHERE id=?", [req.user.id, o.id]);
      // Close the loop: when every lab order for the visit is done, send the patient back to the doctor.
      if (o.visit_id) {
        const open = await c.one("SELECT COUNT(*) n FROM lab_orders WHERE visit_id=? AND status NOT IN ('completed','cancelled')", [o.visit_id]);
        if (!open.n) await c.query("UPDATE visits SET status='results_ready' WHERE id=? AND status='waiting_lab'", [o.visit_id]);
      }
      await audit(c, req.user, 'results_complete', 'lab_order', o.id, o.order_no);
    } else if (o.status !== 'completed') {
      await c.query("UPDATE lab_orders SET status='in_progress', technician_id=?, collected_at=COALESCE(collected_at,NOW()) WHERE id=?", [req.user.id, o.id]);
    }
    return { ok: true };
  });
  res.json(out);
});

module.exports = r;
