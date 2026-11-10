import { h, raw, $, $$, setHTML, GET, POST, PUT, money, fmtDT, fmtTime, mins, cap, badge, emptyState, today, can, toast, fail,
  openModal, field, selectField, options } from '../core.js';
import { printLabReport } from '../print.js';

// Suggest a flag from a numeric result and a "low-high" reference range.
function suggestFlag(value, range) {
  const v = parseFloat(value);
  if (/negative|normal|no /i.test(range || '')) {
    if (!value) return '';
    return /positive|reactive|seen|\+/i.test(value) ? 'abnormal' : 'normal';
  }
  const m = String(range || '').match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (!m || isNaN(v)) return '';
  const lo = Number(m[1]), hi = Number(m[2]);
  if (v < lo) return v < lo * 0.6 ? 'critical' : 'low';
  if (v > hi) return v > hi * 1.6 ? 'critical' : 'high';
  return 'normal';
}

async function resultsModal(orderId, onDone) {
  const o = await GET(`/lab/orders/${orderId}`);
  const done = o.status === 'completed';
  const m = openModal({
    title: `Results · ${o.order_no} · ${o.patient_name}`, size: 'xl',
    body: h`<div class="row small muted" style="margin-bottom:10px"><span>${cap(o.gender || '')} · ${o.age ?? '?'} yrs · ${o.mrn}</span><span>Requested by ${o.doctor_name || '-'}</span>
        <span>${fmtDT(o.created_at)}</span>${badge(o.priority)}${badge(o.status)}</div>
      ${o.clinical_notes ? h`<div class="small" style="margin-bottom:10px"><b>Clinical notes:</b> ${o.clinical_notes}</div>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Test</th><th>Sample</th><th style="width:200px">Result</th><th>Unit</th><th>Reference</th><th style="width:130px">Flag</th><th>Remarks</th></tr></thead><tbody>
      ${o.items.map((i) => h`<tr data-item="${i.id}" data-range="${i.normal_range || ''}"><td><b>${i.test_name}</b><div class="small muted">${i.code}</div></td><td class="small">${i.sample_type || ''}</td>
        <td><input class="input" name="result_value" value="${i.result_value || ''}" ${done ? raw('disabled') : ''}></td><td class="small">${i.unit || ''}</td><td class="small muted">${i.normal_range || ''}</td>
        <td><select name="result_flag" ${done ? raw('disabled') : ''}>${options(['normal', 'low', 'high', 'critical', 'abnormal'], i.result_flag, { empty: '—' })}</select></td>
        <td><input class="input" name="remarks" value="${i.remarks || ''}" ${done ? raw('disabled') : ''}></td></tr>`)}</tbody></table></div>
      <div class="small muted" style="margin-top:8px">Flags are suggested automatically from the reference range; adjust if needed. Completing sends results straight back to the doctor's queue.</div>`,
    footer: h`<div class="modal-f"><button type="button" class="btn" data-close>Close</button><button type="button" class="btn" id="r-print">🖨 Print</button>
      ${!done ? h`<button type="button" class="btn" id="r-save">Save draft</button><button type="button" class="btn btn-success" id="r-complete">✓ Complete & send to doctor</button>` : ''}</div>`,
  });
  $$('tr[data-item]', m.el).forEach((tr) => {
    const inp = $('[name=result_value]', tr), sel = $('[name=result_flag]', tr);
    inp.addEventListener('input', () => { const f = suggestFlag(inp.value, tr.dataset.range); if (f) sel.value = f; });
  });
  const collect = () => $$('tr[data-item]', m.el).map((tr) => ({ id: Number(tr.dataset.item), result_value: $('[name=result_value]', tr).value.trim(), result_flag: $('[name=result_flag]', tr).value, remarks: $('[name=remarks]', tr).value }));
  const save = async (complete) => {
    try {
      await POST(`/lab/orders/${o.id}/results`, { items: collect(), complete });
      toast(complete ? 'Results completed · sent back to doctor' : 'Draft saved');
      m.close(); onDone();
    } catch (e) { fail(e); }
  };
  $('#r-print', m.el).onclick = () => printLabReport(o.id);
  if (!done) { $('#r-save', m.el).onclick = () => save(false); $('#r-complete', m.el).onclick = () => save(true); }
}

async function renderLab(el, params, ctx) {
  let tab = 'open';
  setHTML(el, h`<div class="page-head"><div><h1>Laboratory</h1><div class="muted">Collect samples, enter results and close the loop back to the doctor.</div></div></div>
    <div class="grid g4" id="lab-stats" style="margin-bottom:16px"></div>
    <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs"><button data-t="open" class="active">Open orders</button><button data-t="done">Completed today</button><button data-t="all">Search all</button></div>
      <div class="filters" style="margin-bottom:12px"><div class="search"><input class="input" id="lq" placeholder="Patient, MRN or order no"></div></div></div>
      <div class="table-wrap" id="lab-table"></div></div>`);
  const load = async () => {
    const q = encodeURIComponent($('#lq').value);
    const url = tab === 'open' ? '/lab/orders?status=pending,sample_collected,in_progress' : tab === 'done' ? `/lab/orders?status=completed&date=${today()}` : `/lab/orders?q=${q}`;
    const [rows, open, doneToday] = await Promise.all([GET(url + (tab !== 'all' && q ? `&q=${q}` : '')), GET('/lab/orders?status=pending,sample_collected,in_progress'), GET(`/lab/orders?status=completed&date=${today()}`)]);
    const cnt = (s) => open.filter((o) => o.status === s).length;
    const avg = doneToday.length ? Math.round(doneToday.reduce((s, o) => s + o.minutes, 0) / doneToday.length) : 0;
    setHTML($('#lab-stats'), h`<div class="card stat"><div class="si t-amber">⏳</div><div><div class="sv">${cnt('pending')}</div><div class="sl">Awaiting sample</div></div></div>
      <div class="card stat"><div class="si t-purple">🔬</div><div><div class="sv">${cnt('sample_collected') + cnt('in_progress')}</div><div class="sl">Processing</div></div></div>
      <div class="card stat"><div class="si t-green">✅</div><div><div class="sv">${doneToday.length}</div><div class="sl">Completed today</div></div></div>
      <div class="card stat"><div class="si t-blue">⏱</div><div><div class="sv">${mins(avg)}</div><div class="sl">Avg. turnaround today</div></div></div>`);
    setHTML($('#lab-table'), rows.length ? h`<table class="table"><thead><tr><th>Order</th><th>Patient</th><th>Tests</th><th>Doctor</th><th>Priority</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>
      ${rows.map((o) => h`<tr><td class="mono small">${o.order_no}${o.token_no ? h`<div><span class="token" style="height:22px;min-width:28px;font-size:12px">${o.token_no}</span></div>` : ''}</td>
        <td><b>${o.patient_name}</b><div class="small muted">${cap(o.gender || '')} · ${o.age ?? '?'} yrs · ${o.mrn}</div></td><td class="small" style="max-width:260px">${o.tests}</td><td class="small">${o.doctor_name || ''}</td>
        <td>${badge(o.priority)}</td><td>${badge(o.status)}${Number(o.abnormal_count) ? h` ${badge('abnormal', o.abnormal_count + ' abn.')}` : ''}</td>
        <td class="small nowrap">${fmtTime(o.created_at)}<div class="muted">⏱ ${mins(o.minutes)}</div></td>
        <td class="actions">${o.status === 'pending' && can('lab', 'nurse') ? h`<button class="btn btn-xs" data-collect="${o.id}">🩸 Collect sample</button>` : ''}
          ${can('lab') && !['cancelled'].includes(o.status) ? h`<button class="btn btn-xs ${o.status === 'completed' ? '' : 'btn-primary'}" data-res="${o.id}">${o.status === 'completed' ? 'View' : '✎ Enter results'}</button>` : ''}
          <button class="btn btn-xs" data-print="${o.id}">🖨</button></td></tr>`)}</tbody></table>` : emptyState(tab === 'open' ? 'No open lab orders 🎉' : 'Nothing found', '🧪'));
    $$('[data-collect]', el).forEach((b) => b.onclick = async () => { try { await POST(`/lab/orders/${b.dataset.collect}/collect`); toast('Sample collected'); load(); } catch (e) { fail(e); } });
    $$('[data-res]', el).forEach((b) => b.onclick = () => resultsModal(b.dataset.res, () => { load(); ctx.refreshBadges(); }));
    $$('[data-print]', el).forEach((b) => b.onclick = () => printLabReport(b.dataset.print));
  };
  $$('[data-t]', el).forEach((b) => b.onclick = () => { tab = b.dataset.t; $$('[data-t]', el).forEach((x) => x.classList.toggle('active', x === b)); load().catch(fail); });
  let t; $('#lq').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); };
  await load();
  ctx.every(12000, () => { if (!document.querySelector('.modal-back')) load().catch(() => {}); });
}

function testForm(t = {}, onDone) {
  openModal({
    title: t.id ? 'Edit lab test' : 'Add lab test', submit: 'Save',
    body: h`<div class="form-grid">${field('Code', 'code', { value: t.code, required: true })}${field('Name', 'name', { value: t.name, required: true })}
      ${field('Category', 'category', { value: t.category, placeholder: 'Hematology' })}${field('Sample type', 'sample_type', { value: t.sample_type, placeholder: 'Blood' })}
      ${field('Unit', 'unit', { value: t.unit })}${field('Reference range', 'normal_range', { value: t.normal_range, placeholder: '70-110 or Negative' })}
      ${field('Price', 'price', { type: 'number', value: t.price, required: true, attrs: 'step="0.01" min="0"' })}${field('Turnaround', 'turnaround', { value: t.turnaround, placeholder: '1-2 hrs' })}
      ${t.id ? h`<label class="check"><input type="checkbox" name="active" ${t.active ? raw('checked') : ''}> Active</label>` : ''}</div>`,
    onSubmit: async (d, f, close) => { if (t.id) await PUT(`/lab/tests/${t.id}`, d); else await POST('/lab/tests', d); toast('Saved'); close(); onDone(); },
  });
}
async function renderTests(el) {
  const load = async () => {
    const tests = await GET('/lab/tests');
    setHTML(el, h`<div class="page-head"><div><h1>Lab Test Catalog</h1><div class="muted">${tests.length} tests · prices flow automatically to the patient invoice.</div></div>
      <div class="actions">${can('lab') ? h`<button class="btn btn-primary" id="add-t">+ Add test</button>` : ''}</div></div>
      <div class="card table-wrap"><table class="table"><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Sample</th><th>Reference range</th><th class="right">Price</th><th>Status</th><th></th></tr></thead><tbody>
      ${tests.map((t) => h`<tr><td class="mono">${t.code}</td><td><b>${t.name}</b></td><td>${t.category || ''}</td><td>${t.sample_type || ''}</td><td>${t.normal_range || ''} ${t.unit || ''}</td><td class="right">${money(t.price)}</td>
        <td>${badge(t.active ? 'active' : 'inactive')}</td><td class="actions">${can('lab') ? h`<button class="btn btn-xs" data-e="${t.id}">Edit</button>` : ''}</td></tr>`)}</tbody></table></div>`);
    const a = $('#add-t'); if (a) a.onclick = () => testForm({}, load);
    $$('[data-e]', el).forEach((b) => b.onclick = () => testForm(tests.find((t) => t.id == b.dataset.e), load));
  };
  await load();
}

export default {
  lab: { title: 'Laboratory', render: renderLab },
  'lab-tests': { title: 'Lab Test Catalog', render: renderTests },
};
