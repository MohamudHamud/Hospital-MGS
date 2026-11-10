import { h, raw, $, $$, setHTML, GET, POST, PUT, money, fmtDate, fmtDT, fmtTime, mins, cap, badge, emptyState, today, can, toast, fail,
  openModal, confirmBox, field, selectField, areaField, options, patientPicker } from '../core.js';
import { printPrescription, printInvoice } from '../print.js';
import { paymentSelect } from './accounting.js';

/* ---------- Dispensing ---------- */
async function dispenseModal(rxId, onDone) {
  const rx = await GET(`/pharmacy/prescriptions/${rxId}`);
  const open = ['pending', 'partial'].includes(rx.status);
  const m = openModal({
    title: `Dispense · ${rx.rx_no}`, size: 'xl',
    body: h`<div class="row" style="margin-bottom:10px"><b>${rx.patient_name}</b><span class="muted small">${cap(rx.gender || '')} · ${rx.age ?? '?'} yrs · ${rx.mrn}</span>
        <span class="muted small">Dr: ${rx.doctor_name || '-'}</span>${rx.token_no ? h`<span class="token">${rx.token_no}</span>` : ''}${badge(rx.status)}</div>
      ${rx.allergies ? h`<div class="alert-strip" style="margin-bottom:10px">⚠ Allergies: ${rx.allergies}</div>` : ''}
      ${rx.diagnosis ? h`<div class="small" style="margin-bottom:10px"><b>Diagnosis:</b> ${rx.diagnosis}</div>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Medicine</th><th>Directions</th><th class="right">Prescribed</th><th class="right">Given</th><th class="right">In stock</th><th style="width:110px">Dispense now</th><th class="right">Unit</th><th class="right">Amount</th></tr></thead><tbody>
      ${rx.items.map((i) => {
        const rem = i.quantity - i.qty_dispensed;
        const def = Math.max(0, Math.min(rem, i.stock));
        return h`<tr data-id="${i.id}" data-price="${i.unit_price}"><td><b>${i.name}</b> ${i.strength || ''}<div class="small muted">${i.form || ''} · ${i.code}</div></td>
          <td class="small">${i.dosage || ''} · ${i.frequency || ''} · ${i.duration || ''}${i.instructions ? h`<div class="muted">${i.instructions}</div>` : ''}</td>
          <td class="right">${i.quantity}</td><td class="right">${i.qty_dispensed}</td><td class="right ${i.stock < rem ? 'flag-high' : ''}">${i.stock}</td>
          <td><input class="input qty" type="number" min="0" max="${Math.min(rem, i.stock)}" value="${def}" ${!open || rem <= 0 ? raw('disabled') : ''}></td>
          <td class="right">${money(i.unit_price)}</td><td class="right amt">${money(def * i.unit_price)}</td></tr>`;
      })}</tbody></table></div>
      ${rx.notes ? h`<div class="small"><b>Notes:</b> ${rx.notes}</div>` : ''}
      <div class="row" style="margin-top:12px">${open ? h`<label class="check"><input type="checkbox" id="close-rx"> Close prescription even if some items cannot be given (patient buys elsewhere)</label>` : ''}
        <div class="total-box" style="margin-left:auto;min-width:260px"><span>Total</span><span id="dtotal">${money(0)}</span></div></div>
      <div class="small muted" style="margin-top:6px">Stock is deducted first-expiry-first-out across batches. Charges are added to the patient's invoice for the cashier.</div>`,
    footer: h`<div class="modal-f"><button type="button" class="btn" data-close>Close</button><button type="button" class="btn" id="d-print">🖨 Prescription</button>
      ${open ? h`<button type="button" class="btn btn-success" id="d-go">💊 Dispense</button>` : ''}</div>`,
  });
  const recalc = () => {
    let t = 0;
    $$('tr[data-id]', m.el).forEach((tr) => { const q = Number($('input', tr).value) || 0; const a = q * Number(tr.dataset.price); t += a; $('.amt', tr).textContent = money(a); });
    $('#dtotal', m.el).textContent = money(t);
  };
  $$('tr[data-id] input', m.el).forEach((i) => i.oninput = recalc);
  recalc();
  $('#d-print', m.el).onclick = () => rx.visit_id && printPrescription(rx.visit_id, rx.id);
  const go = $('#d-go', m.el);
  if (go) go.onclick = async () => {
    const items = $$('tr[data-id]', m.el).map((tr) => ({ id: Number(tr.dataset.id), qty: Number($('input', tr).value) || 0 }));
    go.disabled = true;
    try {
      const r = await POST(`/pharmacy/prescriptions/${rx.id}/dispense`, { items, close: $('#close-rx', m.el).checked });
      toast(r.status === 'dispensed' ? 'Dispensed · prescription complete' : 'Partially dispensed');
      m.close(); onDone();
      if (r.invoice_id && confirm('Print the invoice for the cashier / patient?')) printInvoice(r.invoice_id);
    } catch (e) { fail(e); go.disabled = false; }
  };
}

async function renderDispensing(el, params, ctx) {
  let tab = 'queue';
  setHTML(el, h`<div class="page-head"><div><h1>Pharmacy Dispensing</h1><div class="muted">Prescriptions arrive here straight from the doctor.</div></div>
    <div class="actions"><a class="btn" href="#/pos">🛒 OTC sale</a><a class="btn" href="#/medicines">📦 Stock</a></div></div>
    <div class="grid g4" id="ph-stats" style="margin-bottom:16px"></div>
    <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs"><button data-t="queue" class="active">Waiting queue</button><button data-t="today">Dispensed today</button><button data-t="all">Search</button></div>
      <div class="filters" style="margin-bottom:12px"><div class="search"><input class="input" id="rq" placeholder="Patient, MRN or Rx no"></div></div></div><div class="table-wrap" id="rx-table"></div></div>`);
  const load = async () => {
    const q = encodeURIComponent($('#rq').value);
    const url = tab === 'queue' ? '/pharmacy/prescriptions?status=pending,partial' : tab === 'today' ? `/pharmacy/prescriptions?status=dispensed&date=${today()}` : '/pharmacy/prescriptions?';
    const [rows, alerts, queue, doneToday] = await Promise.all([GET(url + (q ? `&q=${q}` : '')), GET('/pharmacy/alerts'), GET('/pharmacy/prescriptions?status=pending,partial'), GET(`/pharmacy/prescriptions?status=dispensed&date=${today()}`)]);
    setHTML($('#ph-stats'), h`<div class="card stat"><div class="si t-amber">⏳</div><div><div class="sv">${queue.length}</div><div class="sl">Waiting prescriptions</div></div></div>
      <div class="card stat"><div class="si t-green">✅</div><div><div class="sv">${doneToday.length}</div><div class="sl">Dispensed today</div></div></div>
      <a class="card stat" href="#/medicines" style="color:inherit;text-decoration:none"><div class="si t-red">📉</div><div><div class="sv">${alerts.low.length}</div><div class="sl">Low / out of stock</div></div></a>
      <a class="card stat" href="#/medicines" style="color:inherit;text-decoration:none"><div class="si t-purple">⌛</div><div><div class="sv">${alerts.expiring.length + alerts.expired.length}</div><div class="sl">Expiring / expired batches</div></div></a>`);
    setHTML($('#rx-table'), rows.length ? h`<table class="table"><thead><tr><th>Rx</th><th>Patient</th><th>Doctor</th><th>Items</th><th>Status</th><th>Waiting</th><th></th></tr></thead><tbody>
      ${rows.map((r) => h`<tr><td class="mono small">${r.rx_no}${r.token_no ? h`<div><span class="token" style="height:22px;min-width:28px;font-size:12px">${r.token_no}</span></div>` : ''}</td>
        <td><b>${r.patient_name}</b><div class="small muted">${r.mrn}</div>${r.allergies ? badge('critical', 'Allergy') : ''}</td><td class="small">${r.doctor_name || ''}</td><td>${r.item_count}</td>
        <td>${badge(r.status)}</td><td class="small">${fmtTime(r.created_at)}<div class="muted">⏱ ${mins(r.minutes)}</div></td>
        <td class="actions"><button class="btn btn-sm ${['pending', 'partial'].includes(r.status) ? 'btn-primary' : ''}" data-d="${r.id}">${['pending', 'partial'].includes(r.status) ? '💊 Dispense' : 'View'}</button></td></tr>`)}</tbody></table>`
      : emptyState(tab === 'queue' ? 'No prescriptions waiting' : 'Nothing found', '💊'));
    $$('[data-d]', el).forEach((b) => b.onclick = () => dispenseModal(b.dataset.d, () => { load(); ctx.refreshBadges(); }));
  };
  $$('[data-t]', el).forEach((b) => b.onclick = () => { tab = b.dataset.t; $$('[data-t]', el).forEach((x) => x.classList.toggle('active', x === b)); load().catch(fail); });
  let t; $('#rq').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); };
  await load();
  ctx.every(12000, () => { if (!document.querySelector('.modal-back')) load().catch(() => {}); });
}

/* ---------- OTC Point of sale ---------- */
async function renderPOS(el) {
  let meds = await GET('/pharmacy/medicines?active=1');
  const cart = new Map();
  let patient = null;
  setHTML(el, h`<div class="page-head"><div><h1>OTC Sales</h1><div class="muted">Walk-in pharmacy sales with instant receipt.</div></div></div>
    <div class="pos"><div class="card"><div class="card-h"><div class="search" style="flex:1"><input class="input" id="ms" placeholder="Search medicine by name, generic or code"></div></div><div class="card-b"><div class="med-grid" id="mgrid"></div></div></div>
    <div class="card"><div class="card-h"><h3>🛒 Cart</h3><div class="actions"><button class="btn btn-xs" id="clear">Clear</button></div></div><div class="card-b">
      <div class="field"><label>Customer</label><div id="pos-picker"></div><input class="input" id="cust" placeholder="Or walk-in customer name" style="margin-top:6px"></div>
      <div id="cart"></div><div class="sep"></div>
      <div class="form-grid"><div class="field"><label>Discount</label><input class="input" type="number" min="0" step="0.01" id="disc" value="0"></div>
        <div class="field"><label>Payment method</label><select id="method">${options(['cash', 'mobile', 'card', 'bank'], 'cash')}</select></div>
        <div class="field span-all"><label>Reference</label><input class="input" id="ref" placeholder="Mobile money / card ref (optional)"></div></div>
      <div class="total-box"><span>Total</span><span id="ptotal">${money(0)}</span></div>
      <button class="btn btn-success btn-block" id="checkout" style="margin-top:12px;padding:12px">Complete sale & print receipt</button></div></div></div>`);
  patientPicker($('#pos-picker'), (p) => { patient = p; }, { allowNew: false });
  const renderGrid = () => {
    const q = $('#ms').value.toLowerCase();
    const list = meds.filter((m) => !q || `${m.name} ${m.generic_name} ${m.code}`.toLowerCase().includes(q)).slice(0, 60);
    setHTML($('#mgrid'), list.length ? h`${list.map((m) => h`<div class="med-tile ${m.stock <= 0 ? 'out' : ''}" data-id="${m.id}"><b>${m.name}</b><div class="small muted">${m.strength || ''} ${m.form || ''}</div>
      <div class="row" style="justify-content:space-between;margin-top:6px"><b style="color:var(--primary)">${money(m.unit_price)}</b><span class="small ${m.stock <= m.reorder_level ? 'flag-high' : 'muted'}">${m.stock} left</span></div></div>`)}` : emptyState('No medicines match'));
    $$('.med-tile', el).forEach((t) => t.onclick = () => {
      const m = meds.find((x) => x.id == t.dataset.id);
      if (m.stock <= 0) return toast('Out of stock', 'warn');
      const c = cart.get(m.id) || { m, qty: 0 };
      if (c.qty + 1 > m.stock) return toast('Not enough stock', 'warn');
      c.qty++; cart.set(m.id, c); renderCart();
    });
  };
  const total = () => Math.max(0, [...cart.values()].reduce((s, c) => s + c.qty * c.m.unit_price, 0) - (Number($('#disc').value) || 0));
  const renderCart = () => {
    setHTML($('#cart'), cart.size ? h`${[...cart.values()].map((c) => h`<div class="list-row"><div style="flex:1"><b>${c.m.name}</b> <span class="small muted">${c.m.strength || ''}</span><div class="small muted">${money(c.m.unit_price)} each</div></div>
      <input class="input qty" type="number" min="1" max="${c.m.stock}" value="${c.qty}" data-q="${c.m.id}"><b style="width:80px;text-align:right">${money(c.qty * c.m.unit_price)}</b><button class="btn btn-xs btn-ghost" data-rm="${c.m.id}">✕</button></div>`)}`
      : emptyState('Cart is empty. Click a medicine to add it.', '🛒'));
    $$('[data-q]', el).forEach((i) => i.onchange = () => { const c = cart.get(Number(i.dataset.q)); c.qty = Math.max(1, Math.min(c.m.stock, Number(i.value) || 1)); renderCart(); });
    $$('[data-rm]', el).forEach((b) => b.onclick = () => { cart.delete(Number(b.dataset.rm)); renderCart(); });
    $('#ptotal').textContent = money(total());
  };
  $('#ms').oninput = renderGrid;
  $('#disc').oninput = () => { $('#ptotal').textContent = money(total()); };
  $('#clear').onclick = () => { cart.clear(); renderCart(); };
  $('#checkout').onclick = async () => {
    if (!cart.size) return toast('Cart is empty', 'warn');
    const btn = $('#checkout'); btn.disabled = true;
    try {
      const r = await POST('/pharmacy/sales', { patient_id: patient ? patient.id : null, customer_name: patient ? null : ($('#cust').value || 'Walk-in customer'),
        items: [...cart.values()].map((c) => ({ medicine_id: c.m.id, quantity: c.qty })), discount: Number($('#disc').value) || 0, method: $('#method').value, reference: $('#ref').value });
      toast(`Sale complete · ${r.invoice_no}`);
      printInvoice(r.invoice_id, { receipt: true });
      cart.clear(); $('#disc').value = 0; $('#ref').value = ''; $('#cust').value = '';
      meds = await GET('/pharmacy/medicines?active=1');
      renderGrid(); renderCart();
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  };
  renderGrid(); renderCart();
}

/* ---------- Medicines & stock ---------- */
function medicineForm(m = {}, onDone) {
  openModal({
    title: m.id ? `Edit ${m.name}` : 'Add medicine', size: 'wide', submit: 'Save',
    body: h`<div class="form-grid c3">${field('Code', 'code', { value: m.code, required: true })}${field('Brand / name', 'name', { value: m.name, required: true })}${field('Generic name', 'generic_name', { value: m.generic_name })}
      ${field('Category', 'category', { value: m.category, placeholder: 'Antibiotic' })}${selectField('Form', 'form', options(['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Vial', 'Cream', 'Gel', 'Ointment', 'Drops', 'Inhaler', 'Sachet', 'Other'], m.form, { empty: 'Select' }))}
      ${field('Strength', 'strength', { value: m.strength, placeholder: '500mg' })}${field('Unit', 'unit', { value: m.unit || 'pcs' })}
      ${field('Selling price (per unit)', 'unit_price', { type: 'number', value: m.unit_price, required: true, attrs: 'step="0.01" min="0"' })}
      ${field('Reorder level', 'reorder_level', { type: 'number', value: m.reorder_level ?? 20, attrs: 'min="0"' })}
      ${m.id ? h`<label class="check"><input type="checkbox" name="active" ${m.active ? raw('checked') : ''}> Active</label>` : ''}</div>`,
    onSubmit: async (d, f, close) => { if (m.id) await PUT(`/pharmacy/medicines/${m.id}`, d); else await POST('/pharmacy/medicines', d); toast('Medicine saved'); close(); onDone(); },
  });
}
async function stockInModal(meds, preselect, onDone) {
  const [suppliers, paySel] = await Promise.all([GET('/suppliers'), paymentSelect()]);
  const m = openModal({
    title: 'Receive stock (new batch)', size: 'wide', submit: 'Receive stock', submitClass: 'btn-success',
    body: h`<div class="form-grid">${selectField('Medicine', 'medicine_id', options(meds, preselect, { empty: 'Select medicine', label: (m) => `${m.name} ${m.strength || ''} (${m.code})` }), { required: true, cls: 'span-2' })}
      ${field('Batch number', 'batch_no', { required: true })}${field('Expiry date', 'expiry_date', { type: 'date', required: true, attrs: `min="${today()}"` })}
      ${field('Quantity', 'quantity', { type: 'number', required: true, attrs: 'min="1"' })}${field('Cost price per unit', 'cost_price', { type: 'number', attrs: 'step="0.01" min="0"' })}
      ${selectField('Supplier', 'supplier_id', options(suppliers, '', { empty: 'Select supplier' }))}${paySel}
      <div class="total-box span-all" style="font-size:16px;padding:10px 14px"><span>Purchase value</span><span id="pv">${money(0)}</span></div></div>
      <p class="small muted">Paid now: money leaves the chosen account. On credit: the amount is added to what you owe this supplier (pay later in Financial Statements → Supplier Payables).</p>`,
    onSubmit: async (d, f, close) => {
      if (d.payment === 'credit' && !d.supplier_id) throw new Error('Choose the supplier for a credit purchase');
      await POST('/pharmacy/stock-in', d); toast('Stock received and posted to accounts'); close(); onDone();
    },
  });
  const f = $('form', m.el);
  const pv = () => { $('#pv', m.el).textContent = money((Number(f.quantity.value) || 0) * (Number(f.cost_price.value) || 0)); };
  f.quantity.oninput = pv; f.cost_price.oninput = pv;
}
async function batchesModal(m, onDone) {
  const batches = await GET(`/pharmacy/medicines/${m.id}/batches`);
  const modal = openModal({
    title: `Batches · ${m.name} ${m.strength || ''}`, size: 'wide',
    body: batches.length ? h`<div class="table-wrap"><table class="table"><thead><tr><th>Batch</th><th>Expiry</th><th class="right">Received</th><th class="right">Available</th><th class="right">Cost</th><th>Supplier</th><th></th></tr></thead><tbody>
      ${batches.map((b) => h`<tr><td class="mono">${b.batch_no}</td><td>${fmtDate(b.expiry_date)} ${b.expired ? badge('cancelled', 'Expired') : b.days_left <= 90 ? badge('pending', b.days_left + 'd left') : ''}</td>
        <td class="right">${b.qty_received}</td><td class="right"><b>${b.qty_available}</b></td><td class="right">${money(b.cost_price)}</td><td class="small">${b.supplier || ''}</td>
        <td class="actions">${can('pharmacist') && b.qty_available > 0 ? h`<button class="btn btn-xs" data-adj="${b.id}">Adjust</button>` : ''}</td></tr>`)}</tbody></table></div>` : emptyState('No batches received yet'),
  });
  $$('[data-adj]', modal.el).forEach((btn) => btn.onclick = () => {
    const b = batches.find((x) => x.id == btn.dataset.adj);
    modal.close();
    openModal({
      title: `Adjust batch ${b.batch_no}`, submit: 'Apply adjustment',
      body: h`<p class="muted">Available: <b>${b.qty_available}</b>. Use a negative number to remove stock.</p>
        <div class="form-grid">${field('Quantity (+/-)', 'quantity', { type: 'number', required: true, value: b.expired ? -b.qty_available : '' })}
        ${selectField('Reason', 'reason', options(['damaged', 'expired', 'count_correction', 'return'], b.expired ? 'expired' : 'count_correction'), { required: true })}
        ${areaField('Notes', 'notes', '', { cls: 'span-all', rows: 2 })}</div>`,
      onSubmit: async (d, f, close) => { await POST('/pharmacy/adjust', { ...d, batch_id: b.id }); toast('Stock adjusted'); close(); onDone(); },
    });
  });
}
async function renderMedicines(el) {
  let tab = 'stock';
  setHTML(el, h`<div class="page-head"><div><h1>Medicine Stock</h1><div class="muted">Batch-level inventory with expiry tracking and FEFO dispensing.</div></div>
    <div class="actions">${can('pharmacist') ? h`<button class="btn" id="add-m">+ Add medicine</button><button class="btn btn-success" id="stock-in">📥 Receive stock</button>` : ''}</div></div>
    <div class="grid g3" id="alerts" style="margin-bottom:16px"></div>
    <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs"><button data-t="stock" class="active">Stock list</button><button data-t="alerts">Alerts</button><button data-t="moves">Stock movements</button></div>
      <div class="filters" style="margin-bottom:12px" id="mfilters"><div class="search"><input class="input" id="mq" placeholder="Search medicines"></div>
        <select id="mstat">${options([['all', 'All'], ['low', 'Low / out of stock'], ['ok', 'In stock']].map(([id, name]) => ({ id, name })), 'all')}</select></div></div>
      <div class="table-wrap" id="mtable"></div></div>`);
  let meds = [], alerts = null;
  const load = async () => {
    [meds, alerts] = await Promise.all([GET('/pharmacy/medicines'), GET('/pharmacy/alerts')]);
    setHTML($('#alerts'), h`<div class="card stat"><div class="si t-red">📉</div><div><div class="sv">${alerts.low.length}</div><div class="sl">Below reorder level</div></div></div>
      <div class="card stat"><div class="si t-amber">⌛</div><div><div class="sv">${alerts.expiring.length}</div><div class="sl">Batches expiring within ${alerts.days} days</div></div></div>
      <div class="card stat"><div class="si t-purple">🚫</div><div><div class="sv">${alerts.expired.length}</div><div class="sl">Expired batches with stock</div></div></div>`);
    render();
  };
  const render = async () => {
    $('#mfilters').classList.toggle('hidden', tab !== 'stock');
    if (tab === 'stock') {
      const q = $('#mq').value.toLowerCase(), st = $('#mstat').value;
      const list = meds.filter((m) => (!q || `${m.name} ${m.generic_name} ${m.code}`.toLowerCase().includes(q)) && (st === 'all' || (st === 'low' ? m.stock <= m.reorder_level : m.stock > m.reorder_level)));
      setHTML($('#mtable'), list.length ? h`<table class="table"><thead><tr><th>Code</th><th>Medicine</th><th>Category</th><th class="right">Price</th><th class="right">Stock</th><th>Level</th><th>Next expiry</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((m) => {
          const pct = Math.min(100, Math.round((m.stock / Math.max(1, m.reorder_level * 3)) * 100));
          return h`<tr><td class="mono small">${m.code}</td><td><b>${m.name}</b> ${m.strength || ''}<div class="small muted">${m.generic_name || ''} · ${m.form || ''}</div></td><td class="small">${m.category || ''}</td>
            <td class="right">${money(m.unit_price)}</td><td class="right"><b>${m.stock}</b> <span class="small muted">${m.unit || ''}</span>${m.expired_qty ? h`<div class="small flag-high">${m.expired_qty} expired</div>` : ''}</td>
            <td style="width:110px"><div class="progress"><i style="width:${pct}%;background:${m.stock <= 0 ? 'var(--danger)' : m.stock <= m.reorder_level ? 'var(--warning)' : 'var(--success)'}"></i></div><div class="small muted">reorder at ${m.reorder_level}</div></td>
            <td class="small">${fmtDate(m.next_expiry) || '-'}</td><td>${!m.active ? badge('inactive') : m.stock <= 0 ? badge('cancelled', 'Out of stock') : m.stock <= m.reorder_level ? badge('pending', 'Low') : badge('active', 'OK')}</td>
            <td class="actions"><button class="btn btn-xs" data-b="${m.id}">Batches</button>${can('pharmacist') ? h`<button class="btn btn-xs" data-in="${m.id}">+ Stock</button><button class="btn btn-xs" data-e="${m.id}">Edit</button>` : ''}</td></tr>`;
        })}</tbody></table>` : emptyState('No medicines'));
      $$('[data-b]', el).forEach((b) => b.onclick = () => batchesModal(meds.find((m) => m.id == b.dataset.b), load));
      $$('[data-in]', el).forEach((b) => b.onclick = () => stockInModal(meds, b.dataset.in, load));
      $$('[data-e]', el).forEach((b) => b.onclick = () => medicineForm(meds.find((m) => m.id == b.dataset.e), load));
    } else if (tab === 'alerts') {
      setHTML($('#mtable'), h`<div class="card-b grid g3">
        <div><div class="section-t">Low stock</div>${alerts.low.length ? alerts.low.map((m) => h`<div class="list-row"><b>${m.name}</b> ${m.strength || ''}<span style="margin-left:auto" class="${m.stock <= 0 ? 'flag-high' : ''}">${m.stock} / ${m.reorder_level}</span></div>`) : emptyState('All good')}</div>
        <div><div class="section-t">Expiring soon</div>${alerts.expiring.length ? alerts.expiring.map((b) => h`<div class="list-row"><div><b>${b.name}</b><div class="small muted">Batch ${b.batch_no} · ${b.qty_available} units</div></div><span style="margin-left:auto">${badge('pending', b.days_left + ' days')}</span></div>`) : emptyState('Nothing expiring')}</div>
        <div><div class="section-t">Expired (remove from shelf)</div>${alerts.expired.length ? alerts.expired.map((b) => h`<div class="list-row"><div><b>${b.name}</b><div class="small muted">Batch ${b.batch_no} · ${b.qty_available} units · ${fmtDate(b.expiry_date)}</div></div></div>`) : emptyState('No expired stock')}</div></div>`);
    } else {
      const moves = await GET('/pharmacy/movements');
      setHTML($('#mtable'), moves.length ? h`<table class="table"><thead><tr><th>Date</th><th>Medicine</th><th>Batch</th><th>Movement</th><th class="right">Qty</th><th class="right">Balance</th><th>Reference</th><th>By</th></tr></thead><tbody>
        ${moves.map((x) => h`<tr><td class="small">${fmtDT(x.created_at)}</td><td>${x.name} ${x.strength || ''}</td><td class="mono small">${x.batch_no || ''}</td><td>${badge(x.quantity > 0 ? 'income' : 'expense', cap(x.movement))}</td>
          <td class="right ${x.quantity < 0 ? 'flag-high' : ''}">${x.quantity > 0 ? '+' : ''}${x.quantity}</td><td class="right">${x.balance_after ?? ''}</td><td class="small">${x.reference || ''} ${x.notes ? '· ' + x.notes : ''}</td><td class="small">${x.user_name || ''}</td></tr>`)}</tbody></table>` : emptyState('No movements'));
    }
  };
  $$('[data-t]', el).forEach((b) => b.onclick = () => { tab = b.dataset.t; $$('[data-t]', el).forEach((x) => x.classList.toggle('active', x === b)); render(); });
  $('#mq').oninput = render; $('#mstat').onchange = render;
  const a = $('#add-m'); if (a) a.onclick = () => medicineForm({}, load);
  const s = $('#stock-in'); if (s) s.onclick = () => stockInModal(meds, '', load);
  await load();
}

/* ---------- Suppliers ---------- */
async function renderSuppliers(el) {
  const form = (s = {}) => openModal({
    title: s.id ? 'Edit supplier' : 'Add supplier', submit: 'Save',
    body: h`<div class="form-grid">${field('Name', 'name', { value: s.name, required: true, cls: 'span-2' })}${field('Contact person', 'contact_person', { value: s.contact_person })}
      ${field('Phone', 'phone', { value: s.phone })}${field('Email', 'email', { value: s.email, type: 'email' })}${field('Address', 'address', { value: s.address })}
      ${s.id ? h`<label class="check"><input type="checkbox" name="active" ${s.active ? raw('checked') : ''}> Active</label>` : ''}</div>`,
    onSubmit: async (d, f, close) => { if (s.id) await PUT(`/suppliers/${s.id}`, d); else await POST('/suppliers', d); toast('Supplier saved'); close(); load(); },
  });
  const load = async () => {
    const rows = await GET('/suppliers');
    setHTML(el, h`<div class="page-head"><div><h1>Suppliers</h1><div class="muted">Vendors for medicines and supplies.</div></div><div class="actions"><button class="btn btn-primary" id="add-s">+ Add supplier</button></div></div>
      <div class="card table-wrap">${rows.length ? h`<table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th>Address</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((s) => h`<tr><td><b>${s.name}</b></td><td>${s.contact_person || ''}</td><td>${s.phone || ''}</td><td>${s.email || ''}</td><td>${s.address || ''}</td><td>${badge(s.active ? 'active' : 'inactive')}</td>
        <td class="actions"><button class="btn btn-xs" data-e="${s.id}">Edit</button></td></tr>`)}</tbody></table>` : emptyState('No suppliers yet')}</div>`);
    $('#add-s').onclick = () => form();
    $$('[data-e]', el).forEach((b) => b.onclick = () => form(rows.find((s) => s.id == b.dataset.e)));
  };
  await load();
}

export default {
  pharmacy: { title: 'Pharmacy Dispensing', render: renderDispensing },
  pos: { title: 'OTC Sales', render: renderPOS },
  medicines: { title: 'Medicine Stock', render: renderMedicines },
  suppliers: { title: 'Suppliers', render: renderSuppliers },
};
