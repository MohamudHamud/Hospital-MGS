const { bad } = require('../utils');
const acc = require('./accounting');

async function medicineStock(c, medicineId) {
  const r = await c.one('SELECT COALESCE(SUM(qty_available),0) AS q FROM medicine_batches WHERE medicine_id=? AND (expiry_date IS NULL OR expiry_date>=CURDATE())', [medicineId]);
  return Number(r.q);
}

// First-Expiry-First-Out deduction across non-expired batches.
async function deductFEFO(c, medicineId, qty, { movement = 'dispense', reference = null, notes = null }, user) {
  qty = Number(qty);
  if (!(qty > 0)) return 0;
  const med = await c.one('SELECT name FROM medicines WHERE id=?', [medicineId]);
  const batches = await c.query(
    `SELECT id, qty_available, cost_price FROM medicine_batches
     WHERE medicine_id=? AND qty_available>0 AND (expiry_date IS NULL OR expiry_date>=CURDATE())
     ORDER BY expiry_date IS NULL, expiry_date, id FOR UPDATE`, [medicineId]);
  let total = batches.reduce((s, b) => s + b.qty_available, 0);
  if (total < qty) throw bad(`Insufficient stock for ${med ? med.name : 'medicine'} (available ${total}, needed ${qty})`);
  let remaining = qty, cost = 0;
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.qty_available, remaining);
    await c.query('UPDATE medicine_batches SET qty_available = qty_available - ? WHERE id=?', [take, b.id]);
    remaining -= take; total -= take; cost += take * b.cost_price;
    await c.query('INSERT INTO stock_movements (item_type,item_id,batch_id,movement,quantity,balance_after,reference,notes,user_id) VALUES (?,?,?,?,?,?,?,?,?)',
      ['medicine', medicineId, b.id, movement, -take, total, reference, notes, user ? user.id : null]);
  }
  // Accounting: Dr Cost of Medicines Sold, Cr Pharmacy Inventory (at batch cost).
  await acc.simple(c, { description: `Cost of ${med ? med.name : 'medicine'} x${qty}`, reference, source: 'stock', source_id: medicineId,
    debit: acc.K('cogs'), credit: acc.K('inventory_meds'), amount: cost }, user);
  return cost;
}

module.exports = { medicineStock, deductFEFO };
