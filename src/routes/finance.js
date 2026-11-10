const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, audit, notFound, bad, round2, assignNo, isDate, today, int } = require('../utils');
const billing = require('../services/billing');
const acc = require('../services/accounting');

const r = Router();
const CASHIER = ['receptionist', 'accountant', 'pharmacist'];

function range(q) {
  const to = isDate(q.to) ? q.to : today();
  let from = isDate(q.from) ? q.from : null;
  if (!from) { const d = new Date(); d.setDate(d.getDate() - 29); from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return { from, to };
}

/* ---------- Invoices ---------- */
r.get('/finance/invoices', allow(...CASHIER), async (req, res) => {
  const p = [];
  let sql = `SELECT i.*, COALESCE(CONCAT(p.first_name,' ',p.last_name), i.customer_name) AS patient_name, p.mrn, v.visit_no, v.status AS visit_status,
             (i.total - i.amount_paid) AS balance FROM invoices i LEFT JOIN patients p ON p.id=i.patient_id LEFT JOIN visits v ON v.id=i.visit_id WHERE 1=1`;
  if (req.query.status) { sql += ' AND i.status IN (?)'; p.push(String(req.query.status).split(',')); }
  if (isDate(req.query.from)) { sql += ' AND DATE(i.created_at)>=?'; p.push(req.query.from); }
  if (isDate(req.query.to)) { sql += ' AND DATE(i.created_at)<=?'; p.push(req.query.to); }
  if (req.query.q) { sql += " AND (i.invoice_no LIKE ? OR CONCAT(p.first_name,' ',p.last_name) LIKE ? OR p.mrn LIKE ? OR i.customer_name LIKE ?)"; const q = `%${req.query.q}%`; p.push(q, q, q, q); }
  sql += ' ORDER BY i.id DESC LIMIT 500';
  res.json(await db.query(sql, p));
});

r.get('/finance/invoices/:id', async (req, res) => {
  const inv = await db.one(`SELECT i.*, COALESCE(CONCAT(p.first_name,' ',p.last_name), i.customer_name) AS patient_name, p.mrn, p.phone, p.address,
    p.insurance_provider, p.insurance_no, v.visit_no, u.name AS doctor_name, cb.name AS created_by_name
    FROM invoices i LEFT JOIN patients p ON p.id=i.patient_id LEFT JOIN visits v ON v.id=i.visit_id LEFT JOIN users u ON u.id=v.doctor_id
    LEFT JOIN users cb ON cb.id=i.created_by WHERE i.id=?`, [req.params.id]);
  if (!inv) throw notFound('Invoice not found');
  inv.items = await db.query('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id', [inv.id]);
  inv.payments = await db.query('SELECT pm.*, u.name AS received_by_name FROM payments pm LEFT JOIN users u ON u.id=pm.received_by WHERE invoice_id=? ORDER BY id', [inv.id]);
  res.json(inv);
});

r.post('/finance/invoices/:id/items', allow(...CASHIER, 'doctor', 'nurse'), async (req, res) => {
  await db.tx(async (c) => {
    const inv = await c.one('SELECT * FROM invoices WHERE id=? FOR UPDATE', [req.params.id]);
    if (!inv) throw notFound();
    if (inv.status === 'cancelled') throw bad('Invoice is cancelled');
    let { description, unit_price } = req.body;
    if (req.body.service_id) {
      const s = await c.one('SELECT * FROM services WHERE id=?', [req.body.service_id]);
      if (!s) throw bad('Invalid service');
      description = s.name; unit_price = s.price;
    }
    need({ description, unit_price }, ['description', 'unit_price']);
    await billing.addItem(c, inv.id, { item_type: req.body.service_id ? 'service' : 'other', ref_id: req.body.service_id || null, description, quantity: Number(req.body.quantity || 1), unit_price: Number(unit_price) }, req.user);
    await audit(c, req.user, 'add_charge', 'invoice', inv.id, `${description} x${req.body.quantity || 1}`);
  });
  res.json({ ok: true });
});

r.delete('/finance/invoices/:id/items/:itemId', allow('accountant'), async (req, res) => {
  await db.tx(async (c) => {
    const it = await c.one('SELECT * FROM invoice_items WHERE id=? AND invoice_id=?', [req.params.itemId, req.params.id]);
    if (!it) throw notFound();
    if (['medicine', 'lab'].includes(it.item_type)) throw bad('Medicine and lab charges are linked to stock/results and cannot be removed here');
    await billing.removeItem(c, it, req.user);
    const inv = await c.one('SELECT total, amount_paid FROM invoices WHERE id=?', [it.invoice_id]);
    if (inv.amount_paid > inv.total) throw bad('Removing this item would leave the invoice overpaid');
    await audit(c, req.user, 'remove_charge', 'invoice', it.invoice_id, it.description);
  });
  res.json({ ok: true });
});

r.post('/finance/invoices/:id/discount', allow('accountant'), async (req, res) => {
  const discount = round2(req.body.discount);
  if (discount < 0) throw bad('Invalid discount');
  await db.tx(async (c) => {
    const inv = await c.one('SELECT * FROM invoices WHERE id=? FOR UPDATE', [req.params.id]);
    if (!inv) throw notFound();
    if (discount > inv.subtotal) throw bad('Discount cannot exceed subtotal');
    if (inv.subtotal - discount < inv.amount_paid) throw bad('Discount would make the invoice overpaid');
    if (inv.status === 'cancelled') throw bad('Invoice is cancelled');
    await billing.setDiscount(c, inv.id, discount, req.user);
    await audit(c, req.user, 'discount', 'invoice', inv.id, `${inv.invoice_no} discount ${discount}`);
  });
  res.json({ ok: true });
});

r.post('/finance/invoices/:id/payments', allow(...CASHIER), async (req, res) => {
  need(req.body, ['amount']);
  const methods = ['cash', 'card', 'mobile', 'bank', 'insurance'];
  const out = await db.tx(async (c) => {
    const p = await billing.pay(c, req.params.id, { amount: req.body.amount, method: methods.includes(req.body.method) ? req.body.method : 'cash', reference: req.body.reference, account_id: req.body.account_id || null }, req.user);
    await audit(c, req.user, 'payment', 'invoice', req.params.id, `${p.payment_no} ${req.body.amount}`);
    return p;
  });
  res.json(out);
});

/* ---------- Expenses ---------- */
r.get('/finance/expenses', allow('accountant'), async (req, res) => {
  const { from, to } = range(req.query);
  res.json(await db.query(`SELECT e.*, u.name AS recorded_by_name, a.code AS account_code, pf.name AS paid_from, s.name AS supplier
    FROM expenses e LEFT JOIN users u ON u.id=e.recorded_by LEFT JOIN accounts a ON a.id=e.account_id
    LEFT JOIN accounts pf ON pf.id=e.paid_from_account_id LEFT JOIN suppliers s ON s.id=e.supplier_id
    WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date DESC, e.id DESC`, [from, to]));
});
// Expense: Dr expense (or fixed asset) account, Cr money account / Accounts Payable.
r.post('/finance/expenses', allow('accountant'), async (req, res) => {
  need(req.body, ['account_id', 'amount', 'expense_date', 'payment']);
  const amount = round2(req.body.amount);
  if (amount <= 0) throw bad('Amount must be positive');
  if (!isDate(req.body.expense_date)) throw bad('Invalid date');
  const out = await db.tx(async (c) => {
    const acct = await c.one("SELECT * FROM accounts WHERE id=? AND active=1 AND is_group=0 AND is_cash=0 AND type IN ('expense','asset')", [req.body.account_id]);
    if (!acct) throw bad('Choose a valid expense account');
    const pay = await acc.paymentSide(c, req.body.payment, req.body.supplier_id);
    if (pay.credit && !req.body.supplier_id) throw bad('Choose the supplier you owe for a credit expense');
    const method = pay.method || 'cash';
    const x = await c.query('INSERT INTO expenses (category, description, amount, method, paid_to, expense_date, recorded_by, account_id, paid_from_account_id, supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [acct.name, req.body.description || null, amount, method, req.body.paid_to || null, req.body.expense_date, req.user.id, acct.id,
        pay.side.account_id || null, req.body.supplier_id || null]);
    const no = await assignNo(c, 'expenses', 'expense_no', 'EXP-', x.insertId);
    if (pay.paid) {
      await billing.recordTxn(c, { type: 'expense', category: acct.name, amount, method, reference: no, description: req.body.description || req.body.paid_to }, req.user);
    }
    await acc.simple(c, { date: req.body.expense_date, description: `${acct.name}${req.body.description ? ': ' + req.body.description : ''}`, reference: no, source: 'expense', source_id: x.insertId,
      debit: acc.A(acct.id), credit: pay.side, amount }, req.user);
    await audit(c, req.user, 'expense', 'expense', x.insertId, `${no} ${acct.name} ${amount}`);
    return { id: x.insertId, expense_no: no };
  });
  res.json(out);
});

/* ---------- Ledger ---------- */
r.get('/finance/transactions', allow('accountant'), async (req, res) => {
  const { from, to } = range(req.query);
  const p = [from, to];
  let sql = `SELECT t.*, u.name AS user_name FROM transactions t LEFT JOIN users u ON u.id=t.user_id WHERE DATE(t.created_at) BETWEEN ? AND ?`;
  if (req.query.type) { sql += ' AND t.type=?'; p.push(req.query.type); }
  res.json(await db.query(sql + ' ORDER BY t.id DESC LIMIT 2000', p));
});

/* ---------- Reports ---------- */
r.get('/finance/summary', allow('accountant'), async (req, res) => {
  const { from, to } = range(req.query);
  const P = [from, to];
  const [totals, billed, outstanding, daily, byType, byMethod, expByCat, topDoctors, topMeds, topTests] = await Promise.all([
    db.one(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income, COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense
            FROM transactions WHERE DATE(created_at) BETWEEN ? AND ?`, P),
    db.one(`SELECT COALESCE(SUM(total),0) billed, COALESCE(SUM(discount),0) discounts, COUNT(*) invoices FROM invoices WHERE status<>'cancelled' AND DATE(created_at) BETWEEN ? AND ?`, P),
    db.one(`SELECT COALESCE(SUM(total-amount_paid),0) amount, COUNT(*) n FROM invoices WHERE status IN ('unpaid','partial')`),
    db.query(`SELECT DATE(created_at) d, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) expense
              FROM transactions WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY d`, P),
    db.query(`SELECT ii.item_type, SUM(ii.amount) amount FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
              WHERE i.status<>'cancelled' AND DATE(ii.created_at) BETWEEN ? AND ? GROUP BY ii.item_type ORDER BY amount DESC`, P),
    db.query(`SELECT method, SUM(amount) amount, COUNT(*) n FROM payments WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC`, P),
    db.query(`SELECT category, SUM(amount) amount FROM transactions WHERE type='expense' AND DATE(created_at) BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`, P),
    db.query(`SELECT u.name, COUNT(DISTINCT v.id) visits, COALESCE(SUM(i.total),0) revenue FROM visits v JOIN users u ON u.id=v.doctor_id
              LEFT JOIN invoices i ON i.visit_id=v.id AND i.status<>'cancelled' WHERE v.status<>'cancelled' AND v.queue_date BETWEEN ? AND ?
              GROUP BY u.id ORDER BY revenue DESC LIMIT 10`, P),
    db.query(`SELECT ii.description name, SUM(ii.quantity) qty, SUM(ii.amount) amount FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
              WHERE ii.item_type='medicine' AND i.status<>'cancelled' AND DATE(ii.created_at) BETWEEN ? AND ? GROUP BY ii.description ORDER BY amount DESC LIMIT 10`, P),
    db.query(`SELECT ii.description name, COUNT(*) n, SUM(ii.amount) amount FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
              WHERE ii.item_type='lab' AND i.status<>'cancelled' AND DATE(ii.created_at) BETWEEN ? AND ? GROUP BY ii.description ORDER BY n DESC LIMIT 10`, P),
  ]);
  res.json({ from, to, income: totals.income, expense: totals.expense, net: round2(totals.income - totals.expense), billed: billed.billed,
    discounts: billed.discounts, invoices: billed.invoices, outstanding, daily, by_type: byType, by_method: byMethod, expense_by_category: expByCat,
    top_doctors: topDoctors, top_medicines: topMeds, top_tests: topTests });
});

module.exports = r;
