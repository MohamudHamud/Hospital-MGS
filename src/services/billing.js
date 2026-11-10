const { assignNo, round2, bad, notFound } = require('../utils');
const acc = require('./accounting');

async function ensureInvoice(c, { patient_id = null, visit_id = null, customer_name = null }, user) {
  if (visit_id) {
    const inv = await c.one("SELECT id FROM invoices WHERE visit_id=? AND status<>'cancelled' ORDER BY id LIMIT 1", [visit_id]);
    if (inv) return inv.id;
  }
  const r = await c.query('INSERT INTO invoices (patient_id, visit_id, customer_name, created_by) VALUES (?,?,?,?)',
    [patient_id, visit_id, customer_name, user ? user.id : null]);
  await assignNo(c, 'invoices', 'invoice_no', 'INV-', r.insertId);
  return r.insertId;
}

async function recalc(c, invoiceId) {
  const s = await c.one('SELECT COALESCE(SUM(amount),0) AS sub FROM invoice_items WHERE invoice_id=?', [invoiceId]);
  const inv = await c.one('SELECT discount, amount_paid, status FROM invoices WHERE id=?', [invoiceId]);
  if (!inv) throw notFound('Invoice not found');
  if (inv.status === 'cancelled') return;
  const subtotal = round2(s.sub);
  const total = round2(Math.max(0, subtotal - inv.discount));
  const paid = round2(inv.amount_paid);
  const status = total === 0 ? (subtotal === 0 ? 'unpaid' : 'paid') : paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  await c.query('UPDATE invoices SET subtotal=?, total=?, status=? WHERE id=?', [subtotal, total, status, invoiceId]);
}

// Add a charge. Accounting: Dr Accounts Receivable, Cr the matching revenue account.
async function addItem(c, invoiceId, { item_type, ref_id = null, description, quantity = 1, unit_price = 0 }, user) {
  const amount = round2(Number(quantity) * Number(unit_price));
  const r = await c.query('INSERT INTO invoice_items (invoice_id, item_type, ref_id, description, quantity, unit_price, amount) VALUES (?,?,?,?,?,?,?)',
    [invoiceId, item_type, ref_id, description, quantity, unit_price, amount]);
  await recalc(c, invoiceId);
  const inv = await c.one('SELECT invoice_no FROM invoices WHERE id=?', [invoiceId]);
  await acc.simple(c, { description, reference: inv.invoice_no, source: 'invoice', source_id: invoiceId,
    debit: acc.K('ar'), credit: acc.K(acc.REV_KEY[item_type] || 'rev_other'), amount }, user);
  return r.insertId;
}

// Reverse the accounting of a removed charge.
async function removeItem(c, item, user) {
  await c.query('DELETE FROM invoice_items WHERE id=?', [item.id]);
  await recalc(c, item.invoice_id);
  const inv = await c.one('SELECT invoice_no FROM invoices WHERE id=?', [item.invoice_id]);
  await acc.simple(c, { description: `Removed: ${item.description}`, reference: inv.invoice_no, source: 'invoice', source_id: item.invoice_id,
    debit: acc.K(acc.REV_KEY[item.item_type] || 'rev_other'), credit: acc.K('ar'), amount: item.amount }, user);
}

// Change the discount. Accounting posts only the difference: Dr Discounts, Cr Receivable.
async function setDiscount(c, invoiceId, discount, user) {
  const inv = await c.one('SELECT * FROM invoices WHERE id=?', [invoiceId]);
  await c.query('UPDATE invoices SET discount=? WHERE id=?', [discount, invoiceId]);
  await recalc(c, invoiceId);
  await acc.simple(c, { description: `Discount on ${inv.invoice_no}`, reference: inv.invoice_no, source: 'invoice', source_id: invoiceId,
    debit: acc.K('discounts'), credit: acc.K('ar'), amount: round2(discount - inv.discount) }, user);
}

// Cancel an unpaid invoice and reverse everything it posted.
async function cancelInvoice(c, invoiceId, user) {
  const inv = await c.one('SELECT * FROM invoices WHERE id=?', [invoiceId]);
  if (!inv || inv.status === 'cancelled') return;
  if (inv.amount_paid > 0) throw bad('Invoice has payments; it cannot be cancelled');
  const byType = await c.query('SELECT item_type, SUM(amount) amt FROM invoice_items WHERE invoice_id=? GROUP BY item_type', [invoiceId]);
  const lines = byType.map((x) => acc.K(acc.REV_KEY[x.item_type] || 'rev_other', { debit: x.amt }));
  if (inv.discount > 0) lines.push(acc.K('discounts', { credit: inv.discount }));
  lines.push(acc.K('ar', { credit: round2(byType.reduce((s, x) => s + Number(x.amt), 0) - inv.discount) }));
  await acc.post(c, { description: `Cancelled ${inv.invoice_no}`, reference: inv.invoice_no, source: 'invoice', source_id: invoiceId, lines }, user);
  await c.query("UPDATE invoices SET status='cancelled' WHERE id=?", [invoiceId]);
}

// Cash book (simple money in/out list used by the Transactions page).
async function recordTxn(c, { type, category, amount, method, reference, description }, user) {
  const r = await c.query('INSERT INTO transactions (type, category, amount, method, reference, description, user_id) VALUES (?,?,?,?,?,?,?)',
    [type, category, round2(amount), method || null, reference || null, description || null, user ? user.id : null]);
  await assignNo(c, 'transactions', 'txn_no', 'TXN-', r.insertId);
}

// Receive a payment. Accounting: Dr the money account (or Insurance Receivable), Cr Accounts Receivable.
async function pay(c, invoiceId, { amount, method = 'cash', reference = null, account_id = null }, user) {
  amount = round2(amount);
  if (!(amount > 0)) throw bad('Payment amount must be greater than zero');
  const inv = await c.one('SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
  if (!inv) throw notFound('Invoice not found');
  if (inv.status === 'cancelled') throw bad('Invoice is cancelled');
  const balance = round2(inv.total - inv.amount_paid);
  if (amount > balance + 0.001) throw bad(`Amount exceeds balance due (${balance.toFixed(2)})`);
  let depositId = null;
  if (method === 'insurance') depositId = await acc.accountId(c, 'insurance_ar');
  else if (account_id) {
    const a = await c.one('SELECT id FROM accounts WHERE id=? AND is_cash=1 AND active=1', [account_id]);
    if (!a) throw bad('Choose a valid cash or bank account to deposit into');
    depositId = a.id;
  } else depositId = await acc.accountId(c, acc.METHOD_KEY[method] || 'cash');

  const r = await c.query('INSERT INTO payments (invoice_id, amount, method, reference, received_by, account_id) VALUES (?,?,?,?,?,?)',
    [invoiceId, amount, method, reference || null, user ? user.id : null, depositId]);
  const payNo = await assignNo(c, 'payments', 'payment_no', 'RCT-', r.insertId);
  await c.query('UPDATE invoices SET amount_paid = amount_paid + ? WHERE id=?', [amount, invoiceId]);
  await recalc(c, invoiceId);
  await recordTxn(c, {
    type: 'income', category: inv.visit_id ? 'Patient Services' : 'Pharmacy Sales', amount, method,
    reference: inv.invoice_no, description: `Payment ${payNo} for ${inv.invoice_no}`,
  }, user);
  await acc.simple(c, { description: `Payment ${payNo} for ${inv.invoice_no}`, reference: payNo, source: 'payment', source_id: r.insertId,
    debit: acc.A(depositId), credit: acc.K('ar'), amount }, user);
  return { id: r.insertId, payment_no: payNo };
}

module.exports = { ensureInvoice, recalc, addItem, removeItem, setDiscount, cancelInvoice, pay, recordTxn };
