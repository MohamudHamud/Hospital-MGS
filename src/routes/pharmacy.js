const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, pick, audit, notFound, bad, int, round2, isDate } = require('../utils');
const billing = require('../services/billing');
const { deductFEFO } = require('../services/stock');
const { settings } = require('../services/clinical');
const acc = require('../services/accounting');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const r = Router();
const MED_FIELDS = ['code', 'name', 'generic_name', 'category', 'form', 'strength', 'unit', 'unit_price', 'reorder_level', 'active'];
const STOCK_SQL = `(SELECT COALESCE(SUM(b.qty_available),0) FROM medicine_batches b WHERE b.medicine_id=m.id AND (b.expiry_date IS NULL OR b.expiry_date>=CURDATE()))`;

/* ---------- Medicines ---------- */
r.get('/pharmacy/medicines', async (req, res) => {
  const p = [];
  let sql = `SELECT m.*, ${STOCK_SQL} AS stock,
    (SELECT MIN(b.expiry_date) FROM medicine_batches b WHERE b.medicine_id=m.id AND b.qty_available>0 AND b.expiry_date>=CURDATE()) AS next_expiry,
    (SELECT COALESCE(SUM(b.qty_available),0) FROM medicine_batches b WHERE b.medicine_id=m.id AND b.expiry_date<CURDATE()) AS expired_qty
    FROM medicines m WHERE 1=1`;
  if (req.query.active) sql += ' AND m.active=1';
  if (req.query.q) { sql += ' AND (m.name LIKE ? OR m.generic_name LIKE ? OR m.code LIKE ?)'; const q = `%${req.query.q}%`; p.push(q, q, q); }
  res.json(await db.query(sql + ' ORDER BY m.name', p));
});
r.post('/pharmacy/medicines', allow('pharmacist'), async (req, res) => {
  need(req.body, ['code', 'name', 'unit_price']);
  const x = await db.query('INSERT INTO medicines SET ?', [pick(req.body, MED_FIELDS)]);
  await audit(db, req.user, 'create', 'medicine', x.insertId, req.body.name);
  res.json({ id: x.insertId });
});
r.put('/pharmacy/medicines/:id', allow('pharmacist'), async (req, res) => {
  const d = pick(req.body, MED_FIELDS);
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  await db.query('UPDATE medicines SET ? WHERE id=?', [d, req.params.id]);
  await audit(db, req.user, 'update', 'medicine', req.params.id);
  res.json({ ok: true });
});
r.get('/pharmacy/medicines/:id/batches', async (req, res) => {
  res.json(await db.query(`SELECT b.*, s.name AS supplier, u.name AS received_by_name, (b.expiry_date < CURDATE()) AS expired,
    DATEDIFF(b.expiry_date, CURDATE()) AS days_left FROM medicine_batches b LEFT JOIN suppliers s ON s.id=b.supplier_id
    LEFT JOIN users u ON u.id=b.received_by WHERE b.medicine_id=? ORDER BY b.expiry_date`, [req.params.id]));
});

/* ---------- Stock in / adjustments ---------- */
r.post('/pharmacy/stock-in', allow('pharmacist'), async (req, res) => {
  need(req.body, ['medicine_id', 'batch_no', 'quantity']);
  const qty = int(req.body.quantity);
  if (qty <= 0) throw bad('Quantity must be positive');
  if (req.body.expiry_date && !isDate(req.body.expiry_date)) throw bad('Invalid expiry date');
  const out = await db.tx(async (c) => {
    const m = await c.one('SELECT * FROM medicines WHERE id=?', [req.body.medicine_id]);
    if (!m) throw notFound('Medicine not found');
    const cost = round2(req.body.cost_price || 0);
    const x = await c.query('INSERT INTO medicine_batches (medicine_id, batch_no, expiry_date, qty_received, qty_available, cost_price, supplier_id, received_by) VALUES (?,?,?,?,?,?,?,?)',
      [m.id, req.body.batch_no, req.body.expiry_date || null, qty, qty, cost, req.body.supplier_id || null, req.user.id]);
    const bal = await c.one('SELECT COALESCE(SUM(qty_available),0) q FROM medicine_batches WHERE medicine_id=? AND (expiry_date IS NULL OR expiry_date>=CURDATE())', [m.id]);
    await c.query("INSERT INTO stock_movements (item_type,item_id,batch_id,movement,quantity,balance_after,reference,notes,user_id) VALUES ('medicine',?,?,'in',?,?,?,?,?)",
      [m.id, x.insertId, qty, bal.q, req.body.batch_no, req.body.notes || 'Stock received', req.user.id]);
    // payment: 'acct:<id>' paid now, 'credit' owed to supplier, 'none' opening stock / donation
    const payment = req.body.payment || (req.body.record_expense ? req.body.method || 'cash' : 'none');
    const pay = await acc.paymentSide(c, payment, req.body.supplier_id);
    if (pay.credit && !req.body.supplier_id) throw bad('Choose the supplier for a purchase on credit');
    const total = round2(cost * qty);
    if (pay.paid && total > 0) {
      await billing.recordTxn(c, { type: 'expense', category: 'Medicine Purchase', amount: total, method: pay.method,
        reference: req.body.batch_no, description: `Purchase ${m.name} x${qty}` }, req.user);
    }
    await acc.simple(c, { description: `${pay.credit ? 'Credit purchase' : pay.paid ? 'Purchase' : 'Opening stock'}: ${m.name} x${qty} (batch ${req.body.batch_no})`,
      reference: req.body.batch_no, source: 'purchase', source_id: x.insertId, debit: acc.K('inventory_meds'), credit: pay.side, amount: total }, req.user);
    await audit(c, req.user, 'stock_in', 'medicine', m.id, `${m.name} +${qty} (batch ${req.body.batch_no})`);
    return { id: x.insertId };
  });
  res.json(out);
});

r.post('/pharmacy/adjust', allow('pharmacist'), async (req, res) => {
  need(req.body, ['batch_id', 'quantity', 'reason']);
  const qty = int(req.body.quantity);
  if (!qty) throw bad('Quantity cannot be zero');
  await db.tx(async (c) => {
    const b = await c.one('SELECT * FROM medicine_batches WHERE id=? FOR UPDATE', [req.body.batch_id]);
    if (!b) throw notFound('Batch not found');
    if (b.qty_available + qty < 0) throw bad(`Batch only has ${b.qty_available} units`);
    await c.query('UPDATE medicine_batches SET qty_available=qty_available+? WHERE id=?', [qty, b.id]);
    const bal = await c.one('SELECT COALESCE(SUM(qty_available),0) q FROM medicine_batches WHERE medicine_id=? AND (expiry_date IS NULL OR expiry_date>=CURDATE())', [b.medicine_id]);
    const movement = req.body.reason === 'expired' ? 'expired' : req.body.reason === 'return' ? 'return' : 'adjust';
    await c.query("INSERT INTO stock_movements (item_type,item_id,batch_id,movement,quantity,balance_after,reference,notes,user_id) VALUES ('medicine',?,?,?,?,?,?,?,?)",
      [b.medicine_id, b.id, movement, qty, bal.q, b.batch_no, req.body.notes || req.body.reason, req.user.id]);
    // Accounting: loss -> write-off (or supplier credit for returns), gain -> inventory gain.
    const value = round2(Math.abs(qty) * b.cost_price);
    const med = await c.one('SELECT name FROM medicines WHERE id=?', [b.medicine_id]);
    const desc = `${cap(movement)} ${med.name} batch ${b.batch_no} ${qty > 0 ? '+' : ''}${qty}`;
    if (qty < 0) {
      const debit = movement === 'return' && b.supplier_id ? acc.K('ap', { supplier_id: b.supplier_id }) : acc.K('writeoff');
      await acc.simple(c, { description: desc, reference: b.batch_no, source: 'stock', source_id: b.id, debit, credit: acc.K('inventory_meds'), amount: value }, req.user);
    } else {
      await acc.simple(c, { description: desc, reference: b.batch_no, source: 'stock', source_id: b.id, debit: acc.K('inventory_meds'), credit: acc.K('stock_gain'), amount: value }, req.user);
    }
    await audit(c, req.user, 'stock_adjust', 'medicine', b.medicine_id, `batch ${b.batch_no} ${qty > 0 ? '+' : ''}${qty} (${req.body.reason})`);
  });
  res.json({ ok: true });
});

r.get('/pharmacy/alerts', async (req, res) => {
  const s = await settings(db);
  const days = int(s.expiry_alert_days, 90);
  const [low, expiring, expired] = await Promise.all([
    db.query(`SELECT * FROM (SELECT m.id, m.code, m.name, m.strength, m.reorder_level, ${STOCK_SQL} AS stock FROM medicines m WHERE m.active=1) x
              WHERE stock <= reorder_level ORDER BY stock`),
    db.query(`SELECT b.*, m.name, m.strength, DATEDIFF(b.expiry_date, CURDATE()) AS days_left FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id
              WHERE b.qty_available>0 AND b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY b.expiry_date`, [days]),
    db.query(`SELECT b.*, m.name, m.strength FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id
              WHERE b.qty_available>0 AND b.expiry_date < CURDATE() ORDER BY b.expiry_date`),
  ]);
  res.json({ low, expiring, expired, days });
});

r.get('/pharmacy/movements', async (req, res) => {
  const p = [];
  let sql = `SELECT sm.*, m.name, m.strength, b.batch_no, u.name AS user_name FROM stock_movements sm JOIN medicines m ON m.id=sm.item_id
             LEFT JOIN medicine_batches b ON b.id=sm.batch_id LEFT JOIN users u ON u.id=sm.user_id WHERE sm.item_type='medicine'`;
  if (req.query.medicine_id) { sql += ' AND sm.item_id=?'; p.push(req.query.medicine_id); }
  res.json(await db.query(sql + ' ORDER BY sm.id DESC LIMIT 300', p));
});

/* ---------- Suppliers ---------- */
r.get('/suppliers', async (req, res) => res.json(await db.query('SELECT * FROM suppliers ORDER BY name')));
r.post('/suppliers', allow('pharmacist', 'accountant'), async (req, res) => {
  need(req.body, ['name']);
  const x = await db.query('INSERT INTO suppliers SET ?', [pick(req.body, ['name', 'contact_person', 'phone', 'email', 'address', 'active'])]);
  res.json({ id: x.insertId });
});
r.put('/suppliers/:id', allow('pharmacist', 'accountant'), async (req, res) => {
  const d = pick(req.body, ['name', 'contact_person', 'phone', 'email', 'address', 'active']);
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  await db.query('UPDATE suppliers SET ? WHERE id=?', [d, req.params.id]);
  res.json({ ok: true });
});

/* ---------- Prescriptions / dispensing ---------- */
const RX_SELECT = `SELECT rx.*, CONCAT(p.first_name,' ',p.last_name) AS patient_name, p.mrn, p.allergies, TIMESTAMPDIFF(YEAR,p.dob,CURDATE()) AS age, p.gender,
  u.name AS doctor_name, ph.name AS pharmacist, v.visit_no, v.token_no, v.diagnosis,
  (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id=rx.id) AS item_count,
  TIMESTAMPDIFF(MINUTE, rx.created_at, COALESCE(rx.dispensed_at, NOW())) AS minutes
  FROM prescriptions rx JOIN patients p ON p.id=rx.patient_id LEFT JOIN users u ON u.id=rx.doctor_id
  LEFT JOIN users ph ON ph.id=rx.pharmacist_id LEFT JOIN visits v ON v.id=rx.visit_id`;

r.get('/pharmacy/prescriptions', async (req, res) => {
  const p = [];
  let sql = `${RX_SELECT} WHERE 1=1`;
  if (req.query.status) { sql += ' AND rx.status IN (?)'; p.push(String(req.query.status).split(',')); }
  if (req.query.date && isDate(req.query.date)) { sql += ' AND DATE(rx.created_at)=?'; p.push(req.query.date); }
  if (req.query.q) { sql += " AND (CONCAT(p.first_name,' ',p.last_name) LIKE ? OR rx.rx_no LIKE ? OR p.mrn LIKE ?)"; const q = `%${req.query.q}%`; p.push(q, q, q); }
  res.json(await db.query(sql + ' ORDER BY rx.id DESC LIMIT 300', p));
});

r.get('/pharmacy/prescriptions/:id', async (req, res) => {
  const rx = await db.one(`${RX_SELECT} WHERE rx.id=?`, [req.params.id]);
  if (!rx) throw notFound('Prescription not found');
  rx.items = await db.query(`SELECT pi.*, m.name, m.code, m.strength, m.form, m.unit, m.unit_price, ${STOCK_SQL} AS stock
    FROM prescription_items pi JOIN medicines m ON m.id=pi.medicine_id WHERE pi.prescription_id=? ORDER BY pi.id`, [rx.id]);
  res.json(rx);
});

r.post('/pharmacy/prescriptions/:id/dispense', allow('pharmacist'), async (req, res) => {
  const out = await db.tx(async (c) => {
    const rx = await c.one('SELECT * FROM prescriptions WHERE id=? FOR UPDATE', [req.params.id]);
    if (!rx) throw notFound('Prescription not found');
    if (!['pending', 'partial'].includes(rx.status)) throw bad(`Prescription is already ${rx.status}`);
    const items = await c.query('SELECT pi.*, m.name, m.strength, m.unit_price FROM prescription_items pi JOIN medicines m ON m.id=pi.medicine_id WHERE prescription_id=?', [rx.id]);
    const want = new Map((req.body.items || []).map((i) => [Number(i.id), int(i.qty)]));
    const invId = await billing.ensureInvoice(c, { patient_id: rx.patient_id, visit_id: rx.visit_id }, req.user);
    let dispensedAny = false;
    for (const it of items) {
      const remaining = it.quantity - it.qty_dispensed;
      const q = Math.min(want.has(it.id) ? want.get(it.id) : 0, remaining);
      if (q <= 0) continue;
      await deductFEFO(c, it.medicine_id, q, { movement: 'dispense', reference: rx.rx_no }, req.user);
      await c.query('UPDATE prescription_items SET qty_dispensed=qty_dispensed+? WHERE id=?', [q, it.id]);
      await billing.addItem(c, invId, { item_type: 'medicine', ref_id: it.medicine_id, description: `${it.name} ${it.strength || ''}`.trim(), quantity: q, unit_price: it.unit_price }, req.user);
      it.qty_dispensed += q;
      dispensedAny = true;
    }
    if (!dispensedAny && !req.body.close) throw bad('Nothing to dispense');
    const allDone = items.every((i) => i.qty_dispensed >= i.quantity);
    const status = allDone || req.body.close ? 'dispensed' : 'partial';
    const note = !allDone && req.body.close ? `${rx.notes ? rx.notes + ' | ' : ''}Closed with partial dispense` : rx.notes;
    await c.query('UPDATE prescriptions SET status=?, notes=?, pharmacist_id=?, dispensed_at=NOW() WHERE id=?', [status, note, req.user.id, rx.id]);
    if (status === 'dispensed' && rx.visit_id) {
      const openRx = await c.one("SELECT COUNT(*) n FROM prescriptions WHERE visit_id=? AND status IN ('pending','partial')", [rx.visit_id]);
      if (!openRx.n) {
        await c.query("UPDATE visits SET status='completed', completed_at=NOW() WHERE id=? AND status='waiting_pharmacy'", [rx.visit_id]);
        await c.query("UPDATE appointments a JOIN visits v ON v.appointment_id=a.id SET a.status='completed' WHERE v.id=? AND v.status='completed'", [rx.visit_id]);
      }
    }
    await audit(c, req.user, 'dispense', 'prescription', rx.id, `${rx.rx_no} -> ${status}`);
    return { ok: true, status, invoice_id: invId };
  });
  res.json(out);
});

/* ---------- Over-the-counter sales ---------- */
r.post('/pharmacy/sales', allow('pharmacist'), async (req, res) => {
  const items = (req.body.items || []).filter((i) => i.medicine_id && int(i.quantity) > 0);
  if (!items.length) throw bad('Cart is empty');
  const out = await db.tx(async (c) => {
    const invId = await billing.ensureInvoice(c, { patient_id: req.body.patient_id || null, customer_name: req.body.customer_name || 'Walk-in customer' }, req.user);
    const inv = await c.one('SELECT invoice_no FROM invoices WHERE id=?', [invId]);
    for (const i of items) {
      const m = await c.one('SELECT * FROM medicines WHERE id=? AND active=1', [i.medicine_id]);
      if (!m) throw bad('Invalid medicine in cart');
      await deductFEFO(c, m.id, int(i.quantity), { movement: 'sale', reference: inv.invoice_no }, req.user);
      await billing.addItem(c, invId, { item_type: 'medicine', ref_id: m.id, description: `${m.name} ${m.strength || ''}`.trim(), quantity: int(i.quantity), unit_price: m.unit_price }, req.user);
    }
    const discount = round2(req.body.discount || 0);
    if (discount > 0) {
      const sub = await c.one('SELECT subtotal FROM invoices WHERE id=?', [invId]);
      if (discount > sub.subtotal) throw bad('Discount cannot exceed the sale total');
      await billing.setDiscount(c, invId, discount, req.user);
    }
    const fresh = await c.one('SELECT * FROM invoices WHERE id=?', [invId]);
    if (req.body.pay_now !== false && fresh.total > 0) {
      await billing.pay(c, invId, { amount: fresh.total, method: req.body.method || 'cash', reference: req.body.reference }, req.user);
    }
    await audit(c, req.user, 'otc_sale', 'invoice', invId, inv.invoice_no);
    return { invoice_id: invId, invoice_no: inv.invoice_no };
  });
  res.json(out);
});

module.exports = r;
