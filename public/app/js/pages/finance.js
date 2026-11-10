import { h, raw, $, $$, setHTML, GET, POST, PUT, DEL, money, fmtDate, fmtDT, cap, badge, emptyState, today, can, toast, fail,
  openModal, confirmBox, field, selectField, areaField, options, state } from '../core.js';
import { printInvoice } from '../print.js';
import { paymentSelect, moneyAccounts } from './accounting.js';

function chart(canvas, config) {
  if (!window.Chart || !canvas) return;
  const old = window.Chart.getChart(canvas); if (old) old.destroy();
  return new window.Chart(canvas, config);
}
const PALETTE = ['#0e7c86', '#4f46e5', '#f59e0b', '#db2777', '#15935b', '#2563eb', '#7c3aed', '#ea580c', '#64748b'];

/* ---------- General inventory ---------- */
async function renderInventory(el) {
  const suppliers = await GET('/suppliers');
  let tab = 'items';
  const form = (it = {}) => openModal({
    title: it.id ? `Edit ${it.name}` : 'Add inventory item', size: 'wide', submit: 'Save',
    body: h`<div class="form-grid c3">${field('Code', 'code', { value: it.code, required: true })}${field('Name', 'name', { value: it.name, required: true, cls: 'span-2' })}
      ${field('Category', 'category', { value: it.category, placeholder: 'Consumables / Equipment' })}${field('Unit', 'unit', { value: it.unit || 'pcs' })}${field('Location', 'location', { value: it.location })}
      ${!it.id ? field('Opening quantity', 'quantity', { type: 'number', value: 0, attrs: 'min="0"' }) : ''}${field('Reorder level', 'reorder_level', { type: 'number', value: it.reorder_level ?? 10 })}
      ${field('Unit cost', 'unit_cost', { type: 'number', value: it.unit_cost, attrs: 'step="0.01" min="0"' })}${selectField('Supplier', 'supplier_id', options(suppliers, it.supplier_id, { empty: 'None' }))}
      ${it.id ? h`<label class="check"><input type="checkbox" name="active" ${it.active ? raw('checked') : ''}> Active</label>` : ''}</div>`,
    onSubmit: async (d, f, close) => { if (it.id) await PUT(`/inventory/${it.id}`, d); else await POST('/inventory', d); toast('Item saved'); close(); load(); },
  });
  const move = async (it, mv) => {
    const paySel = mv === 'in' ? await paymentSelect() : '';
    const m = openModal({
      title: `${mv === 'in' ? 'Receive' : mv === 'out' ? 'Issue' : 'Adjust'} · ${it.name}`, submit: 'Save', submitClass: mv === 'in' ? 'btn-success' : 'btn-primary',
      body: h`<p class="muted">Current stock: <b>${it.quantity} ${it.unit}</b></p><div class="form-grid">
        ${field(mv === 'adjust' ? 'Quantity (+/-)' : 'Quantity', 'quantity', { type: 'number', required: true })}${field(mv === 'out' ? 'Issued to (dept / ward)' : 'Reference', 'reference', {})}
        ${mv === 'in' ? h`${field('Unit cost', 'unit_cost', { type: 'number', value: it.unit_cost, attrs: 'step="0.01" min="0"' })}${paySel}
          <div class="field sup hidden span-all"><label>Supplier *</label><select name="supplier_id">${options(suppliers, it.supplier_id, { empty: 'Select supplier' })}</select></div>` : ''}
        ${areaField('Notes', 'notes', '', { cls: 'span-all', rows: 2 })}</div>
        <p class="small muted">${mv === 'in' ? 'Posts: Dr Supplies Inventory, Cr the account you paid from (or Accounts Payable).' : mv === 'out' ? 'Posts: Dr Medical Supplies Used, Cr Supplies Inventory (at unit cost).' : 'Losses post to Stock Write-offs, gains to Inventory Gains.'}</p>`,
      onSubmit: async (d, f, close) => { await POST(`/inventory/${it.id}/move`, { ...d, movement: mv }); toast('Stock updated'); close(); load(); },
    });
    const f = $('form', m.el);
    if (f.payment) f.payment.onchange = () => $('.sup', m.el).classList.toggle('hidden', f.payment.value !== 'credit');
  };
  setHTML(el, h`<div class="page-head"><div><h1>General Inventory</h1><div class="muted">Consumables, lab supplies, equipment and stationery.</div></div>
    <div class="actions"><button class="btn btn-primary" id="add-i">+ Add item</button></div></div>
    <div class="grid g3" id="inv-stats" style="margin-bottom:16px"></div>
    <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs"><button data-t="items" class="active">Items</button><button data-t="moves">Movements</button></div>
      <div class="filters" style="margin-bottom:12px" id="ifil"><div class="search"><input class="input" id="iq" placeholder="Search items"></div><label class="check small"><input type="checkbox" id="ilow"> Low stock only</label></div></div>
      <div class="table-wrap" id="itable"></div></div>`);
  let items = [];
  const load = async () => {
    items = await GET('/inventory');
    const low = items.filter((i) => i.quantity <= i.reorder_level && i.reorder_level > 0);
    setHTML($('#inv-stats'), h`<div class="card stat"><div class="si t-teal">🏷️</div><div><div class="sv">${items.length}</div><div class="sl">Items tracked</div></div></div>
      <div class="card stat"><div class="si t-green">💰</div><div><div class="sv">${money(items.reduce((s, i) => s + Number(i.value), 0))}</div><div class="sl">Stock value</div></div></div>
      <div class="card stat"><div class="si t-red">📉</div><div><div class="sv">${low.length}</div><div class="sl">Below reorder level</div></div></div>`);
    render();
  };
  const render = async () => {
    $('#ifil').classList.toggle('hidden', tab !== 'items');
    if (tab === 'items') {
      const q = $('#iq').value.toLowerCase();
      const list = items.filter((i) => (!q || `${i.name} ${i.code} ${i.category}`.toLowerCase().includes(q)) && (!$('#ilow').checked || i.quantity <= i.reorder_level));
      setHTML($('#itable'), list.length ? h`<table class="table"><thead><tr><th>Code</th><th>Item</th><th>Category</th><th>Location</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Value</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((i) => h`<tr><td class="mono small">${i.code}</td><td><b>${i.name}</b><div class="small muted">${i.supplier || ''}</div></td><td>${i.category || ''}</td><td class="small">${i.location || ''}</td>
          <td class="right"><b>${i.quantity}</b> <span class="small muted">${i.unit}</span></td><td class="right">${money(i.unit_cost)}</td><td class="right">${money(i.value)}</td>
          <td>${i.quantity <= 0 ? badge('cancelled', 'Out') : i.quantity <= i.reorder_level ? badge('pending', 'Low') : badge('active', 'OK')}</td>
          <td class="actions"><button class="btn btn-xs" data-in="${i.id}">+ In</button><button class="btn btn-xs" data-out="${i.id}">− Issue</button><button class="btn btn-xs" data-adj="${i.id}">±</button><button class="btn btn-xs" data-e="${i.id}">Edit</button></td></tr>`)}</tbody></table>` : emptyState('No items'));
      const find = (id) => items.find((i) => i.id == id);
      $$('[data-in]', el).forEach((b) => b.onclick = () => move(find(b.dataset.in), 'in'));
      $$('[data-out]', el).forEach((b) => b.onclick = () => move(find(b.dataset.out), 'out'));
      $$('[data-adj]', el).forEach((b) => b.onclick = () => move(find(b.dataset.adj), 'adjust'));
      $$('[data-e]', el).forEach((b) => b.onclick = () => form(find(b.dataset.e)));
    } else {
      const moves = await GET('/inventory/movements');
      setHTML($('#itable'), moves.length ? h`<table class="table"><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th class="right">Qty</th><th class="right">Balance</th><th>Reference / notes</th><th>By</th></tr></thead><tbody>
        ${moves.map((x) => h`<tr><td class="small">${fmtDT(x.created_at)}</td><td>${x.name}</td><td>${badge(x.quantity > 0 ? 'income' : 'expense', cap(x.movement))}</td><td class="right">${x.quantity > 0 ? '+' : ''}${x.quantity}</td>
          <td class="right">${x.balance_after ?? ''}</td><td class="small">${x.reference || ''} ${x.notes ? '· ' + x.notes : ''}</td><td class="small">${x.user_name || ''}</td></tr>`)}</tbody></table>` : emptyState('No movements'));
    }
  };
  $$('[data-t]', el).forEach((b) => b.onclick = () => { tab = b.dataset.t; $$('[data-t]', el).forEach((x) => x.classList.toggle('active', x === b)); render(); });
  $('#iq').oninput = render; $('#ilow').onchange = render;
  $('#add-i').onclick = () => form();
  await load();
}

/* ---------- Billing ---------- */
async function invoiceModal(id, onDone) {
  const [inv, services, accts] = await Promise.all([GET(`/finance/invoices/${id}`), GET('/services'), moneyAccounts()]);
  const defAcct = (method) => (accts.find((a) => a.system_key === method) || accts[0] || {}).id;
  const bal = Math.round((inv.total - inv.amount_paid) * 100) / 100;
  const open = !['cancelled'].includes(inv.status);
  const m = openModal({
    title: `Invoice ${inv.invoice_no}`, size: 'wide',
    body: h`<div class="row" style="margin-bottom:12px"><div><b style="font-size:16px">${inv.patient_name || 'Walk-in'}</b><div class="small muted">${inv.mrn || ''} ${inv.visit_no ? '· ' + inv.visit_no : ''} ${inv.doctor_name ? '· ' + inv.doctor_name : ''}</div></div>
        <div style="margin-left:auto;text-align:right">${badge(inv.status)}<div class="small muted">${fmtDT(inv.created_at)}</div></div></div>
      ${inv.insurance_provider ? h`<div class="small" style="margin-bottom:8px">🛡 Insurance: <b>${inv.insurance_provider}</b> ${inv.insurance_no || ''}</div>` : ''}
      <table class="table"><thead><tr><th>Description</th><th>Type</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th><th></th></tr></thead><tbody>
        ${inv.items.map((i) => h`<tr><td>${i.description}</td><td>${badge(i.item_type === 'medicine' ? 'pending' : i.item_type === 'lab' ? 'in_progress' : 'confirmed', cap(i.item_type))}</td><td class="right">${Number(i.quantity)}</td>
          <td class="right">${money(i.unit_price)}</td><td class="right">${money(i.amount)}</td>
          <td class="actions">${can('accountant') && open && ['service', 'other'].includes(i.item_type) ? h`<button type="button" class="btn btn-xs btn-ghost" data-rm="${i.id}">✕</button>` : ''}</td></tr>`)}
        <tr><td colspan="4" class="right">Subtotal</td><td class="right">${money(inv.subtotal)}</td><td></td></tr>
        ${inv.discount > 0 ? h`<tr><td colspan="4" class="right">Discount</td><td class="right">−${money(inv.discount)}</td><td></td></tr>` : ''}
        <tr><td colspan="4" class="right"><b>Total</b></td><td class="right"><b>${money(inv.total)}</b></td><td></td></tr>
        <tr><td colspan="4" class="right">Paid</td><td class="right">${money(inv.amount_paid)}</td><td></td></tr>
        <tr><td colspan="4" class="right"><b>Balance due</b></td><td class="right"><b style="color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${money(bal)}</b></td><td></td></tr></tbody></table>
      ${inv.payments.length ? h`<div class="section-t" style="margin-top:14px">Payments</div>${inv.payments.map((p) => h`<div class="list-row"><span class="mono small">${p.payment_no}</span><span>${cap(p.method)}</span><span class="small muted">${p.reference || ''}</span>
        <span class="small muted">${fmtDT(p.created_at)} · ${p.received_by_name || ''}</span><b style="margin-left:auto">${money(p.amount)}</b></div>`)}` : ''}
      ${open ? h`<div class="sep"></div><div class="grid g2">
        ${bal > 0 && can('receptionist', 'accountant', 'pharmacist') ? h`<form id="pay-f" class="card card-b"><div class="section-t">Record payment</div>
          <div class="form-grid">${field('Amount', 'amount', { type: 'number', value: bal, required: true, attrs: `step="0.01" min="0.01" max="${bal}"` })}
          ${selectField('Method', 'method', options(['cash', 'mobile', 'card', 'bank', 'insurance'], 'cash'))}
          <div class="field span-all dep"><label>Deposit to account</label><select name="account_id">${options(accts, defAcct('cash'), { label: (a) => a.name })}</select></div>
          ${field('Reference', 'reference', { cls: 'span-all', placeholder: 'EVC / Zaad / card ref' })}</div>
          <button class="btn btn-success btn-block">💵 Receive payment</button></form>` : ''}
        <div class="stack">
          <form id="svc-f" class="card card-b"><div class="section-t">Add service charge</div><div class="row"><select name="service_id" style="flex:1">${options(services.filter((s) => s.active), '', { empty: 'Select service', label: (s) => `${s.name} · ${money(s.price)}` })}</select>
            <input class="input qty" type="number" name="quantity" value="1" min="1"><button class="btn">Add</button></div></form>
          ${can('accountant') ? h`<form id="disc-f" class="card card-b"><div class="section-t">Discount / waiver</div><div class="row"><input class="input" type="number" name="discount" step="0.01" min="0" value="${inv.discount}" style="flex:1"><button class="btn">Apply</button></div></form>` : ''}
        </div></div>` : ''}`,
    footer: h`<div class="modal-f"><button type="button" class="btn" data-close>Close</button><button type="button" class="btn" id="pr-inv">🖨 Invoice</button>${inv.payments.length ? h`<button type="button" class="btn" id="pr-rct">🧾 Receipt</button>` : ''}</div>`,
  });
  const reopen = () => { m.close(); invoiceModal(id, onDone); onDone(); };
  const sub = (sel, fn) => { const f = $(sel, m.el); if (f) f.onsubmit = async (e) => { e.preventDefault(); const btn = $('button', f); btn.disabled = true; try { await fn(Object.fromEntries(new FormData(f))); reopen(); } catch (err) { fail(err); btn.disabled = false; } }; };
  const pf = $('#pay-f', m.el);
  if (pf) pf.method.onchange = () => {
    const ins = pf.method.value === 'insurance';
    $('.dep', pf).classList.toggle('hidden', ins);
    if (!ins) pf.account_id.value = defAcct(pf.method.value);
  };
  sub('#pay-f', async (d) => {
    if (d.method === 'insurance') delete d.account_id; await POST(`/finance/invoices/${id}/payments`, d); toast('Payment received'); });
  sub('#svc-f', async (d) => { if (!d.service_id) throw new Error('Select a service'); await POST(`/finance/invoices/${id}/items`, d); toast('Charge added'); });
  sub('#disc-f', async (d) => { await POST(`/finance/invoices/${id}/discount`, d); toast('Discount applied'); });
  $$('[data-rm]', m.el).forEach((b) => b.onclick = async () => { try { await DEL(`/finance/invoices/${id}/items/${b.dataset.rm}`); toast('Charge removed'); reopen(); } catch (e) { fail(e); } });
  $('#pr-inv', m.el).onclick = () => printInvoice(id);
  const r = $('#pr-rct', m.el); if (r) r.onclick = () => printInvoice(id, { receipt: true });
}

async function renderBilling(el, params, ctx) {
  setHTML(el, h`<div class="page-head"><div><h1>Billing & Cashier</h1><div class="muted">Consultation, lab and pharmacy charges collect automatically on each visit invoice.</div></div></div>
    <div class="grid g4" id="b-stats" style="margin-bottom:16px"></div>
    <div class="card"><div class="card-h filters"><select id="bs">${options([{ id: 'unpaid,partial', name: 'Unpaid & partial' }, { id: 'paid', name: 'Paid' }, { id: 'cancelled', name: 'Cancelled' }, { id: '', name: 'All' }], 'unpaid,partial')}</select>
      <input type="date" class="input" id="bf" value="${today(-30)}"><input type="date" class="input" id="bt" value="${today()}"><div class="search"><input class="input" id="bq" placeholder="Invoice, patient or MRN"></div></div>
      <div class="table-wrap" id="btable"></div></div>`);
  const load = async () => {
    const qs = new URLSearchParams({ status: $('#bs').value, from: $('#bf').value, to: $('#bt').value, q: $('#bq').value });
    const [rows, todayRows, outstanding] = await Promise.all([GET('/finance/invoices?' + qs), GET(`/finance/invoices?from=${today()}&to=${today()}`), GET('/finance/invoices?status=unpaid,partial')]);
    const billedToday = todayRows.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.total, 0);
    const paidToday = todayRows.reduce((s, i) => s + i.amount_paid, 0);
    setHTML($('#b-stats'), h`<div class="card stat"><div class="si t-blue">🧾</div><div><div class="sv">${money(billedToday)}</div><div class="sl">Billed today (${todayRows.length})</div></div></div>
      <div class="card stat"><div class="si t-green">💵</div><div><div class="sv">${money(paidToday)}</div><div class="sl">Collected on today's invoices</div></div></div>
      <div class="card stat"><div class="si t-red">⏳</div><div><div class="sv">${money(outstanding.reduce((s, i) => s + i.balance, 0))}</div><div class="sl">Outstanding (${outstanding.length})</div></div></div>
      <div class="card stat"><div class="si t-amber">🏥</div><div><div class="sv">${outstanding.filter((i) => i.visit_status && !['completed', 'cancelled'].includes(i.visit_status)).length}</div><div class="sl">Patients still in the circle</div></div></div>`);
    setHTML($('#btable'), rows.length ? h`<table class="table"><thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th>Visit</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((i) => h`<tr class="clickable" data-id="${i.id}"><td class="mono small">${i.invoice_no}</td><td class="small">${fmtDT(i.created_at)}</td><td><b>${i.patient_name || 'Walk-in'}</b><div class="small muted">${i.mrn || ''}</div></td>
        <td class="small">${i.visit_no || h`<span class="muted">OTC</span>`}${i.visit_status ? h`<div>${badge(i.visit_status)}</div>` : ''}</td><td class="right">${money(i.total)}</td><td class="right">${money(i.amount_paid)}</td>
        <td class="right"><b>${money(i.balance)}</b></td><td>${badge(i.status)}</td><td class="actions"><button class="btn btn-xs ${i.balance > 0 ? 'btn-success' : ''}">${i.balance > 0 ? 'Collect' : 'View'}</button></td></tr>`)}</tbody></table>` : emptyState('No invoices for this filter', '🧾'));
    $$('tr[data-id]', el).forEach((tr) => tr.onclick = () => invoiceModal(tr.dataset.id, load));
  };
  ['#bs', '#bf', '#bt'].forEach((s) => { $(s).onchange = () => load().catch(fail); });
  let t; $('#bq').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); };
  await load();
  if (params[0]) invoiceModal(params[0], load);
  ctx.every(20000, () => { if (!document.querySelector('.modal-back')) load().catch(() => {}); });
}

/* ---------- Expenses ---------- */
const EXP_CATS = ['Salaries', 'Utilities', 'Rent', 'Maintenance', 'Supplies', 'Medicine Purchase', 'Equipment', 'Transport', 'Marketing', 'Taxes & Fees', 'Other'];
async function renderExpenses(el) {
  setHTML(el, h`<div class="page-head"><div><h1>Expenses</h1><div class="muted">Every expense is posted to the transactions ledger.</div></div><div class="actions"><button class="btn btn-primary" id="add-e">+ Record expense</button></div></div>
    <div class="card"><div class="card-h filters"><input type="date" class="input" id="ef" value="${today(-30)}"><input type="date" class="input" id="et" value="${today()}"><span class="muted" id="etotal" style="margin-left:auto"></span></div>
    <div class="table-wrap" id="etable"></div></div>`);
  const load = async () => {
    const rows = await GET(`/finance/expenses?from=${$('#ef').value}&to=${$('#et').value}`);
    $('#etotal').innerHTML = String(h`Total: <b>${money(rows.reduce((s, e) => s + e.amount, 0))}</b>`);
    setHTML($('#etable'), rows.length ? h`<table class="table"><thead><tr><th>No</th><th>Date</th><th>Expense account</th><th>Description</th><th>Paid to</th><th>Paid from</th><th class="right">Amount</th><th>By</th></tr></thead><tbody>
      ${rows.map((e) => h`<tr><td class="mono small">${e.expense_no}</td><td>${fmtDate(e.expense_date)}</td><td>${badge('expense', `${e.account_code ? e.account_code + ' · ' : ''}${e.category}`)}</td><td>${e.description || ''}</td><td>${e.paid_to || ''}</td>
        <td class="small">${e.paid_from || (e.supplier ? h`On credit · ${e.supplier}` : cap(e.method))}</td>
        <td class="right"><b>${money(e.amount)}</b></td><td class="small">${e.recorded_by_name || ''}</td></tr>`)}</tbody></table>` : emptyState('No expenses in this period', '💸'));
  };
  $('#add-e').onclick = async () => {
    const [accounts, suppliers, paySel] = await Promise.all([GET('/accounting/accounts'), GET('/suppliers'), paymentSelect({ label: 'Paid from', none: false })]);
    const usable = accounts.filter((a) => !a.is_group && a.active && !a.is_cash && (a.type === 'expense' || (a.type === 'asset' && !a.system_key)));
    const m = openModal({
      title: 'Record expense', size: 'wide', submit: 'Save expense',
      body: h`<div class="form-grid"><div class="field span-all"><label>Expense account *</label><select name="account_id" required data-label="Expense account"><option value="">Select account</option>
          <optgroup label="Expenses">${usable.filter((a) => a.type === 'expense').map((a) => h`<option value="${a.id}">${a.code} · ${a.name}</option>`)}</optgroup>
          <optgroup label="Assets (equipment, furniture…)">${usable.filter((a) => a.type === 'asset').map((a) => h`<option value="${a.id}">${a.code} · ${a.name}</option>`)}</optgroup></select>
          <div class="small muted" style="margin-top:4px">Need a new category? Add it in <a href="#/accounts">Chart of Accounts</a>.</div></div>
        ${field('Amount', 'amount', { type: 'number', required: true, attrs: 'step="0.01" min="0.01"' })}${field('Date', 'expense_date', { type: 'date', value: today(), required: true })}
        ${paySel}<div class="field sup hidden"><label>Supplier (we owe) *</label><select name="supplier_id">${options(suppliers, '', { empty: 'Select supplier' })}</select></div>
        ${field('Paid to', 'paid_to', { cls: 'span-all', placeholder: 'Person or company' })}${areaField('Description', 'description', '', { cls: 'span-all', rows: 2 })}</div>`,
      onSubmit: async (d, f, close) => { await POST('/finance/expenses', d); toast('Expense recorded and posted to the ledger'); close(); load(); },
    });
    const f = $('form', m.el);
    f.payment.onchange = () => $('.sup', m.el).classList.toggle('hidden', f.payment.value !== 'credit');
  };
  $('#ef').onchange = $('#et').onchange = () => load().catch(fail);
  await load();
}

/* ---------- Transactions ledger ---------- */
async function renderTransactions(el) {
  setHTML(el, h`<div class="page-head"><div><h1>Transactions Ledger</h1><div class="muted">All money in and out of the hospital.</div></div><div class="actions"><button class="btn" id="csv">⬇ Export CSV</button></div></div>
    <div class="grid g3" id="tx-stats" style="margin-bottom:16px"></div>
    <div class="card"><div class="card-h filters"><input type="date" class="input" id="tf" value="${today(-30)}"><input type="date" class="input" id="tt" value="${today()}">
      <select id="ty">${options([{ id: '', name: 'All types' }, { id: 'income', name: 'Income' }, { id: 'expense', name: 'Expense' }], '')}</select></div><div class="table-wrap" id="txtable"></div></div>`);
  let rows = [];
  const load = async () => {
    rows = await GET(`/finance/transactions?from=${$('#tf').value}&to=${$('#tt').value}&type=${$('#ty').value}`);
    const inc = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0), exp = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    setHTML($('#tx-stats'), h`<div class="card stat"><div class="si t-green">⬆</div><div><div class="sv">${money(inc)}</div><div class="sl">Income</div></div></div>
      <div class="card stat"><div class="si t-red">⬇</div><div><div class="sv">${money(exp)}</div><div class="sl">Expenses</div></div></div>
      <div class="card stat"><div class="si t-teal">=</div><div><div class="sv">${money(inc - exp)}</div><div class="sl">Net</div></div></div>`);
    setHTML($('#txtable'), rows.length ? h`<table class="table"><thead><tr><th>Txn</th><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Method</th><th>Reference</th><th class="right">Amount</th><th>By</th></tr></thead><tbody>
      ${rows.map((r) => h`<tr><td class="mono small">${r.txn_no}</td><td class="small">${fmtDT(r.created_at)}</td><td>${badge(r.type)}</td><td>${r.category}</td><td class="small">${r.description || ''}</td><td>${cap(r.method || '')}</td>
        <td class="mono small">${r.reference || ''}</td><td class="right" style="color:${r.type === 'income' ? 'var(--success)' : 'var(--danger)'}"><b>${r.type === 'income' ? '+' : '−'}${money(r.amount)}</b></td><td class="small">${r.user_name || ''}</td></tr>`)}</tbody></table>` : emptyState('No transactions', '📒'));
  };
  ['#tf', '#tt', '#ty'].forEach((s) => { $(s).onchange = () => load().catch(fail); });
  $('#csv').onclick = () => {
    const cols = ['txn_no', 'created_at', 'type', 'category', 'description', 'method', 'reference', 'amount', 'user_name'];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `transactions_${$('#tf').value}_${$('#tt').value}.csv`;
    a.click();
  };
  await load();
}

/* ---------- Reports ---------- */
async function renderReports(el) {
  setHTML(el, h`<div class="page-head"><div><h1>Financial Reports</h1><div class="muted">Revenue, collections, expenses and performance.</div></div>
    <div class="actions filters"><select id="rp">${options([{ id: '0', name: 'Today' }, { id: '6', name: 'Last 7 days' }, { id: '29', name: 'Last 30 days' }, { id: '89', name: 'Last 90 days' }, { id: '364', name: 'Last 12 months' }], '29')}</select>
      <input type="date" class="input" id="rf"><input type="date" class="input" id="rt"><button class="btn" onclick="window.print()">🖨 Print</button></div></div><div id="rbody"></div>`);
  const setRange = () => { const n = Number($('#rp').value); $('#rf').value = today(-n); $('#rt').value = today(); };
  const load = async () => {
    const s = await GET(`/finance/summary?from=${$('#rf').value}&to=${$('#rt').value}`);
    const stat = (icon, tone, v, l) => h`<div class="card stat"><div class="si ${tone}">${icon}</div><div><div class="sv">${v}</div><div class="sl">${l}</div></div></div>`;
    const list = (rows, label, val) => rows.length ? rows.map((r) => h`<div class="list-row"><span>${label(r)}</span><b style="margin-left:auto">${val(r)}</b></div>`) : emptyState('No data');
    setHTML($('#rbody'), h`<div class="grid g4" style="margin-bottom:16px">${stat('💵', 't-green', money(s.income), 'Cash collected')}${stat('💸', 't-red', money(s.expense), 'Expenses')}
      ${stat('📈', 't-teal', money(s.net), 'Net profit')}${stat('🧾', 't-blue', money(s.billed), `Billed · ${s.invoices} invoices`)}
      ${stat('🎁', 't-purple', money(s.discounts), 'Discounts given')}${stat('⏳', 't-amber', money(s.outstanding.amount), `Outstanding · ${s.outstanding.n} invoices (all time)`)}
      ${stat('%', 't-teal', s.billed ? Math.round((s.income / s.billed) * 100) + '%' : '–', 'Collection rate')}${stat('📊', 't-blue', s.income ? Math.round((s.net / s.income) * 100) + '%' : '–', 'Profit margin')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Daily income vs expenses</h3></div><div class="card-b"><div class="chart-box"><canvas id="r-daily"></canvas></div></div></div>
      <div class="grid g3" style="margin-bottom:16px">
        <div class="card"><div class="card-h"><h3>Revenue by service line</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="r-type"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Payment methods</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="r-method"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Expenses by category</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="r-exp"></canvas></div></div></div></div>
      <div class="grid g3">
        <div class="card"><div class="card-h"><h3>Doctor performance</h3></div><div class="card-b">${list(s.top_doctors, (r) => h`${r.name} <span class="small muted">· ${r.visits} visits</span>`, (r) => money(r.revenue))}</div></div>
        <div class="card"><div class="card-h"><h3>Top medicines</h3></div><div class="card-b">${list(s.top_medicines, (r) => h`${r.name} <span class="small muted">· ${Number(r.qty)} units</span>`, (r) => money(r.amount))}</div></div>
        <div class="card"><div class="card-h"><h3>Top lab tests</h3></div><div class="card-b">${list(s.top_tests, (r) => h`${String(r.name).replace(/^Lab: /, '')} <span class="small muted">· ${r.n}x</span>`, (r) => money(r.amount))}</div></div></div>`);
    const days = []; for (let d = new Date(s.from + 'T00:00:00'); d <= new Date(s.to + 'T00:00:00'); d.setDate(d.getDate() + 1)) days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    const dm = Object.fromEntries(s.daily.map((x) => [x.d, x]));
    chart($('#r-daily'), { type: 'bar', data: { labels: days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' })), datasets: [
      { label: 'Income', data: days.map((d) => (dm[d] ? dm[d].income : 0)), backgroundColor: '#15935b', borderRadius: 4 },
      { label: 'Expenses', data: days.map((d) => (dm[d] ? dm[d].expense : 0)), backgroundColor: '#f87171', borderRadius: 4 },
      { label: 'Net', type: 'line', data: days.map((d) => (dm[d] ? dm[d].income - dm[d].expense : 0)), borderColor: '#4f46e5', tension: .3, pointRadius: 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
    const dough = (id, rows, label, val) => chart($(id), { type: 'doughnut', data: { labels: rows.map(label), datasets: [{ data: rows.map(val), backgroundColor: PALETTE }] },
      options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } } });
    dough('#r-type', s.by_type, (r) => cap(r.item_type), (r) => r.amount);
    dough('#r-method', s.by_method, (r) => cap(r.method), (r) => r.amount);
    dough('#r-exp', s.expense_by_category, (r) => r.category, (r) => r.amount);
  };
  $('#rp').onchange = () => { setRange(); load().catch(fail); };
  $('#rf').onchange = $('#rt').onchange = () => load().catch(fail);
  setRange();
  await load();
}

export default {
  inventory: { title: 'General Inventory', render: renderInventory },
  billing: { title: 'Billing & Cashier', render: renderBilling },
  expenses: { title: 'Expenses', render: renderExpenses },
  transactions: { title: 'Transactions Ledger', render: renderTransactions },
  reports: { title: 'Financial Reports', render: renderReports },
};
