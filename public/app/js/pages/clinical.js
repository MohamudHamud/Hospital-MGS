import { h, raw, $, $$, setHTML, GET, POST, PUT, money, fmtDate, fmtDT, fmtTime, mins, cap, badge, emptyState, today, can, role, state, toast, fail,
  openModal, confirmBox, field, selectField, areaField, options, initials, journey, spinner } from '../core.js';
import { printPrescription, printLabReport, printInvoice, printToken } from '../print.js';

const CLOSED = ['completed', 'cancelled'];

/* ---------- Vitals ---------- */
export function vitalsModal(v, onDone) {
  openModal({
    title: `Triage · Token ${v.token_no} · ${v.patient_name}`, size: 'wide', submit: 'Save & send to doctor', submitClass: 'btn-success',
    body: h`${v.allergies ? h`<div class="alert-strip" style="margin-bottom:12px">⚠ Allergies: ${v.allergies}</div>` : ''}
      <div class="form-grid c4">
        ${field('Temperature (°C)', 'temperature', { type: 'number', attrs: 'step="0.1" min="30" max="45"' })}
        ${field('BP systolic', 'bp_systolic', { type: 'number', attrs: 'min="40" max="260"' })}
        ${field('BP diastolic', 'bp_diastolic', { type: 'number', attrs: 'min="20" max="180"' })}
        ${field('Pulse (bpm)', 'pulse', { type: 'number', attrs: 'min="20" max="250"' })}
        ${field('Resp. rate', 'resp_rate', { type: 'number', attrs: 'min="4" max="80"' })}
        ${field('SpO₂ (%)', 'spo2', { type: 'number', attrs: 'min="50" max="100"' })}
        ${field('Weight (kg)', 'weight', { type: 'number', attrs: 'step="0.1" min="0.5" max="400"' })}
        ${field('Height (cm)', 'height', { type: 'number', attrs: 'step="0.1" min="20" max="250"' })}
        ${field('Pain score (0-10)', 'pain_score', { type: 'number', attrs: 'min="0" max="10"' })}
        ${selectField('Priority', 'priority', options(['normal', 'urgent', 'emergency'], v.priority))}
        ${areaField('Chief complaint', 'chief_complaint', v.chief_complaint, { cls: 'span-2', rows: 2 })}
        ${areaField('Nurse notes', 'notes', '', { cls: 'span-all', rows: 2 })}
      </div><div id="bmi" class="small muted"></div>`,
    onSubmit: async (d, f, close) => {
      for (const k of Object.keys(d)) if (d[k] === '') delete d[k];
      await POST(`/visits/${v.id}/vitals`, d);
      toast('Vitals recorded · patient sent to doctor queue');
      close();
      if (onDone) onDone();
    },
  });
  const f = $$('.modal-back form').pop();
  const upd = () => {
    const w = Number(f.weight.value), hgt = Number(f.height.value) / 100;
    $('#bmi').textContent = w && hgt ? `BMI: ${(w / (hgt * hgt)).toFixed(1)}` : '';
  };
  f.weight.oninput = upd; f.height.oninput = upd;
}

async function renderTriage(el, params, ctx) {
  setHTML(el, h`<div class="page-head"><div><h1>Nurse Triage</h1><div class="muted">Record vital signs and set priority before the doctor sees the patient.</div></div></div>
    <div class="grid g-21"><div class="card"><div class="card-h"><h3>Waiting for triage</h3><span class="badge b-amber" id="tcount"></span></div><div class="table-wrap" id="t-wait"></div></div>
    <div class="card"><div class="card-h"><h3>Recently triaged</h3></div><div class="card-b" id="t-done"></div></div></div>`);
  const load = async () => {
    const [waiting, done] = await Promise.all([GET('/visits?status=waiting_triage'), GET('/visits?status=waiting_doctor,in_consultation')]);
    $('#tcount').textContent = waiting.length;
    setHTML($('#t-wait'), waiting.length ? h`<table class="table"><thead><tr><th>Token</th><th>Patient</th><th>Doctor</th><th>Complaint</th><th>Waiting</th><th></th></tr></thead><tbody>
      ${waiting.map((v) => h`<tr><td><span class="token ${v.priority}">${v.token_no}</span></td><td><b>${v.patient_name}</b><div class="small muted">${cap(v.gender || '')} · ${v.age ?? '?'} yrs · ${v.mrn}</div>${v.allergies ? badge('critical', 'Allergy') : ''}</td>
        <td>${v.doctor_name}</td><td class="small">${v.chief_complaint || '-'}</td><td>${mins(v.minutes_in)}</td><td class="actions"><button class="btn btn-sm btn-primary" data-v="${v.id}">💓 Record vitals</button></td></tr>`)}</tbody></table>`
      : emptyState('No patients waiting for triage', '💓'));
    setHTML($('#t-done'), done.length ? done.slice(0, 12).map((v) => h`<div class="list-row"><span class="token ${v.priority}">${v.token_no}</span><div><div>${v.patient_name}</div><div class="small muted">${v.doctor_name}</div></div>
      <div style="margin-left:auto">${badge(v.status)}</div></div>`) : emptyState('Nobody yet'));
    $$('[data-v]', el).forEach((b) => b.onclick = () => vitalsModal(waiting.find((v) => v.id == b.dataset.v), () => { load(); ctx.refreshBadges(); }));
  };
  await load();
  ctx.every(10000, () => load().catch(() => {}));
}

/* ---------- Lab order & prescription modals ---------- */
async function labOrderModal(visit, onDone) {
  const tests = await GET('/lab/tests?active=1');
  const cats = [...new Set(tests.map((t) => t.category || 'Other'))];
  const m = openModal({
    title: `Order lab investigations · ${visit.patient_name}`, size: 'wide', submit: 'Send to laboratory',
    body: h`<div class="search" style="margin-bottom:12px"><input class="input" id="tsearch" placeholder="Filter tests..."></div>
      <div class="test-cats">${cats.map((c) => h`<div class="test-cat"><h4>${c}</h4>${tests.filter((t) => (t.category || 'Other') === c).map((t) => h`
        <label class="check" data-name="${t.name.toLowerCase()} ${t.code.toLowerCase()}"><span><input type="checkbox" name="tests" data-multi="1" value="${t.id}" data-price="${t.price}"> ${t.name} <span class="muted small">${t.code}</span></span><span class="small muted">${money(t.price)}</span></label>`)}</div>`)}</div>
      <div class="form-grid" style="margin-top:8px">${selectField('Priority', 'priority', options(['normal', 'urgent', 'stat'], visit.priority === 'emergency' ? 'stat' : 'normal'))}
        <div class="field"><label>Total</label><div class="total-box" style="font-size:16px;padding:9px 12px"><span>Tests: <span id="tn">0</span></span><span id="tt">${money(0)}</span></div></div>
        ${areaField('Clinical notes for the lab', 'clinical_notes', visit.diagnosis || '', { cls: 'span-all', rows: 2 })}</div>`,
    onSubmit: async (d, f, close) => {
      if (!d.tests || !d.tests.length) throw new Error('Select at least one test');
      const r = await POST(`/visits/${visit.id}/lab-orders`, d);
      toast(`Lab order ${r.order_no} sent · patient directed to laboratory`);
      close(); onDone();
    },
  });
  const upd = () => {
    const sel = $$('input[name=tests]:checked', m.el);
    $('#tn', m.el).textContent = sel.length;
    $('#tt', m.el).textContent = money(sel.reduce((s, i) => s + Number(i.dataset.price), 0));
  };
  $$('input[name=tests]', m.el).forEach((i) => i.onchange = upd);
  $('#tsearch', m.el).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('[data-name]', m.el).forEach((l) => l.classList.toggle('hidden', !l.dataset.name.includes(q))); };
}

const FREQ = { 'Once daily': 1, 'Twice daily': 2, '3x daily': 3, '4x daily': 4, 'At night': 1, 'Every 8 hours': 3, 'Every 6 hours': 4, 'As needed': 0, 'Single dose': 0 };
async function prescribeModal(visit, onDone) {
  const meds = await GET('/pharmacy/medicines?active=1');
  const medOpts = options(meds, '', { empty: 'Select medicine', label: (m) => `${m.name} ${m.strength || ''} (${m.form || ''}) · stock ${m.stock}` });
  const row = () => h`<tr class="rx-row"><td style="min-width:230px"><select name="medicine_id">${medOpts}</select></td>
    <td><input class="input" name="dosage" placeholder="1 tab" value="1"></td>
    <td><select name="frequency">${options(Object.keys(FREQ), '3x daily', { value: null })}</select></td>
    <td><input class="input" name="duration" placeholder="5 days" value="5 days"></td>
    <td><input class="input qty" type="number" min="1" name="quantity" value="15"></td>
    <td><input class="input" name="instructions" placeholder="After meals"></td>
    <td><button type="button" class="btn btn-xs btn-ghost" data-del>✕</button></td></tr>`;
  const m = openModal({
    title: `Prescription · ${visit.patient_name}`, size: 'xl', submit: 'Send to pharmacy',
    body: h`${visit.allergies ? h`<div class="alert-strip" style="margin-bottom:12px">⚠ Allergies: ${visit.allergies}</div>` : ''}
      ${field('Diagnosis', 'diagnosis', { value: visit.diagnosis || '' })}
      <div class="table-wrap"><table class="table"><thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Qty</th><th>Instructions</th><th></th></tr></thead><tbody id="rx-rows">${row()}</tbody></table></div>
      <button type="button" class="btn btn-sm" id="add-row" style="margin-top:8px">+ Add medicine</button>
      ${areaField('Notes to pharmacist', 'notes', '', { rows: 2 })}<div class="small muted">Quantity is calculated from dose × frequency × days; you can override it.</div>`,
    onSubmit: async (d, f, close) => {
      const items = $$('.rx-row', f).map((tr) => Object.fromEntries(['medicine_id', 'dosage', 'frequency', 'duration', 'quantity', 'instructions'].map((k) => [k, $(`[name=${k}]`, tr).value])))
        .filter((i) => i.medicine_id);
      if (!items.length) throw new Error('Add at least one medicine');
      const low = items.filter((i) => { const md = meds.find((x) => x.id == i.medicine_id); return md && md.stock < Number(i.quantity); });
      if (low.length && !(await confirmBox(`${low.length} medicine(s) have insufficient stock in the pharmacy. Send anyway?`))) return;
      const r = await POST(`/visits/${visit.id}/prescriptions`, { diagnosis: d.diagnosis, notes: d.notes, items });
      toast(`Prescription ${r.rx_no} sent to pharmacy`);
      close(); onDone(r);
    },
  });
  const tbody = $('#rx-rows', m.el);
  const wire = () => $$('.rx-row', tbody).forEach((tr) => {
    $('[data-del]', tr).onclick = () => { if ($$('.rx-row', tbody).length > 1) tr.remove(); };
    const calc = () => {
      const dose = parseFloat($('[name=dosage]', tr).value) || 1;
      const days = parseFloat($('[name=duration]', tr).value) || 1;
      const fr = FREQ[$('[name=frequency]', tr).value];
      if (fr) $('[name=quantity]', tr).value = Math.ceil(dose * fr * days);
    };
    ['dosage', 'frequency', 'duration'].forEach((k) => { $(`[name=${k}]`, tr).onchange = calc; });
  });
  wire();
  $('#add-row', m.el).onclick = () => { tbody.insertAdjacentHTML('beforeend', String(row())); wire(); };
}

/* ---------- Visit panel (shared by doctor workspace and visit page) ---------- */
export async function renderVisitPanel(box, visitId, { onChange = () => {} } = {}) {
  setHTML(box, spinner());
  const d = await GET(`/visits/${visitId}`);
  const v = d.visit, p = d.patient;
  const isDoctor = role() === 'doctor' ? v.doctor_id === state.user.id : role() === 'admin';
  const open = !CLOSED.includes(v.status);
  const vt = d.vitals[0];
  const vital = (l, val, u, warn) => (val != null && val !== '' ? h`<div class="vital ${warn ? 'warn' : ''}"><div class="vl">${l}</div><div class="vv">${val}<span class="small muted"> ${u}</span></div></div>` : '');
  const hasLab = d.lab_orders.length > 0, hasRx = d.prescriptions.length > 0;
  const canNotes = isDoctor && open;
  const reload = async () => { await renderVisitPanel(box, visitId, { onChange }); onChange(); };

  let actions = '';
  if (isDoctor && open) {
    const callable = ['waiting_doctor', 'results_ready', 'waiting_triage'].includes(v.status);
    actions = h`${callable ? h`<button class="btn btn-primary" data-a="call">📣 Call patient in</button>` : ''}
      ${['in_consultation', 'waiting_lab', 'results_ready'].includes(v.status) ? h`<button class="btn" data-a="lab">🧪 Order lab tests</button>` : ''}
      ${['in_consultation', 'results_ready'].includes(v.status) ? h`<button class="btn" data-a="rx">💊 Prescribe</button>` : ''}
      ${['in_consultation', 'results_ready', 'waiting_lab'].includes(v.status) ? h`<button class="btn btn-success" data-a="complete">✅ Complete visit</button>` : ''}`;
  }
  const nurseAct = can('nurse') && open && role() !== 'admin' ? h`<button class="btn" data-a="vitals">💓 ${vt ? 'Update' : 'Record'} vitals</button>` : '';
  const hint = {
    waiting_triage: 'Patient is waiting for nurse triage.', waiting_doctor: 'Triage complete. Patient is waiting to be called by the doctor.',
    in_consultation: 'Patient is with the doctor.', waiting_lab: 'Patient is at the laboratory. The visit returns to the doctor automatically when results are ready.',
    results_ready: 'Lab results are ready. Call the patient back to review.', waiting_pharmacy: 'Prescription sent. Patient is at the pharmacy.',
    completed: 'Visit completed.', cancelled: 'Visit was cancelled.',
  }[v.status];

  setHTML(box, h`<div class="card">
    <div class="patient-banner"><div class="pa">${initials(v.patient_name)}</div>
      <div><h2>${v.patient_name} <span class="token ${v.priority}" style="vertical-align:middle;margin-left:6px">${v.token_no}</span></h2>
        <div class="muted">${[p.gender && cap(p.gender), p.age != null && `${p.age} yrs`].filter(Boolean).join(' · ')}${p.gender || p.age != null ? ' · ' : ''}<a href="#/patient/${p.id}">${p.mrn}</a>${[p.blood_group, v.visit_no, v.doctor_name].filter(Boolean).map((x) => ' · ' + x).join('')}</div></div>
      <div style="margin-left:auto;text-align:right">${badge(v.status)} ${v.priority !== 'normal' ? badge(v.priority) : ''}<div class="small muted" style="margin-top:4px">In circle ${mins(v.minutes_in)} · since ${fmtTime(v.checked_in_at)}</div></div></div>
    <div class="card-b">
      ${journey(v, { hasLab, hasRx })}
      ${p.allergies ? h`<div class="alert-strip" style="margin-top:10px">⚠ Allergies: ${p.allergies}</div>` : ''}
      ${p.chronic_conditions ? h`<div class="small" style="margin-top:6px"><b>Chronic:</b> ${p.chronic_conditions}</div>` : ''}
      <div class="row" style="margin-top:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px">
        <span class="small">ℹ️ ${hint}</span><div class="row" style="margin-left:auto">${actions}${nurseAct}
        <button class="btn btn-ghost btn-sm" data-a="token">🖨 Token</button></div></div>
    </div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="stack">
        <div class="card"><div class="card-h"><h3>Vital signs</h3><span class="small muted">${vt ? `${fmtDT(vt.created_at)} · ${vt.nurse_name || ''}` : ''}</span></div><div class="card-b">
          ${vt ? h`<div class="vitals-grid">${vital('Temp', vt.temperature, '°C', vt.temperature >= 37.8)}${vital('BP', vt.bp_systolic ? `${vt.bp_systolic}/${vt.bp_diastolic}` : null, 'mmHg', vt.bp_systolic >= 140)}
            ${vital('Pulse', vt.pulse, 'bpm', vt.pulse > 100)}${vital('Resp', vt.resp_rate, '/min')}${vital('SpO₂', vt.spo2, '%', vt.spo2 && vt.spo2 < 94)}
            ${vital('Weight', vt.weight, 'kg')}${vital('Height', vt.height, 'cm')}${vital('Pain', vt.pain_score, '/10', vt.pain_score >= 7)}</div>${vt.notes ? h`<div class="small" style="margin-top:8px"><b>Nurse:</b> ${vt.notes}</div>` : ''}`
          : emptyState('No vitals recorded', '💓')}</div></div>
        <div class="card"><div class="card-h"><h3>Consultation</h3>${canNotes ? h`<div class="actions"><button class="btn btn-sm btn-primary" id="save-notes">Save notes</button></div>` : ''}</div><div class="card-b">
          <form id="notes-form">${[['chief_complaint', 'Chief complaint'], ['symptoms', 'History & symptoms'], ['examination', 'Examination findings'], ['diagnosis', 'Diagnosis'], ['notes', 'Plan / notes']].map(([k, l]) =>
            canNotes ? areaField(l, k, v[k], { rows: k === 'diagnosis' ? 1 : 2 }) : (v[k] ? h`<div class="field"><label>${l}</label><div>${v[k]}</div></div>` : ''))}
            ${canNotes ? field('Follow-up date', 'follow_up_date', { type: 'date', value: v.follow_up_date || '' }) : (v.follow_up_date ? h`<div class="field"><label>Follow-up</label>${fmtDate(v.follow_up_date)}</div>` : '')}
            ${!canNotes && !v.chief_complaint && !v.diagnosis ? emptyState('No consultation notes yet', '📝') : ''}</form></div></div>
        ${d.history.length ? h`<div class="card"><div class="card-h"><h3>Previous visits</h3></div><div class="card-b"><div class="timeline">${d.history.map((x) => h`<div class="ti"><div class="small muted">${fmtDate(x.queue_date)} · ${x.doctor_name}</div>
          <a href="#/visit/${x.id}"><b>${x.diagnosis || x.chief_complaint || 'Visit'}</b></a></div>`)}</div></div></div>` : ''}
      </div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>🧪 Laboratory</h3></div><div class="card-b">
          ${hasLab ? d.lab_orders.map((o) => h`<div style="margin-bottom:14px"><div class="row"><b class="mono small">${o.order_no}</b>${badge(o.status)}${o.priority !== 'normal' ? badge(o.priority) : ''}
              <span class="small muted">${fmtTime(o.created_at)}</span>${o.status === 'completed' ? h`<button class="btn btn-xs" style="margin-left:auto" data-lab="${o.id}">🖨 Report</button>` : ''}</div>
            <table class="table" style="margin-top:6px"><tbody>${o.items.map((i) => h`<tr><td>${i.test_name}</td><td class="flag-${i.result_flag || ''}">${i.result_value || h`<span class="muted">Pending</span>`} ${i.result_value ? i.unit || '' : ''}</td>
              <td class="small muted">${i.normal_range || ''}</td><td>${i.result_flag && i.result_flag !== 'normal' ? badge(i.result_flag) : ''}</td></tr>`)}</tbody></table></div>`) : emptyState('No lab investigations ordered', '🧪')}</div></div>
        <div class="card"><div class="card-h"><h3>💊 Prescriptions</h3></div><div class="card-b">
          ${hasRx ? d.prescriptions.map((rx) => h`<div style="margin-bottom:14px"><div class="row"><b class="mono small">${rx.rx_no}</b>${badge(rx.status)}<span class="small muted">${rx.pharmacist ? 'by ' + rx.pharmacist : ''}</span>
              <button class="btn btn-xs" style="margin-left:auto" data-rx="${rx.id}">🖨 Print</button></div>
            <table class="table" style="margin-top:6px"><tbody>${rx.items.map((i) => h`<tr><td><b>${i.name}</b> ${i.strength || ''}</td><td class="small">${i.dosage || ''} · ${i.frequency || ''} · ${i.duration || ''}</td>
              <td class="right">${i.qty_dispensed}/${i.quantity}</td></tr>`)}</tbody></table>${rx.notes ? h`<div class="small muted">${rx.notes}</div>` : ''}</div>`) : emptyState('No prescriptions', '💊')}</div></div>
        ${d.invoice ? h`<div class="card"><div class="card-h"><h3>🧾 Billing</h3><div class="actions">${badge(d.invoice.status)}${can('receptionist', 'accountant') ? h`<a class="btn btn-xs" href="#/billing/${d.invoice.id}">Open</a>` : ''}<button class="btn btn-xs" data-inv="${d.invoice.id}">🖨</button></div></div><div class="card-b">
          ${d.invoice.items.map((i) => h`<div class="list-row"><span>${i.description}</span><span class="muted small">x${Number(i.quantity)}</span><b style="margin-left:auto">${money(i.amount)}</b></div>`)}
          <div class="list-row"><b>Total</b><b style="margin-left:auto">${money(d.invoice.total)}</b></div><div class="list-row"><span>Paid</span><span style="margin-left:auto">${money(d.invoice.amount_paid)}</span></div></div></div>` : ''}
      </div></div>`);

  const on = (sel, fn) => $$(sel, box).forEach((b) => b.addEventListener('click', fn));
  on('[data-a=call]', async () => { try { await POST(`/visits/${v.id}/call`); toast(`Calling token ${v.token_no}`); reload(); } catch (e) { fail(e); } });
  on('[data-a=lab]', () => labOrderModal({ ...v, allergies: p.allergies }, reload));
  on('[data-a=rx]', () => prescribeModal({ ...v, allergies: p.allergies }, (r) => { reload(); if (r && confirm('Print prescription now?')) printPrescription(v.id, r.id); }));
  on('[data-a=vitals]', () => vitalsModal(v, reload));
  on('[data-a=token]', () => printToken(v));
  on('[data-a=complete]', async () => {
    const pending = d.lab_orders.some((o) => !CLOSED.includes(o.status));
    if (!(await confirmBox(pending ? 'Lab results are still pending. Complete the visit anyway?' : 'Complete this visit? The patient leaves the circle (or goes to pharmacy if a prescription is pending).', { ok: 'Complete visit' }))) return;
    try { const r = await POST(`/visits/${v.id}/complete`, { force: pending }); toast(r.status === 'completed' ? 'Visit completed' : 'Patient sent to pharmacy'); reload(); } catch (e) { fail(e); }
  });
  on('[data-lab]', (e) => printLabReport(e.currentTarget.dataset.lab));
  on('[data-rx]', (e) => printPrescription(v.id, Number(e.currentTarget.dataset.rx)));
  on('[data-inv]', (e) => printInvoice(e.currentTarget.dataset.inv));
  const sn = $('#save-notes', box);
  if (sn) sn.onclick = async () => {
    const f = $('#notes-form', box);
    const data = Object.fromEntries(['chief_complaint', 'symptoms', 'examination', 'diagnosis', 'notes', 'follow_up_date'].map((k) => [k, f[k] ? f[k].value : undefined]));
    try { await PUT(`/visits/${v.id}`, data); toast('Consultation notes saved'); } catch (e) { fail(e); }
  };
}

/* ---------- Doctor workspace ---------- */
async function renderConsult(el, params, ctx) {
  let selected = params[0] ? Number(params[0]) : null;
  const isAdmin = role() === 'admin';
  const doctors = isAdmin ? await GET('/users?role=doctor&active=1') : [];
  let doctorId = isAdmin ? (doctors[0] && doctors[0].id) : state.user.id;
  setHTML(el, h`<div class="workspace">
    <div class="card"><div class="card-h" style="flex-wrap:wrap"><h3>My queue</h3><span class="small muted" id="q-meta"></span>
      ${isAdmin ? h`<select id="doc-sel" style="margin-top:6px">${options(doctors, doctorId)}</select>` : ''}</div><div class="queue-list" id="q-list"></div></div>
    <div id="panel">${emptyState('Select a patient from the queue to start the consultation.', '🩺')}</div></div>`);
  const loadQueue = async () => {
    const q = await GET(`/queue/doctor${isAdmin ? '?doctor_id=' + doctorId : ''}`);
    $('#q-meta').textContent = `${q.rows.length} active · ${q.completed} done · ${q.waiting_triage} at triage`;
    const group = (st) => q.rows.filter((r) => st.includes(r.status));
    const sections = [['In consultation', ['in_consultation']], ['Results ready — review', ['results_ready']], ['Waiting', ['waiting_doctor']], ['At laboratory', ['waiting_lab']], ['At pharmacy', ['waiting_pharmacy']]];
    setHTML($('#q-list'), q.rows.length ? h`${sections.map(([label, st]) => {
      const rows = group(st);
      return rows.length ? h`<div class="nav-section" style="color:var(--muted);margin:12px 14px 4px">${label} (${rows.length})</div>${rows.map((r) => h`
        <div class="q-item ${r.id === selected ? 'active' : ''}" data-id="${r.id}"><span class="token ${r.priority}">${r.token_no}</span>
          <div style="min-width:0"><div class="qn">${r.patient_name}</div><div class="small muted">${[r.gender && cap(r.gender), r.age != null && `${r.age} yrs`, `⏱ ${mins(r.minutes_in)}`].filter(Boolean).join(' · ')}</div></div>
          <div style="margin-left:auto">${r.status === 'results_ready' ? badge('results_ready', 'Results') : r.priority !== 'normal' ? badge(r.priority) : ''}</div></div>`)}` : '';
    })}` : emptyState('Your queue is empty', '☕'));
    $$('.q-item', el).forEach((it) => it.onclick = () => select(Number(it.dataset.id)));
  };
  const select = async (id) => {
    selected = id;
    history.replaceState(null, '', `#/consult/${id}`);
    $$('.q-item', el).forEach((x) => x.classList.toggle('active', Number(x.dataset.id) === id));
    try { await renderVisitPanel($('#panel'), id, { onChange: () => { loadQueue(); ctx.refreshBadges(); } }); } catch (e) { fail(e); }
  };
  const ds = $('#doc-sel'); if (ds) ds.onchange = () => { doctorId = ds.value; selected = null; setHTML($('#panel'), emptyState('Select a patient', '🩺')); loadQueue(); };
  await loadQueue();
  if (selected) await select(selected);
  ctx.every(15000, () => loadQueue().catch(() => {}));
}

async function renderVisit(el, [id], ctx) {
  setHTML(el, h`<div class="page-head"><a href="javascript:history.back()" class="btn btn-sm">‹ Back</a><h1>Visit details</h1>
    ${role() === 'doctor' ? h`<div class="actions"><a class="btn" href="#/consult/${id}">Open in workspace</a></div>` : ''}</div><div id="vp"></div>`);
  await renderVisitPanel($('#vp'), id);
}

export default {
  triage: { title: 'Nurse Triage', render: renderTriage },
  consult: { title: 'Doctor Workspace', render: renderConsult },
  visit: { title: 'Visit details', render: renderVisit },
};
