// Double-entry accounting engine: chart of accounts, journal posting, migration/backfill.
const { bad, pad, round2 } = require('../utils');

/* ---------- Schema (idempotent) ---------- */
const DDL = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    type ENUM('asset','liability','equity','income','expense') NOT NULL,
    parent_id INT NULL,
    is_group TINYINT(1) NOT NULL DEFAULT 0,
    is_cash TINYINT(1) NOT NULL DEFAULT 0,
    system_key VARCHAR(40) NULL UNIQUE,
    description VARCHAR(255),
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entry_no VARCHAR(24) UNIQUE,
    entry_date DATE NOT NULL,
    description VARCHAR(255),
    reference VARCHAR(80),
    source ENUM('manual','invoice','payment','expense','purchase','stock','transfer','supplier_payment','opening','reversal') NOT NULL DEFAULT 'manual',
    source_id INT NULL,
    status ENUM('posted','reversed') NOT NULL DEFAULT 'posted',
    reversal_of INT NULL,
    created_by INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_je_date (entry_date),
    INDEX idx_je_source (source, source_id)
  )`,
  `CREATE TABLE IF NOT EXISTS journal_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entry_id INT NOT NULL,
    account_id INT NOT NULL,
    debit DECIMAL(14,2) NOT NULL DEFAULT 0,
    credit DECIMAL(14,2) NOT NULL DEFAULT 0,
    memo VARCHAR(255),
    supplier_id INT NULL,
    FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    INDEX idx_jl_account (account_id),
    INDEX idx_jl_supplier (supplier_id)
  )`,
];
const COLUMNS = [
  ['expenses', 'account_id', 'INT NULL'],
  ['expenses', 'paid_from_account_id', 'INT NULL'],
  ['expenses', 'supplier_id', 'INT NULL'],
  ['payments', 'account_id', 'INT NULL'],
];

/* ---------- Default chart of accounts ---------- */
// [code, name, type, parentCode, opts]
const COA = [
  ['1000', 'Assets', 'asset', null, { group: 1 }],
  ['1100', 'Cash & Bank', 'asset', '1000', { group: 1 }],
  ['1101', 'Cash on Hand (Cashier)', 'asset', '1100', { cash: 1, key: 'cash' }],
  ['1102', 'Bank Account', 'asset', '1100', { cash: 1, key: 'bank' }],
  ['1103', 'Mobile Money (EVC / Zaad / Sahal)', 'asset', '1100', { cash: 1, key: 'mobile' }],
  ['1104', 'Card Settlement Account', 'asset', '1100', { cash: 1, key: 'card' }],
  ['1200', 'Receivables', 'asset', '1000', { group: 1 }],
  ['1201', 'Accounts Receivable - Patients', 'asset', '1200', { key: 'ar' }],
  ['1202', 'Insurance Receivable', 'asset', '1200', { key: 'insurance_ar' }],
  ['1300', 'Inventory', 'asset', '1000', { group: 1 }],
  ['1301', 'Pharmacy Inventory', 'asset', '1300', { key: 'inventory_meds' }],
  ['1302', 'Medical Supplies Inventory', 'asset', '1300', { key: 'inventory_supplies' }],
  ['1500', 'Fixed Assets', 'asset', '1000', { group: 1 }],
  ['1501', 'Medical Equipment', 'asset', '1500', {}],
  ['1502', 'Furniture & Fittings', 'asset', '1500', {}],
  ['1503', 'Vehicles', 'asset', '1500', {}],
  ['2000', 'Liabilities', 'liability', null, { group: 1 }],
  ['2101', 'Accounts Payable - Suppliers', 'liability', '2000', { key: 'ap' }],
  ['2102', 'Salaries Payable', 'liability', '2000', {}],
  ['2103', 'Taxes Payable', 'liability', '2000', {}],
  ['2104', 'Patient Deposits / Advances', 'liability', '2000', {}],
  ['2105', 'Loans Payable', 'liability', '2000', {}],
  ['3000', 'Equity', 'equity', null, { group: 1 }],
  ['3101', "Owner's Capital", 'equity', '3000', { key: 'capital' }],
  ['3102', 'Retained Earnings', 'equity', '3000', { key: 'retained' }],
  ['3103', 'Opening Balance Equity', 'equity', '3000', { key: 'opening_equity' }],
  ['3104', "Owner's Drawings", 'equity', '3000', {}],
  ['4000', 'Income', 'income', null, { group: 1 }],
  ['4101', 'Consultation Revenue', 'income', '4000', { key: 'rev_consultation' }],
  ['4102', 'Laboratory Revenue', 'income', '4000', { key: 'rev_lab' }],
  ['4103', 'Pharmacy Sales', 'income', '4000', { key: 'rev_medicine' }],
  ['4104', 'Procedures & Services Revenue', 'income', '4000', { key: 'rev_service' }],
  ['4105', 'Other Income', 'income', '4000', { key: 'rev_other' }],
  ['4106', 'Inventory Gains', 'income', '4000', { key: 'stock_gain' }],
  ['4901', 'Discounts & Waivers Given', 'income', '4000', { key: 'discounts' }],
  ['5000', 'Expenses', 'expense', null, { group: 1 }],
  ['5100', 'Cost of Sales', 'expense', '5000', { group: 1 }],
  ['5101', 'Cost of Medicines Sold', 'expense', '5100', { key: 'cogs' }],
  ['5102', 'Medical Supplies Used', 'expense', '5100', { key: 'supplies_used' }],
  ['5103', 'Stock Write-offs (Expired/Damaged)', 'expense', '5100', { key: 'writeoff' }],
  ['5200', 'Operating Expenses', 'expense', '5000', { group: 1 }],
  ['5201', 'Salaries & Wages', 'expense', '5200', {}],
  ['5202', 'Utilities (Electricity, Water)', 'expense', '5200', {}],
  ['5203', 'Rent', 'expense', '5200', {}],
  ['5204', 'Repairs & Maintenance', 'expense', '5200', {}],
  ['5205', 'Office & General Supplies', 'expense', '5200', {}],
  ['5206', 'Transport & Fuel', 'expense', '5200', {}],
  ['5207', 'Marketing & Advertising', 'expense', '5200', {}],
  ['5208', 'Taxes, Licenses & Fees', 'expense', '5200', {}],
  ['5209', 'Bank & Mobile Money Charges', 'expense', '5200', {}],
  ['5210', 'Internet & Communication', 'expense', '5200', {}],
  ['5211', 'Cleaning & Security', 'expense', '5200', {}],
  ['5299', 'Other Expenses', 'expense', '5200', { key: 'other_expense' }],
];
// Legacy expense category -> account code
const CATEGORY_CODE = {
  Salaries: '5201', Utilities: '5202', Rent: '5203', Maintenance: '5204', Supplies: '5205', 'Medicine Purchase': '5101',
  Equipment: '1501', Transport: '5206', Marketing: '5207', 'Taxes & Fees': '5208', Other: '5299',
};
const REV_KEY = { consultation: 'rev_consultation', lab: 'rev_lab', medicine: 'rev_medicine', service: 'rev_service', other: 'rev_other' };
const METHOD_KEY = { cash: 'cash', bank: 'bank', mobile: 'mobile', card: 'card', insurance: 'insurance_ar' };
const DEBIT_NORMAL = new Set(['asset', 'expense']);

/* ---------- Lookups ---------- */
async function accountId(c, key) {
  const a = await c.one('SELECT id FROM accounts WHERE system_key=?', [key]);
  if (!a) throw new Error(`System account "${key}" is missing from the chart of accounts`);
  return a.id;
}
async function accountByCode(c, code) {
  const a = await c.one('SELECT id FROM accounts WHERE code=?', [code]);
  return a ? a.id : null;
}

const ymd = (d) => {
  if (!d) d = new Date();
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------- Posting ---------- */
// lines: [{ account_id | key, debit, credit, memo, supplier_id }]
async function post(c, { date, description, reference = null, source = 'manual', source_id = null, lines, reversal_of = null }, user) {
  const resolved = [];
  for (const l of lines) {
    const debit = round2(l.debit || 0), credit = round2(l.credit || 0);
    if (debit < 0 || credit < 0) throw bad('Debit and credit amounts cannot be negative');
    if (!debit && !credit) continue;
    const account_id = l.account_id || (await accountId(c, l.key));
    resolved.push({ account_id, debit, credit, memo: l.memo || null, supplier_id: l.supplier_id || null });
  }
  if (resolved.length < 2) return null;
  const dr = round2(resolved.reduce((s, l) => s + l.debit, 0));
  const cr = round2(resolved.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.005) throw bad(`Journal is not balanced (debits ${dr.toFixed(2)} vs credits ${cr.toFixed(2)})`);
  const d = ymd(date);
  const r = await c.query('INSERT INTO journal_entries (entry_date, description, reference, source, source_id, reversal_of, created_by) VALUES (?,?,?,?,?,?,?)',
    [d, description ? String(description).slice(0, 255) : null, reference, source, source_id, reversal_of, user ? user.id : null]);
  const no = `JE-${d.replace(/-/g, '').slice(2)}-${pad(r.insertId)}`;
  await c.query('UPDATE journal_entries SET entry_no=? WHERE id=?', [no, r.insertId]);
  for (const l of resolved) {
    await c.query('INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo, supplier_id) VALUES (?,?,?,?,?,?)',
      [r.insertId, l.account_id, l.debit, l.credit, l.memo, l.supplier_id]);
  }
  return { id: r.insertId, entry_no: no };
}

// Shorthand for a two-line entry. amount < 0 swaps sides.
async function simple(c, { debit, credit, amount, ...rest }, user) {
  amount = round2(amount);
  if (!amount) return null;
  if (amount < 0) { [debit, credit] = [credit, debit]; amount = -amount; }
  return post(c, { ...rest, lines: [{ ...debit, debit: amount }, { ...credit, credit: amount }] }, user);
}
const K = (key, extra = {}) => ({ key, ...extra });
const A = (account_id, extra = {}) => ({ account_id, ...extra });

// Turn a "payment" choice from a form into the credit side of a purchase/expense.
//   'acct:<id>' -> a money account,  'credit' -> Accounts Payable (supplier),  'none' -> Opening Balance Equity
//   legacy method names ('cash','bank','mobile','card') are also accepted.
async function paymentSide(c, payment, supplierId) {
  if (!payment || payment === 'none') return { side: K('opening_equity'), paid: false };
  if (payment === 'credit') return { side: K('ap', { supplier_id: supplierId || null }), paid: false, credit: true };
  if (String(payment).startsWith('acct:')) {
    const a = await c.one('SELECT id, system_key, name FROM accounts WHERE id=? AND is_cash=1 AND active=1', [Number(String(payment).slice(5))]);
    if (!a) throw bad('Choose a valid cash or bank account to pay from');
    return { side: A(a.id), paid: true, method: ['cash', 'bank', 'mobile', 'card'].includes(a.system_key) ? a.system_key : 'bank', accountName: a.name };
  }
  if (METHOD_KEY[payment] && payment !== 'insurance') return { side: K(METHOD_KEY[payment]), paid: true, method: payment };
  throw bad('Invalid payment option');
}

/* ---------- Setup / migration ---------- */
async function ensure(c) {
  for (const sql of DDL) await c.query(sql);
  for (const [table, col, def] of COLUMNS) {
    const x = await c.one('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, col]);
    if (!x.n) await c.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
  }
  const n = (await c.one('SELECT COUNT(*) n FROM accounts')).n;
  if (!n) {
    for (const [code, name, type, parentCode, o] of COA) {
      const parent = parentCode ? await accountByCode(c, parentCode) : null;
      await c.query('INSERT INTO accounts (code, name, type, parent_id, is_group, is_cash, system_key) VALUES (?,?,?,?,?,?,?)',
        [code, name, type, parent, o.group ? 1 : 0, o.cash ? 1 : 0, o.key || null]);
    }
  } else {
    // add any system accounts missing from an older chart
    for (const [code, name, type, parentCode, o] of COA) {
      if (!o.key || (await c.one('SELECT id FROM accounts WHERE system_key=?', [o.key]))) continue;
      const parent = parentCode ? await accountByCode(c, parentCode) : null;
      const free = !(await c.one('SELECT id FROM accounts WHERE code=?', [code]));
      await c.query('INSERT INTO accounts (code, name, type, parent_id, is_group, is_cash, system_key) VALUES (?,?,?,?,?,?,?)',
        [free ? code : `${code}-${o.key}`.slice(0, 20), name, type, parent, 0, o.cash ? 1 : 0, o.key]);
    }
  }
  const j = (await c.one('SELECT COUNT(*) n FROM journal_entries')).n;
  if (!j) return backfill(c);
  return 0;
}

// Convert existing operational records into journal entries (runs once, when the journal is empty).
async function backfill(c) {
  let count = 0;
  const p = async (args) => { if (await post(c, args, null)) count++; };
  const sp = async (args) => { if (await simple(c, args, null)) count++; };

  // Invoice charges -> Dr Receivable, Cr Revenue
  const items = await c.query('SELECT ii.*, i.invoice_no FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id ORDER BY ii.created_at, ii.id');
  for (const it of items) {
    await sp({ date: it.created_at, description: it.description, reference: it.invoice_no, source: 'invoice', source_id: it.invoice_id,
      debit: K('ar'), credit: K(REV_KEY[it.item_type] || 'rev_other'), amount: it.amount });
  }
  const invs = await c.query('SELECT * FROM invoices ORDER BY id');
  for (const inv of invs) {
    if (inv.discount > 0) await sp({ date: inv.created_at, description: `Discount on ${inv.invoice_no}`, reference: inv.invoice_no, source: 'invoice', source_id: inv.id, debit: K('discounts'), credit: K('ar'), amount: inv.discount });
    if (inv.status === 'cancelled') {
      const lines = (await c.query('SELECT item_type, SUM(amount) amt FROM invoice_items WHERE invoice_id=? GROUP BY item_type', [inv.id]))
        .map((x) => K(REV_KEY[x.item_type] || 'rev_other', { debit: x.amt }));
      const sum = lines.reduce((s, l) => s + Number(l.debit), 0) - inv.discount;
      if (inv.discount > 0) lines.push(K('discounts', { credit: inv.discount }));
      lines.push(K('ar', { credit: sum }));
      await p({ date: inv.created_at, description: `Cancelled ${inv.invoice_no}`, reference: inv.invoice_no, source: 'invoice', source_id: inv.id, lines });
    }
  }
  // Payments -> Dr Cash/Bank, Cr Receivable
  const pays = await c.query('SELECT pm.*, i.invoice_no FROM payments pm JOIN invoices i ON i.id=pm.invoice_id ORDER BY pm.id');
  for (const pm of pays) {
    await sp({ date: pm.created_at, description: `Payment ${pm.payment_no || ''} for ${pm.invoice_no}`, reference: pm.payment_no, source: 'payment', source_id: pm.id,
      debit: K(METHOD_KEY[pm.method] || 'cash'), credit: K('ar'), amount: pm.amount });
  }
  // Expenses -> Dr Expense, Cr Cash/Bank
  const exps = await c.query('SELECT * FROM expenses ORDER BY id');
  for (const e of exps) {
    const acct = e.account_id || (await accountByCode(c, CATEGORY_CODE[e.category] || '5299')) || (await accountId(c, 'other_expense'));
    await sp({ date: e.expense_date, description: `${e.category}: ${e.description || e.paid_to || ''}`, reference: e.expense_no, source: 'expense', source_id: e.id,
      debit: A(acct), credit: K(METHOD_KEY[e.method] || 'cash'), amount: e.amount });
  }
  // Medicine batches -> Dr Pharmacy Inventory, Cr Cash (if purchase recorded) or Opening Balance Equity
  const batches = await c.query('SELECT b.*, m.name FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id ORDER BY b.id');
  for (const b of batches) {
    const t = await c.one("SELECT method FROM transactions WHERE type='expense' AND category='Medicine Purchase' AND reference=? LIMIT 1", [b.batch_no]);
    await sp({ date: b.received_at, description: `${t ? 'Purchase' : 'Opening stock'}: ${b.name} x${b.qty_received} (batch ${b.batch_no})`, reference: b.batch_no, source: 'purchase', source_id: b.id,
      debit: K('inventory_meds'), credit: t ? K(METHOD_KEY[t.method] || 'cash') : K('opening_equity'), amount: b.qty_received * b.cost_price });
  }
  // Medicine stock-outs -> cost of sales / write-offs
  const mv = await c.query(`SELECT sm.*, b.cost_price, m.name FROM stock_movements sm JOIN medicine_batches b ON b.id=sm.batch_id JOIN medicines m ON m.id=sm.item_id
    WHERE sm.item_type='medicine' AND sm.movement<>'in' ORDER BY sm.id`);
  for (const x of mv) {
    const amt = Math.abs(x.quantity) * x.cost_price;
    if (['dispense', 'sale'].includes(x.movement)) await sp({ date: x.created_at, description: `Cost of ${x.name} x${-x.quantity}`, reference: x.reference, source: 'stock', source_id: x.id, debit: K('cogs'), credit: K('inventory_meds'), amount: amt });
    else if (x.quantity < 0) await sp({ date: x.created_at, description: `Write-off ${x.name} x${-x.quantity} (${x.movement})`, reference: x.reference, source: 'stock', source_id: x.id, debit: K('writeoff'), credit: K('inventory_meds'), amount: amt });
    else await sp({ date: x.created_at, description: `Stock gain ${x.name} x${x.quantity}`, reference: x.reference, source: 'stock', source_id: x.id, debit: K('inventory_meds'), credit: K('stock_gain'), amount: amt });
  }
  // General inventory movements
  const imv = await c.query(`SELECT sm.*, i.name, i.unit_cost FROM stock_movements sm JOIN inventory_items i ON i.id=sm.item_id WHERE sm.item_type='inventory' ORDER BY sm.id`);
  for (const x of imv) {
    const amt = Math.abs(x.quantity) * x.unit_cost;
    if (x.movement === 'in') {
      const t = await c.one("SELECT method FROM transactions WHERE type='expense' AND category='Supplies Purchase' AND description=? LIMIT 1", [`Purchase ${x.name} x${x.quantity}`]);
      await sp({ date: x.created_at, description: `${t ? 'Purchase' : 'Opening stock'}: ${x.name} x${x.quantity}`, reference: x.reference, source: 'purchase', source_id: x.id,
        debit: K('inventory_supplies'), credit: t ? K(METHOD_KEY[t.method] || 'cash') : K('opening_equity'), amount: amt });
    } else if (x.movement === 'out') {
      await sp({ date: x.created_at, description: `Issued ${x.name} x${-x.quantity}`, reference: x.reference, source: 'stock', source_id: x.id, debit: K('supplies_used'), credit: K('inventory_supplies'), amount: amt });
    } else {
      await sp({ date: x.created_at, description: `Adjust ${x.name} ${x.quantity}`, reference: x.reference, source: 'stock', source_id: x.id,
        debit: x.quantity < 0 ? K('writeoff') : K('inventory_supplies'), credit: x.quantity < 0 ? K('inventory_supplies') : K('stock_gain'), amount: amt });
    }
  }
  if (count) console.log(`Accounting: posted ${count} journal entries from existing records.`);
  return count;
}

module.exports = { ensure, post, simple, paymentSide, accountId, K, A, REV_KEY, METHOD_KEY, DEBIT_NORMAL, CATEGORY_CODE, ymd };
