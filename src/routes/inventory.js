const db = require('../db');
const { allow } = require('../middleware/auth');
const { Router, need, pick, audit, notFound, bad, int, round2 } = require('../utils');
const billing = require('../services/billing');
const acc = require('../services/accounting');

const r = Router();
const FIELDS = ['code', 'name', 'category', 'unit', 'reorder_level', 'unit_cost', 'location', 'supplier_id', 'active'];
const ROLES = ['pharmacist', 'nurse', 'accountant'];

r.get('/inventory', async (req, res) => {
  const p = [];
  let sql = 'SELECT i.*, s.name AS supplier, (i.quantity * i.unit_cost) AS value FROM inventory_items i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE 1=1';
  if (req.query.q) { sql += ' AND (i.name LIKE ? OR i.code LIKE ? OR i.category LIKE ?)'; const q = `%${req.query.q}%`; p.push(q, q, q); }
  if (req.query.low) sql += ' AND i.quantity <= i.reorder_level';
  res.json(await db.query(sql + ' ORDER BY i.category, i.name', p));
});

r.post('/inventory', allow(...ROLES), async (req, res) => {
  need(req.body, ['code', 'name']);
  const d = pick(req.body, FIELDS);
  d.quantity = int(req.body.quantity, 0);
  const x = await db.query('INSERT INTO inventory_items SET ?', [d]);
  if (d.quantity > 0) {
    await db.query("INSERT INTO stock_movements (item_type,item_id,movement,quantity,balance_after,notes,user_id) VALUES ('inventory',?,'in',?,?,'Opening stock',?)",
      [x.insertId, d.quantity, d.quantity, req.user.id]);
    await acc.simple(db, { description: `Opening stock: ${d.name} x${d.quantity}`, source: 'purchase', source_id: x.insertId,
      debit: acc.K('inventory_supplies'), credit: acc.K('opening_equity'), amount: round2(d.quantity * Number(d.unit_cost || 0)) }, req.user);
  }
  await audit(db, req.user, 'create', 'inventory', x.insertId, req.body.name);
  res.json({ id: x.insertId });
});

r.put('/inventory/:id', allow(...ROLES), async (req, res) => {
  const d = pick(req.body, FIELDS);
  if (d.active !== undefined) d.active = d.active ? 1 : 0;
  await db.query('UPDATE inventory_items SET ? WHERE id=?', [d, req.params.id]);
  res.json({ ok: true });
});

// movement: in (receive), out (issue to ward/department), adjust (+/-)
r.post('/inventory/:id/move', allow(...ROLES), async (req, res) => {
  need(req.body, ['movement', 'quantity']);
  let qty = int(req.body.quantity);
  if (!qty) throw bad('Quantity is required');
  const mv = req.body.movement;
  if (!['in', 'out', 'adjust'].includes(mv)) throw bad('Invalid movement');
  if (mv === 'in') qty = Math.abs(qty);
  if (mv === 'out') qty = -Math.abs(qty);
  await db.tx(async (c) => {
    const it = await c.one('SELECT * FROM inventory_items WHERE id=? FOR UPDATE', [req.params.id]);
    if (!it) throw notFound('Item not found');
    if (it.quantity + qty < 0) throw bad(`Only ${it.quantity} ${it.unit} in stock`);
    const unitCost = mv === 'in' && req.body.unit_cost ? round2(req.body.unit_cost) : it.unit_cost;
    await c.query('UPDATE inventory_items SET quantity=quantity+?, unit_cost=? WHERE id=?', [qty, unitCost, it.id]);
    await c.query("INSERT INTO stock_movements (item_type,item_id,movement,quantity,balance_after,reference,notes,user_id) VALUES ('inventory',?,?,?,?,?,?,?)",
      [it.id, mv, qty, it.quantity + qty, req.body.reference || null, req.body.notes || null, req.user.id]);
    const value = round2(Math.abs(qty) * unitCost);
    if (mv === 'in') {
      const payment = req.body.payment || (req.body.record_expense ? req.body.method || 'cash' : 'none');
      const pay = await acc.paymentSide(c, payment, req.body.supplier_id || it.supplier_id);
      if (pay.paid && value > 0) {
        await billing.recordTxn(c, { type: 'expense', category: 'Supplies Purchase', amount: value, method: pay.method,
          reference: req.body.reference, description: `Purchase ${it.name} x${qty}` }, req.user);
      }
      await acc.simple(c, { description: `${pay.credit ? 'Credit purchase' : pay.paid ? 'Purchase' : 'Stock received'}: ${it.name} x${qty}`, reference: req.body.reference,
        source: 'purchase', source_id: it.id, debit: acc.K('inventory_supplies'), credit: pay.side, amount: value }, req.user);
    } else if (mv === 'out') {
      await acc.simple(c, { description: `Issued ${it.name} x${-qty}${req.body.reference ? ' to ' + req.body.reference : ''}`, reference: req.body.reference,
        source: 'stock', source_id: it.id, debit: acc.K('supplies_used'), credit: acc.K('inventory_supplies'), amount: value }, req.user);
    } else {
      await acc.simple(c, { description: `Adjust ${it.name} ${qty > 0 ? '+' : ''}${qty}`, reference: req.body.reference, source: 'stock', source_id: it.id,
        debit: qty < 0 ? acc.K('writeoff') : acc.K('inventory_supplies'), credit: qty < 0 ? acc.K('inventory_supplies') : acc.K('stock_gain'), amount: value }, req.user);
    }
    await audit(c, req.user, `inventory_${mv}`, 'inventory', it.id, `${it.name} ${qty > 0 ? '+' : ''}${qty}`);
  });
  res.json({ ok: true });
});

r.get('/inventory/movements', async (req, res) => {
  const p = [];
  let sql = `SELECT sm.*, i.name, i.unit, u.name AS user_name FROM stock_movements sm JOIN inventory_items i ON i.id=sm.item_id
             LEFT JOIN users u ON u.id=sm.user_id WHERE sm.item_type='inventory'`;
  if (req.query.item_id) { sql += ' AND sm.item_id=?'; p.push(req.query.item_id); }
  res.json(await db.query(sql + ' ORDER BY sm.id DESC LIMIT 300', p));
});

module.exports = r;
