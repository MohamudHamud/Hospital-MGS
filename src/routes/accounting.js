const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, bad, notFound, audit, round2, isDate, today, int } = require('../utils');
const acc = require('../services/accounting');
const billing = require('../services/billing');

const r = Router();
const FIN = ['accountant'];
const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

// Balances per account for a date range; rolls children into their group parents.
async function balances(from, to) {
  const rows = await db.query(`SELECT a.*, p.name AS parent_name, COALESCE(x.dr,0) dr, COALESCE(x.cr,0) cr, COALESCE(x.n,0) line_count
    FROM accounts a LEFT JOIN accounts p ON p.id=a.parent_id
    LEFT JOIN (SELECT l.account_id, SUM(l.debit) dr, SUM(l.credit) cr, COUNT(*) n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
               WHERE e.entry_date BETWEEN ? AND ? GROUP BY l.account_id) x ON x.account_id=a.id
    ORDER BY a.code`, [from || '1900-01-01', to || '2999-12-31']);
  const byId = new Map(rows.map((a) => [a.id, { ...a, own_dr: a.dr, own_cr: a.cr }]));
  for (const a of byId.values()) {
    let p = a.parent_id ? byId.get(a.parent_id) : null;
    const guard = new Set();
    while (p && !guard.has(p.id)) { guard.add(p.id); p.dr += a.own_dr; p.cr += a.own_cr; p = p.parent_id ? byId.get(p.parent_id) : null; }
  }
  for (const a of byId.values()) {
    a.dr = round2(a.dr); a.cr = round2(a.cr);
    a.balance = round2(acc.DEBIT_NORMAL.has(a.type) ? a.dr - a.cr : a.cr - a.dr);
    a.own_balance = round2(acc.DEBIT_NORMAL.has(a.type) ? a.own_dr - a.own_cr : a.own_cr - a.own_dr);
  }
  return [...byId.values()];
}

/* ---------- Chart of accounts ---------- */
// Money accounts are needed by cashiers, pharmacy and stores, so any signed-in user may list them.
r.get('/accounting/money-accounts', async (req, res) => {
  res.json(await db.query('SELECT id, code, name, system_key FROM accounts WHERE is_cash=1 AND active=1 AND is_group=0 ORDER BY code'));
});

r.get('/accounting/accounts', allow(...FIN), async (req, res) => {
  const asOf = isDate(req.query.as_of) ? req.query.as_of : null;
  res.json(await balances(null, asOf));
});

async function validateParent(c, parentId, type, selfId = null) {
  if (!parentId) return null;
  const p = await c.one('SELECT * FROM accounts WHERE id=?', [parentId]);
  if (!p) throw bad('Parent account not found');
  if (!p.is_group) throw bad('Parent must be a group (header) account');
  if (p.type !== type) throw bad(`Parent is a ${p.type} account; it must match the account type`);
  if (selfId) {
    let cur = p; const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      if (cur.id === Number(selfId)) throw bad('An account cannot be placed under itself');
      seen.add(cur.id);
      cur = cur.parent_id ? await c.one('SELECT id, parent_id FROM accounts WHERE id=?', [cur.parent_id]) : null;
    }
  }
  return p.id;
}

r.post('/accounting/accounts', allow(...FIN), async (req, res) => {
  need(req.body, ['code', 'name', 'type']);
  if (!TYPES.includes(req.body.type)) throw bad('Invalid account type');
  const isGroup = req.body.is_group ? 1 : 0;
  const isCash = !isGroup && req.body.type === 'asset' && req.body.is_cash ? 1 : 0;
  const parent = await validateParent(db, req.body.parent_id, req.body.type);
  const x = await db.query('INSERT INTO accounts (code, name, type, parent_id, is_group, is_cash, description) VALUES (?,?,?,?,?,?,?)',
    [String(req.body.code).trim(), String(req.body.name).trim(), req.body.type, parent, isGroup, isCash, req.body.description || null]);
  // Optional opening balance -> against Opening Balance Equity
  const ob = round2(req.body.opening_balance || 0);
  if (ob && !isGroup) {
    const debitNormal = acc.DEBIT_NORMAL.has(req.body.type);
    await acc.simple(db, { date: isDate(req.body.opening_date) ? req.body.opening_date : today(), description: `Opening balance: ${req.body.name}`, source: 'opening', source_id: x.insertId,
      debit: debitNormal ? acc.A(x.insertId) : acc.K('opening_equity'), credit: debitNormal ? acc.K('opening_equity') : acc.A(x.insertId), amount: ob }, req.user);
  }
  await audit(db, req.user, 'create', 'account', x.insertId, `${req.body.code} ${req.body.name}`);
  res.json({ id: x.insertId });
});

r.put('/accounting/accounts/:id', allow(...FIN), async (req, res) => {
  const a = await db.one('SELECT * FROM accounts WHERE id=?', [req.params.id]);
  if (!a) throw notFound('Account not found');
  const used = (await db.one('SELECT COUNT(*) n FROM journal_lines WHERE account_id=?', [a.id])).n;
  const kids = (await db.one('SELECT COUNT(*) n FROM accounts WHERE parent_id=?', [a.id])).n;
  const d = {};
  if (req.body.code !== undefined) d.code = String(req.body.code).trim();
  if (req.body.name !== undefined) d.name = String(req.body.name).trim();
  if (req.body.description !== undefined) d.description = req.body.description || null;
  if (req.body.type !== undefined && req.body.type !== a.type) {
    if (!TYPES.includes(req.body.type)) throw bad('Invalid account type');
    if (used || kids || a.system_key) throw bad('Type cannot change for an account that has transactions, sub-accounts or is used by the system');
    d.type = req.body.type;
  }
  const type = d.type || a.type;
  if (req.body.parent_id !== undefined) d.parent_id = await validateParent(db, req.body.parent_id || null, type, a.id);
  if (req.body.is_group !== undefined) {
    const g = req.body.is_group ? 1 : 0;
    if (g !== a.is_group) {
      if (g && used) throw bad('An account with transactions cannot become a group');
      if (!g && kids) throw bad('Move the sub-accounts out before turning this group into a normal account');
      if (a.system_key) throw bad('System accounts cannot be changed into groups');
      d.is_group = g;
    }
  }
  if (req.body.is_cash !== undefined && !a.system_key) d.is_cash = req.body.is_cash && type === 'asset' && !(d.is_group ?? a.is_group) ? 1 : 0;
  if (req.body.active !== undefined) {
    const act = req.body.active ? 1 : 0;
    if (!act && a.system_key) throw bad('System accounts are required and cannot be deactivated');
    d.active = act;
  }
  if (!Object.keys(d).length) throw bad('Nothing to update');
  await db.query('UPDATE accounts SET ? WHERE id=?', [d, a.id]);
  await audit(db, req.user, 'update', 'account', a.id, `${a.code} ${a.name}`);
  res.json({ ok: true });
});

r.delete('/accounting/accounts/:id', allow(...FIN), async (req, res) => {
  const a = await db.one('SELECT * FROM accounts WHERE id=?', [req.params.id]);
  if (!a) throw notFound('Account not found');
  if (a.system_key) throw bad('System accounts cannot be deleted');
  if ((await db.one('SELECT COUNT(*) n FROM journal_lines WHERE account_id=?', [a.id])).n) throw bad('This account has transactions. Deactivate it instead.');
  if ((await db.one('SELECT COUNT(*) n FROM accounts WHERE parent_id=?', [a.id])).n) throw bad('Remove or move its sub-accounts first');
  await db.query('DELETE FROM accounts WHERE id=?', [a.id]);
  await audit(db, req.user, 'delete', 'account', a.id, `${a.code} ${a.name}`);
  res.json({ ok: true });
});

/* ---------- Ledger ---------- */
r.get('/accounting/accounts/:id/ledger', allow(...FIN), async (req, res) => {
  const a = await db.one('SELECT * FROM accounts WHERE id=?', [req.params.id]);
  if (!a) throw notFound('Account not found');
  const from = isDate(req.query.from) ? req.query.from : firstOfYear();
  const to = isDate(req.query.to) ? req.query.to : today();
  // include sub-accounts for group accounts
  const all = await db.query('SELECT id, parent_id FROM accounts');
  const ids = [a.id];
  for (let i = 0; i < ids.length; i++) all.filter((x) => x.parent_id === ids[i]).forEach((x) => ids.push(x.id));
  const sign = acc.DEBIT_NORMAL.has(a.type) ? 1 : -1;
  const ob = await db.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.account_id IN (?) AND e.entry_date < ?`, [ids, from]);
  const lines = await db.query(`SELECT l.*, e.entry_no, e.entry_date, e.description, e.reference, e.source, e.status, ac.code account_code, ac.name account_name, s.name supplier
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts ac ON ac.id=l.account_id LEFT JOIN suppliers s ON s.id=l.supplier_id
    WHERE l.account_id IN (?) AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date, e.id, l.id LIMIT 5000`, [ids, from, to]);
  let run = round2(ob.b * sign);
  const opening = run;
  for (const l of lines) { run = round2(run + (l.debit - l.credit) * sign); l.balance = run; }
  res.json({ account: a, from, to, opening, closing: run, lines,
    total_debit: round2(lines.reduce((s, l) => s + l.debit, 0)), total_credit: round2(lines.reduce((s, l) => s + l.credit, 0)) });
});

/* ---------- Journals ---------- */
r.get('/accounting/journals', allow(...FIN), async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : today();
  const to = isDate(req.query.to) ? req.query.to : today();
  const p = [from, to];
  let sql = `SELECT e.*, u.name created_by_name, (SELECT SUM(debit) FROM journal_lines WHERE entry_id=e.id) amount
    FROM journal_entries e LEFT JOIN users u ON u.id=e.created_by WHERE e.entry_date BETWEEN ? AND ?`;
  if (req.query.source) { sql += ' AND e.source=?'; p.push(req.query.source); }
  if (req.query.q) { sql += ' AND (e.description LIKE ? OR e.reference LIKE ? OR e.entry_no LIKE ?)'; const q = `%${req.query.q}%`; p.push(q, q, q); }
  const entries = await db.query(sql + ' ORDER BY e.entry_date DESC, e.id DESC LIMIT 1000', p);
  if (entries.length) {
    const lines = await db.query(`SELECT l.*, a.code, a.name FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id IN (?) ORDER BY l.id`, [entries.map((e) => e.id)]);
    for (const e of entries) e.lines = lines.filter((l) => l.entry_id === e.id);
  }
  res.json(entries);
});

async function checkLines(c, lines) {
  for (const l of lines) {
    const a = await c.one('SELECT id, is_group, active, name FROM accounts WHERE id=?', [l.account_id]);
    if (!a) throw bad('Unknown account in journal');
    if (a.is_group) throw bad(`"${a.name}" is a group account; post to one of its sub-accounts`);
    if (!a.active) throw bad(`"${a.name}" is inactive`);
  }
}

r.post('/accounting/journals', allow(...FIN), async (req, res) => {
  need(req.body, ['entry_date', 'description']);
  if (!isDate(req.body.entry_date)) throw bad('Invalid date');
  const lines = (req.body.lines || []).filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)))
    .map((l) => ({ account_id: Number(l.account_id), debit: round2(l.debit), credit: round2(l.credit), memo: l.memo || null, supplier_id: l.supplier_id || null }));
  if (lines.length < 2) throw bad('A journal needs at least two lines');
  if (lines.some((l) => l.debit && l.credit)) throw bad('A line can have a debit or a credit, not both');
  const out = await db.tx(async (c) => {
    await checkLines(c, lines);
    const e = await acc.post(c, { date: req.body.entry_date, description: req.body.description, reference: req.body.reference || null, source: 'manual', lines }, req.user);
    await audit(c, req.user, 'journal', 'journal', e.id, `${e.entry_no} ${req.body.description}`);
    return e;
  });
  res.json(out);
});

// Reverse a manual entry (posted entries are never edited or deleted).
r.post('/accounting/journals/:id/reverse', allow(...FIN), async (req, res) => {
  const out = await db.tx(async (c) => {
    const e = await c.one('SELECT * FROM journal_entries WHERE id=? FOR UPDATE', [req.params.id]);
    if (!e) throw notFound('Journal not found');
    if (e.status === 'reversed') throw bad('Already reversed');
    if (!['manual', 'transfer', 'opening', 'supplier_payment'].includes(e.source)) throw bad('Automatic entries are reversed by correcting the original document (invoice, payment, stock)');
    if (e.source === 'supplier_payment') throw bad('Supplier payments cannot be reversed here; post a correcting journal');
    const lines = await c.query('SELECT * FROM journal_lines WHERE entry_id=?', [e.id]);
    const rev = await acc.post(c, { date: isDate(req.body.date) ? req.body.date : today(), description: `Reversal of ${e.entry_no}: ${e.description || ''}`, reference: e.entry_no,
      source: 'reversal', source_id: e.id, reversal_of: e.id,
      lines: lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo, supplier_id: l.supplier_id })) }, req.user);
    await c.query("UPDATE journal_entries SET status='reversed' WHERE id=?", [e.id]);
    await audit(c, req.user, 'reverse', 'journal', e.id, `${e.entry_no} -> ${rev.entry_no}`);
    return rev;
  });
  res.json(out);
});

/* ---------- Quick actions ---------- */
r.post('/accounting/transfer', allow(...FIN), async (req, res) => {
  need(req.body, ['from_account_id', 'to_account_id', 'amount', 'date']);
  const amount = round2(req.body.amount);
  if (amount <= 0) throw bad('Amount must be positive');
  if (String(req.body.from_account_id) === String(req.body.to_account_id)) throw bad('Choose two different accounts');
  const out = await db.tx(async (c) => {
    const [f, t] = [await c.one('SELECT * FROM accounts WHERE id=? AND is_cash=1 AND active=1', [req.body.from_account_id]), await c.one('SELECT * FROM accounts WHERE id=? AND is_cash=1 AND active=1', [req.body.to_account_id])];
    if (!f || !t) throw bad('Transfers are between active cash / bank accounts');
    const e = await acc.simple(c, { date: req.body.date, description: req.body.memo || `Transfer ${f.name} → ${t.name}`, reference: req.body.reference || null, source: 'transfer',
      debit: acc.A(t.id), credit: acc.A(f.id), amount }, req.user);
    await audit(c, req.user, 'transfer', 'journal', e.id, `${f.name} -> ${t.name} ${amount}`);
    return e;
  });
  res.json(out);
});

r.post('/accounting/supplier-payment', allow(...FIN), async (req, res) => {
  need(req.body, ['supplier_id', 'account_id', 'amount', 'date']);
  const amount = round2(req.body.amount);
  if (amount <= 0) throw bad('Amount must be positive');
  const out = await db.tx(async (c) => {
    const s = await c.one('SELECT * FROM suppliers WHERE id=?', [req.body.supplier_id]);
    if (!s) throw bad('Supplier not found');
    const pay = await acc.paymentSide(c, `acct:${req.body.account_id}`);
    const e = await acc.simple(c, { date: req.body.date, description: `Payment to ${s.name}${req.body.memo ? ': ' + req.body.memo : ''}`, reference: req.body.reference || null,
      source: 'supplier_payment', source_id: s.id, debit: acc.K('ap', { supplier_id: s.id }), credit: pay.side, amount }, req.user);
    await billing.recordTxn(c, { type: 'expense', category: 'Supplier Payment', amount, method: pay.method, reference: req.body.reference || e.entry_no, description: `Payment to ${s.name}` }, req.user);
    await audit(c, req.user, 'supplier_payment', 'supplier', s.id, `${s.name} ${amount}`);
    return e;
  });
  res.json(out);
});

/* ---------- Statements ---------- */
r.get('/accounting/trial-balance', allow(...FIN), async (req, res) => {
  const asOf = isDate(req.query.as_of) ? req.query.as_of : today();
  const rows = (await balances(null, asOf)).filter((a) => !a.is_group && (a.own_dr || a.own_cr));
  const out = rows.map((a) => {
    const net = round2(a.own_dr - a.own_cr);
    return { id: a.id, code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).filter((a) => a.debit || a.credit);
  res.json({ as_of: asOf, rows: out, total_debit: round2(out.reduce((s, a) => s + a.debit, 0)), total_credit: round2(out.reduce((s, a) => s + a.credit, 0)) });
});

function tree(rows, type) {
  const list = rows.filter((a) => a.type === type);
  const kids = (pid) => list.filter((a) => (a.parent_id || null) === pid && (a.is_group || a.balance)).map((a) => ({ id: a.id, code: a.code, name: a.name, is_group: a.is_group, balance: a.balance, children: kids(a.id) }));
  const roots = list.filter((a) => !a.parent_id || !list.find((p) => p.id === a.parent_id));
  return roots.filter((a) => a.is_group || a.balance).map((a) => ({ id: a.id, code: a.code, name: a.name, is_group: a.is_group, balance: a.balance, children: kids(a.id) }));
}
const total = (rows, type) => round2(rows.filter((a) => a.type === type && !a.is_group).reduce((s, a) => s + a.own_balance, 0));

r.get('/accounting/income-statement', allow(...FIN), async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : `${today().slice(0, 7)}-01`;
  const to = isDate(req.query.to) ? req.query.to : today();
  const rows = await balances(from, to);
  const income = total(rows, 'income'), expense = total(rows, 'expense');
  const cogsIds = new Set(rows.filter((a) => ['cogs', 'supplies_used', 'writeoff'].includes(a.system_key)).map((a) => a.id));
  const cogs = round2(rows.filter((a) => cogsIds.has(a.id)).reduce((s, a) => s + a.own_balance, 0));
  res.json({ from, to, income: tree(rows, 'income'), expenses: tree(rows, 'expense'), total_income: income, total_expense: expense,
    cost_of_sales: cogs, gross_profit: round2(income - cogs), net_profit: round2(income - expense) });
});

r.get('/accounting/balance-sheet', allow(...FIN), async (req, res) => {
  const asOf = isDate(req.query.as_of) ? req.query.as_of : today();
  const rows = await balances(null, asOf);
  const earnings = round2(total(rows, 'income') - total(rows, 'expense'));
  const assets = total(rows, 'asset'), liabilities = total(rows, 'liability'), equity = total(rows, 'equity');
  res.json({ as_of: asOf, assets: tree(rows, 'asset'), liabilities: tree(rows, 'liability'), equity: tree(rows, 'equity'),
    total_assets: assets, total_liabilities: liabilities, total_equity: round2(equity + earnings), current_earnings: earnings,
    difference: round2(assets - liabilities - equity - earnings) });
});

r.get('/accounting/ar-aging', allow(...FIN), async (req, res) => {
  const rows = await db.query(`SELECT i.id, i.invoice_no, i.created_at, i.total, i.amount_paid, (i.total-i.amount_paid) balance, DATEDIFF(CURDATE(), DATE(i.created_at)) age,
    COALESCE(CONCAT(p.first_name,' ',p.last_name), i.customer_name) patient_name, p.phone, p.mrn, p.insurance_provider
    FROM invoices i LEFT JOIN patients p ON p.id=i.patient_id WHERE i.status IN ('unpaid','partial') AND i.total-i.amount_paid > 0 ORDER BY age DESC`);
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const x of rows) {
    x.bucket = x.age <= 30 ? '0-30' : x.age <= 60 ? '31-60' : x.age <= 90 ? '61-90' : '90+';
    buckets[x.bucket] = round2(buckets[x.bucket] + x.balance);
  }
  const ins = await db.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.system_key='insurance_ar'`);
  res.json({ rows, buckets, total: round2(rows.reduce((s, x) => s + x.balance, 0)), insurance_receivable: round2(ins.b) });
});

r.get('/accounting/payables', allow(...FIN), async (req, res) => {
  const rows = await db.query(`SELECT s.id, s.name, s.phone, COALESCE(SUM(l.credit),0) purchased, COALESCE(SUM(l.debit),0) paid, COALESCE(SUM(l.credit-l.debit),0) balance
    FROM suppliers s LEFT JOIN journal_lines l ON l.supplier_id=s.id AND l.account_id=(SELECT id FROM accounts WHERE system_key='ap')
    GROUP BY s.id ORDER BY balance DESC, s.name`);
  const ap = await db.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.system_key='ap'`);
  res.json({ rows, total: round2(ap.b), unassigned: round2(ap.b - rows.reduce((s, x) => s + x.balance, 0)) });
});

r.get('/accounting/supplier/:id/statement', allow(...FIN), async (req, res) => {
  const s = await db.one('SELECT * FROM suppliers WHERE id=?', [req.params.id]);
  if (!s) throw notFound('Supplier not found');
  const lines = await db.query(`SELECT l.debit, l.credit, e.entry_no, e.entry_date, e.description, e.reference FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.supplier_id=? AND l.account_id=(SELECT id FROM accounts WHERE system_key='ap') ORDER BY e.entry_date, e.id`, [s.id]);
  let run = 0;
  for (const l of lines) { run = round2(run + l.credit - l.debit); l.balance = run; }
  res.json({ supplier: s, lines, balance: run });
});

r.get('/accounting/overview', allow(...FIN), async (req, res) => {
  const rows = await balances(null, today());
  const month = await balances(`${today().slice(0, 7)}-01`, today());
  const key = (k) => rows.find((a) => a.system_key === k) || { balance: 0 };
  res.json({
    money: rows.filter((a) => a.is_cash && !a.is_group && a.active).map((a) => ({ id: a.id, code: a.code, name: a.name, balance: a.balance })),
    cash_total: round2(rows.filter((a) => a.is_cash && !a.is_group).reduce((s, a) => s + a.balance, 0)),
    receivable: round2(key('ar').balance + key('insurance_ar').balance),
    payable: key('ap').balance,
    inventory: round2(key('inventory_meds').balance + key('inventory_supplies').balance),
    month_income: total(month, 'income'), month_expense: total(month, 'expense'), month_profit: round2(total(month, 'income') - total(month, 'expense')),
  });
});

module.exports = r;
