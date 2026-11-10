import { h, raw, $, $$, setHTML, GET, POST, PUT, money, fmtDate, fmtDT, fmtTime, mins, cap, badge, emptyState, today, can, role, toast, fail,
  openModal, confirmBox, field, selectField, areaField, options, patientPicker, initials, miniJourney } from '../core.js';
import { printToken, printInvoice } from '../print.js';

const GENDERS = ['male', 'female', 'other'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* ---------- Patient form ---------- */
export function patientForm(p = {}, onSaved) {
  openModal({
    title: p.id ? `Edit patient · ${p.mrn}` : 'Register new patient', size: 'wide', submit: p.id ? 'Save changes' : 'Register patient',
    body: h`<div class="form-grid c3">
      ${field('First name', 'first_name', { value: p.first_name, required: true })}
      ${field('Last name', 'last_name', { value: p.last_name, required: true })}
      ${field('Phone', 'phone', { value: p.phone, required: true, type: 'tel' })}
      ${selectField('Gender', 'gender', options(GENDERS, p.gender, { empty: 'Select' }))}
      ${field('Date of birth', 'dob', { value: p.dob, type: 'date' })}
      ${selectField('Blood group', 'blood_group', options(BLOOD, p.blood_group, { empty: 'Unknown' }))}
      ${field('Email', 'email', { value: p.email, type: 'email' })}
      ${field('Address', 'address', { value: p.address, cls: 'span-2' })}
      ${field('Emergency contact', 'emergency_contact', { value: p.emergency_contact })}
      ${field('Emergency phone', 'emergency_phone', { value: p.emergency_phone })}
      ${field('Insurance provider', 'insurance_provider', { value: p.insurance_provider })}
      ${field('Insurance number', 'insurance_no', { value: p.insurance_no })}
      ${areaField('Allergies', 'allergies', p.allergies, { cls: 'span-2', rows: 2, placeholder: 'e.g. Penicillin' })}
      ${areaField('Chronic conditions', 'chronic_conditions', p.chronic_conditions, { rows: 2 })}
    </div>`,
    onSubmit: async (d, f, close) => {
      let saved;
      if (p.id) { await PUT(`/patients/${p.id}`, d); saved = { ...p, ...d }; } else saved = await POST('/patients', d);
      toast(p.id ? 'Patient updated' : `Patient registered · ${saved.mrn}`);
      close();
      if (onSaved) onSaved(saved);
    },
  });
}

/* ---------- Check-in modal (used from many places) ---------- */
export async function checkinModal({ patient = null, appointment = null, onDone } = {}) {
  const doctors = await GET('/users?role=doctor&active=1');
  let picked = patient;
  const m = openModal({
    title: appointment ? `Check in · ${appointment.ref_code}` : 'Check in patient', submit: 'Check in & issue token', submitClass: 'btn-success',
    body: h`${appointment ? h`<div class="picked" style="margin-bottom:12px"><div class="avatar">${initials(appointment.patient_name)}</div><div><b>${appointment.patient_name}</b><div class="small muted">${appointment.mrn} · ${appointment.time} appointment</div></div></div>`
      : h`<div class="field"><label>Patient *</label><div id="ci-picker"></div><div class="small" style="margin-top:6px"><a href="javascript:void 0" id="ci-new">+ Register new patient</a></div></div>`}
      <div class="form-grid">
        ${selectField('Doctor', 'doctor_id', options(doctors, appointment ? appointment.doctor_id : '', { label: (d) => `${d.name} · ${d.department || d.specialization || ''} (${money(d.consultation_fee)})`, empty: 'Select doctor' }), { required: true, cls: 'span-2' })}
        ${selectField('Priority', 'priority', options(['normal', 'urgent', 'emergency'], 'normal'))}
        <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="skip_triage"> Skip triage (go straight to doctor)</label></div>
        ${areaField('Chief complaint', 'chief_complaint', appointment ? appointment.reason : '', { cls: 'span-all', rows: 2 })}
      </div>`,
    onSubmit: async (d, f, close) => {
      let v;
      if (appointment) v = await POST(`/appointments/${appointment.id}/checkin`, d);
      else {
        if (!picked) throw new Error('Select a patient first');
        v = await POST('/visits', { ...d, patient_id: picked.id });
      }
      close();
      const full = (await GET(`/visits/${v.id}`)).visit;
      toast(`Checked in · Token ${v.token_no}`);
      openModal({ title: 'Patient checked in', body: h`<div style="text-align:center"><div class="muted">Queue token</div><div style="font-size:64px;font-weight:800;line-height:1.1">${full.token_no}</div>
          <div><b>${full.patient_name}</b> → ${full.doctor_name}</div><div class="muted">${full.department || ''} ${full.doctor_room ? '· Room ' + full.doctor_room : ''}</div>
          <div style="margin-top:10px">${badge(full.status)}</div></div>`,
        footer: h`<div class="modal-f"><button type="button" class="btn" data-close>Close</button><button type="button" class="btn btn-primary" id="pt-print">🖨 Print token</button></div>` });
      $('#pt-print').onclick = () => printToken(full);
      if (onDone) onDone(v);
    },
  });
  if (!appointment) {
    const pk = patientPicker($('#ci-picker', m.el), (p) => { picked = p; });
    if (patient) pk.set(patient);
    $('#ci-new', m.el).onclick = () => patientForm({}, (p) => pk.set(p));
  }
}

/* ---------- Patients list ---------- */
async function renderPatients(el) {
  let q = '', offset = 0;
  const LIMIT = 25;
  setHTML(el, h`<div class="page-head"><div><h1>Patients</h1><div class="muted">Search the master patient index.</div></div>
    <div class="actions">${can('receptionist', 'nurse', 'doctor', 'pharmacist') ? h`<button class="btn btn-primary" id="new-p">+ Register patient</button>` : ''}</div></div>
    <div class="card"><div class="card-h"><div class="search" style="flex:1;max-width:420px"><input class="input" id="pq" placeholder="Name, MRN, phone or email"></div><span class="muted small" id="pcount"></span></div>
    <div class="table-wrap" id="ptable"></div><div class="card-b row" style="justify-content:flex-end" id="ppager"></div></div>`);
  const load = async () => {
    const { rows, total } = await GET(`/patients?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${offset}`);
    $('#pcount').textContent = `${total} patients`;
    setHTML($('#ptable'), rows.length ? h`<table class="table"><thead><tr><th>MRN</th><th>Name</th><th>Gender / Age</th><th>Phone</th><th>Blood</th><th>Alerts</th><th>Last visit</th><th></th></tr></thead><tbody>
      ${rows.map((p) => h`<tr class="clickable" data-id="${p.id}"><td class="mono">${p.mrn}</td><td><b>${p.first_name} ${p.last_name}</b></td><td>${cap(p.gender || '-')} · ${p.age ?? '-'}</td>
        <td>${p.phone || ''}</td><td>${p.blood_group || ''}</td><td>${p.allergies ? badge('critical', 'Allergy') : ''} ${p.chronic_conditions ? badge('pending', p.chronic_conditions) : ''}</td>
        <td>${fmtDate(p.last_visit) || h`<span class="muted">Never</span>`}</td><td class="actions">${can('receptionist', 'nurse') ? h`<button class="btn btn-sm btn-success" data-ci="${p.id}">Check in</button>` : ''}</td></tr>`)}
      </tbody></table>` : emptyState('No patients found'));
    setHTML($('#ppager'), h`<span class="muted small">${total ? offset + 1 : 0}–${Math.min(offset + LIMIT, total)} of ${total}</span>
      <button class="btn btn-sm" id="prev" ${offset === 0 ? raw('disabled') : ''}>‹ Prev</button><button class="btn btn-sm" id="next" ${offset + LIMIT >= total ? raw('disabled') : ''}>Next ›</button>`);
    $('#prev').onclick = () => { offset = Math.max(0, offset - LIMIT); load(); };
    $('#next').onclick = () => { offset += LIMIT; load(); };
    $$('tr[data-id]', el).forEach((tr) => tr.onclick = (e) => { if (e.target.closest('button')) return; location.hash = '#/patient/' + tr.dataset.id; });
    $$('[data-ci]', el).forEach((b) => b.onclick = () => checkinModal({ patient: rows.find((p) => p.id == b.dataset.ci) }));
  };
  let t;
  $('#pq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; offset = 0; load().catch(fail); }, 250); };
  const nb = $('#new-p'); if (nb) nb.onclick = () => patientForm({}, (p) => { location.hash = '#/patient/' + p.id; });
  await load();
}

/* ---------- Patient profile ---------- */
async function renderPatient(el, [id]) {
  const d = await GET(`/patients/${id}`);
  const p = d.patient;
  const tab = (key, label, n) => h`<button data-tab="${key}">${label}${n != null ? h`<span class="count">${n}</span>` : ''}</button>`;
  setHTML(el, h`<div class="page-head"><a href="#/patients" class="btn btn-sm">‹ Patients</a><h1>${p.first_name} ${p.last_name}</h1><span class="badge b-teal mono">${p.mrn}</span>
    <div class="actions">${can('receptionist', 'nurse', 'doctor') ? h`<button class="btn" id="edit-p">✏️ Edit</button>` : ''}
      ${can('receptionist') ? h`<button class="btn" id="book-p">📅 Book appointment</button>` : ''}
      ${can('receptionist', 'nurse') ? h`<button class="btn btn-success" id="ci-p">🎫 Check in</button>` : ''}</div></div>
    <div class="grid g-12">
      <div class="card"><div class="patient-banner"><div class="pa">${initials(p.first_name + ' ' + p.last_name)}</div><div><h2>${p.first_name} ${p.last_name}</h2><div class="muted">${cap(p.gender || '')} · ${p.age ?? '?'} years · ${p.blood_group || 'Blood group unknown'}</div></div></div>
        <div class="card-b">${p.allergies ? h`<div class="alert-strip" style="margin-bottom:12px">⚠ Allergies: ${p.allergies}</div>` : ''}
          <dl class="kv"><dt>Phone</dt><dd>${p.phone || '-'}</dd><dt>Email</dt><dd>${p.email || '-'}</dd><dt>Date of birth</dt><dd>${fmtDate(p.dob) || '-'}</dd>
          <dt>Address</dt><dd>${p.address || '-'}</dd><dt>Chronic</dt><dd>${p.chronic_conditions || '-'}</dd><dt>Emergency</dt><dd>${p.emergency_contact || '-'} ${p.emergency_phone || ''}</dd>
          <dt>Insurance</dt><dd>${p.insurance_provider || '-'} ${p.insurance_no || ''}</dd><dt>Registered</dt><dd>${fmtDate(p.created_at)}</dd></dl>
          ${d.vitals[0] ? h`<div class="sep"></div><div class="section-t">Latest vitals · ${fmtDate(d.vitals[0].created_at)}</div>
            <div class="vitals-grid">${[['Temp', d.vitals[0].temperature, '°C'], ['BP', d.vitals[0].bp_systolic ? d.vitals[0].bp_systolic + '/' + d.vitals[0].bp_diastolic : null, ''], ['Pulse', d.vitals[0].pulse, 'bpm'], ['SpO₂', d.vitals[0].spo2, '%'], ['Weight', d.vitals[0].weight, 'kg']]
              .filter((x) => x[1] != null).map(([l, v, u]) => h`<div class="vital"><div class="vl">${l}</div><div class="vv">${v}<span class="small muted"> ${u}</span></div></div>`)}</div>` : ''}
        </div></div>
      <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs">${tab('visits', 'Visits', d.visits.length)}${tab('labs', 'Lab results', d.labs.length)}${tab('rx', 'Prescriptions', d.prescriptions.length)}${tab('inv', 'Invoices', d.invoices.length)}${tab('appt', 'Appointments', d.appointments.length)}</div></div>
        <div id="ptab" class="table-wrap"></div></div>
    </div>`);
  const tabs = {
    visits: () => d.visits.length ? h`<table class="table"><thead><tr><th>Date</th><th>Visit</th><th>Doctor</th><th>Complaint / Diagnosis</th><th>Status</th></tr></thead><tbody>
      ${d.visits.map((v) => h`<tr class="clickable" data-visit="${v.id}"><td>${fmtDate(v.queue_date)}</td><td class="mono">${v.visit_no}</td><td>${v.doctor_name}</td><td>${v.diagnosis || h`<span class="muted">${v.chief_complaint || '-'}</span>`}</td><td>${badge(v.status)}</td></tr>`)}</tbody></table>` : emptyState('No visits yet'),
    labs: () => d.labs.length ? h`<table class="table"><thead><tr><th>Date</th><th>Order</th><th>Test</th><th>Result</th><th>Range</th><th>Flag</th></tr></thead><tbody>
      ${d.labs.map((l) => h`<tr><td>${fmtDate(l.created_at)}</td><td class="mono small">${l.order_no}</td><td>${l.test_name}</td><td class="flag-${l.result_flag || ''}">${l.result_value || h`<span class="muted">Pending</span>`} ${l.unit || ''}</td><td class="muted">${l.normal_range || ''}</td><td>${l.result_flag ? badge(l.result_flag) : ''}</td></tr>`)}</tbody></table>` : emptyState('No lab tests'),
    rx: () => d.prescriptions.length ? h`<table class="table"><thead><tr><th>Date</th><th>Rx</th><th>Doctor</th><th>Medicines</th><th>Status</th></tr></thead><tbody>
      ${d.prescriptions.map((r) => h`<tr><td>${fmtDate(r.created_at)}</td><td class="mono small">${r.rx_no}</td><td>${r.doctor_name || ''}</td><td class="small">${r.items || ''}</td><td>${badge(r.status)}</td></tr>`)}</tbody></table>` : emptyState('No prescriptions'),
    inv: () => d.invoices.length ? h`<table class="table"><thead><tr><th>Date</th><th>Invoice</th><th class="right">Total</th><th class="right">Paid</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.invoices.map((i) => h`<tr><td>${fmtDate(i.created_at)}</td><td class="mono small">${i.invoice_no}</td><td class="right">${money(i.total)}</td><td class="right">${money(i.amount_paid)}</td><td>${badge(i.status)}</td><td class="actions"><button class="btn btn-xs" data-print="${i.id}">🖨</button></td></tr>`)}</tbody></table>` : emptyState('No invoices'),
    appt: () => d.appointments.length ? h`<table class="table"><thead><tr><th>Date</th><th>Time</th><th>Ref</th><th>Doctor</th><th>Source</th><th>Status</th></tr></thead><tbody>
      ${d.appointments.map((a) => h`<tr><td>${fmtDate(a.appt_date)}</td><td>${String(a.appt_time).slice(0, 5)}</td><td class="mono small">${a.ref_code}</td><td>${a.doctor_name || ''}</td><td>${badge(a.source)}</td><td>${badge(a.status)}</td></tr>`)}</tbody></table>` : emptyState('No appointments'),
  };
  const show = (k) => {
    $$('[data-tab]', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
    setHTML($('#ptab'), tabs[k]());
    $$('[data-visit]', el).forEach((tr) => tr.onclick = () => { location.hash = '#/visit/' + tr.dataset.visit; });
    $$('[data-print]', el).forEach((b) => b.onclick = () => printInvoice(b.dataset.print));
  };
  $$('[data-tab]', el).forEach((b) => b.onclick = () => show(b.dataset.tab));
  show('visits');
  const e1 = $('#edit-p'); if (e1) e1.onclick = () => patientForm(p, () => renderPatient(el, [id]));
  const e2 = $('#ci-p'); if (e2) e2.onclick = () => checkinModal({ patient: p, onDone: () => renderPatient(el, [id]) });
  const e3 = $('#book-p'); if (e3) e3.onclick = () => appointmentModal({ patient: p, onDone: () => renderPatient(el, [id]) });
}

/* ---------- Appointment booking ---------- */
export async function appointmentModal({ patient = null, onDone } = {}) {
  const [depts, doctors] = await Promise.all([GET('/departments'), GET('/users?role=doctor&active=1')]);
  let picked = patient;
  const m = openModal({
    title: 'Book appointment', size: 'wide', submit: 'Book appointment',
    body: h`<div class="field"><label>Patient *</label><div id="ap-picker"></div><div class="small" style="margin-top:6px"><a href="javascript:void 0" id="ap-new">+ Register new patient</a></div></div>
      <div class="form-grid">
        ${selectField('Department', 'department_id', options(depts, '', { empty: 'All departments' }))}
        ${selectField('Doctor', 'doctor_id', options(doctors, '', { empty: 'Select doctor', label: (d) => `${d.name} · ${d.specialization || ''}` }), { required: true })}
        ${field('Date', 'appt_date', { type: 'date', value: today(), required: true, attrs: `min="${today()}"` })}
        ${selectField('Source', 'source', options(['reception', 'phone'], 'reception'))}
        <div class="field span-all"><label>Time slot *</label><div id="ap-slots" class="row"><span class="muted small">Choose a doctor and date</span></div><input type="hidden" name="appt_time"></div>
        ${areaField('Reason', 'reason', '', { cls: 'span-all', rows: 2 })}
      </div>`,
    onSubmit: async (d, f, close) => {
      if (!picked) throw new Error('Select a patient');
      if (!d.appt_time) throw new Error('Pick a time slot');
      const r = await POST('/appointments', { ...d, patient_id: picked.id });
      toast(`Appointment booked · ${r.ref_code}`);
      close();
      if (onDone) onDone(r);
    },
  });
  const form = $('form', m.el);
  const pk = patientPicker($('#ap-picker', m.el), (p) => { picked = p; });
  if (patient) pk.set(patient);
  $('#ap-new', m.el).onclick = () => patientForm({}, (p) => pk.set(p));
  form.department_id.onchange = () => {
    const list = doctors.filter((d) => !form.department_id.value || String(d.department_id) === form.department_id.value);
    setHTML(form.doctor_id, options(list, '', { empty: 'Select doctor', label: (d) => `${d.name} · ${d.specialization || ''}` }));
    loadSlots();
  };
  const loadSlots = async () => {
    form.appt_time.value = '';
    const box = $('#ap-slots', m.el);
    if (!form.doctor_id.value || !form.appt_date.value) return setHTML(box, h`<span class="muted small">Choose a doctor and date</span>`);
    const slots = await GET(`/appointments/slots?doctor_id=${form.doctor_id.value}&date=${form.appt_date.value}`);
    setHTML(box, slots.length ? h`${slots.map((s) => h`<button type="button" class="btn btn-sm" data-t="${s.time}" ${s.available ? '' : raw('disabled title="Booked"')}>${s.time}</button>`)}` : h`<span class="muted small">No slots left on this day</span>`);
    $$('[data-t]', box).forEach((b) => b.onclick = () => { $$('[data-t]', box).forEach((x) => x.classList.remove('btn-primary')); b.classList.add('btn-primary'); form.appt_time.value = b.dataset.t; });
  };
  form.doctor_id.onchange = loadSlots;
  form.appt_date.onchange = loadSlots;
}

async function renderAppointments(el, params, ctx) {
  const doctors = role() === 'doctor' ? [] : await GET('/users?role=doctor');
  setHTML(el, h`<div class="page-head"><div><h1>Appointments</h1><div class="muted">Bookings from reception, phone and the patient website.</div></div>
    <div class="actions">${can('receptionist') ? h`<button class="btn btn-primary" id="new-ap">+ Book appointment</button>` : ''}</div></div>
    <div class="card"><div class="card-h filters">
      <input type="date" class="input" id="f-date" value="${today()}">
      <select id="f-status">${options(['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'], '', { empty: 'All statuses' })}</select>
      <select id="f-source">${options(['web', 'reception', 'phone'], '', { empty: 'All sources' })}</select>
      ${doctors.length ? h`<select id="f-doc">${options(doctors, '', { empty: 'All doctors' })}</select>` : ''}
      <div class="search"><input class="input" id="f-q" placeholder="Name, ref or phone"></div>
      <label class="check small"><input type="checkbox" id="f-all"> All dates</label>
    </div><div class="table-wrap" id="ap-table"></div></div>`);
  const load = async () => {
    const qs = new URLSearchParams();
    if (!$('#f-all').checked) qs.set('date', $('#f-date').value);
    if ($('#f-status').value) qs.set('status', $('#f-status').value);
    if ($('#f-source').value) qs.set('source', $('#f-source').value);
    if ($('#f-doc') && $('#f-doc').value) qs.set('doctor_id', $('#f-doc').value);
    if ($('#f-q').value) qs.set('q', $('#f-q').value);
    const rows = await GET('/appointments?' + qs);
    setHTML($('#ap-table'), rows.length ? h`<table class="table"><thead><tr><th>Date</th><th>Time</th><th>Ref</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((a) => h`<tr><td>${fmtDate(a.appt_date)}</td><td><b class="mono">${a.time}</b></td><td class="mono small">${a.ref_code}</td>
        <td><a href="#/patient/${a.patient_id}"><b>${a.patient_name}</b></a><div class="small muted">${a.mrn} · ${a.phone || ''}</div></td>
        <td>${a.doctor_name || '-'}<div class="small muted">${a.department || ''}</div></td><td class="small">${a.reason || ''}</td><td>${badge(a.source, a.source === 'web' ? 'Online' : null)}</td><td>${badge(a.status)}</td>
        <td class="actions">${can('receptionist') ? h`
          ${a.status === 'pending' ? h`<button class="btn btn-xs" data-act="confirmed" data-id="${a.id}">Confirm</button>` : ''}
          ${['pending', 'confirmed'].includes(a.status) && a.appt_date <= today() ? h`<button class="btn btn-xs btn-success" data-ci="${a.id}">Check in</button>` : ''}
          ${['pending', 'confirmed'].includes(a.status) ? h`<button class="btn btn-xs" data-act="no_show" data-id="${a.id}">No-show</button><button class="btn btn-xs" data-act="cancelled" data-id="${a.id}">Cancel</button>` : ''}
          ${a.visit_id ? h`<a class="btn btn-xs" href="#/visit/${a.visit_id}">Visit</a>` : ''}` : ''}</td></tr>`)}
      </tbody></table>` : emptyState('No appointments for this filter', '📅'));
    $$('[data-act]', el).forEach((b) => b.onclick = async () => {
      if (b.dataset.act === 'cancelled' && !(await confirmBox('Cancel this appointment?', { danger: true, ok: 'Cancel appointment' }))) return;
      try { await PUT(`/appointments/${b.dataset.id}/status`, { status: b.dataset.act }); toast('Appointment updated'); load(); ctx.refreshBadges(); } catch (e) { fail(e); }
    });
    $$('[data-ci]', el).forEach((b) => b.onclick = () => checkinModal({ appointment: rows.find((a) => a.id == b.dataset.ci), onDone: load }));
  };
  ['#f-date', '#f-status', '#f-source', '#f-doc', '#f-all'].forEach((s) => { const x = $(s); if (x) x.onchange = () => load().catch(fail); });
  let t; $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); };
  const nb = $('#new-ap'); if (nb) nb.onclick = () => appointmentModal({ onDone: load });
  await load();
  ctx.every(30000, () => load().catch(() => {}));
}

/* ---------- Check-in & live queue ---------- */
async function renderCheckin(el, params, ctx) {
  setHTML(el, h`<div class="page-head"><div><h1>Check-in & Queue</h1><div class="muted">Check patients in, issue tokens and follow everyone through the care circle.</div></div>
    <div class="actions"><button class="btn" id="new-pt">+ New patient</button><button class="btn btn-success" id="ci">🎫 Check in patient</button></div></div>
    <div class="grid g4" id="ci-stats" style="margin-bottom:16px"></div>
    <div class="grid g-21">
      <div class="card"><div class="card-h"><h3>Today's queue</h3><div class="actions"><label class="check small"><input type="checkbox" id="only-active" checked> Active only</label></div></div><div class="table-wrap" id="q-table"></div></div>
      <div class="card"><div class="card-h"><h3>Expected appointments</h3></div><div class="card-b" id="exp-appts"></div></div>
    </div>`);
  const load = async () => {
    const [visits, appts] = await Promise.all([GET('/visits'), GET(`/appointments?date=${today()}`)]);
    const active = visits.filter((v) => !['completed', 'cancelled'].includes(v.status));
    const list = $('#only-active').checked ? active : visits;
    const count = (s) => visits.filter((v) => s.includes(v.status)).length;
    setHTML($('#ci-stats'), h`
      <div class="card stat"><div class="si t-teal">🎫</div><div><div class="sv">${visits.filter((v) => v.status !== 'cancelled').length}</div><div class="sl">Checked in today</div></div></div>
      <div class="card stat"><div class="si t-amber">💓</div><div><div class="sv">${count(['waiting_triage'])}</div><div class="sl">Waiting for triage</div></div></div>
      <div class="card stat"><div class="si t-blue">🩺</div><div><div class="sv">${count(['waiting_doctor', 'in_consultation', 'results_ready'])}</div><div class="sl">With / waiting doctor</div></div></div>
      <div class="card stat"><div class="si t-green">✅</div><div><div class="sv">${count(['completed'])}</div><div class="sl">Completed</div></div></div>`);
    setHTML($('#q-table'), list.length ? h`<table class="table"><thead><tr><th>Token</th><th>Patient</th><th>Doctor</th><th>Status</th><th>Journey</th><th>Time</th><th></th></tr></thead><tbody>
      ${list.map((v) => h`<tr><td><span class="token ${v.priority}">${v.token_no}</span></td><td><a href="#/visit/${v.id}"><b>${v.patient_name}</b></a><div class="small muted">${v.mrn} · ${v.visit_no}</div></td>
        <td>${v.doctor_name}<div class="small muted">${v.doctor_room ? 'Room ' + v.doctor_room : ''}</div></td><td>${badge(v.status)} ${v.priority !== 'normal' ? badge(v.priority) : ''}</td>
        <td>${miniJourney(v)}</td><td class="small nowrap">${fmtTime(v.checked_in_at)}<div class="muted">⏱ ${mins(v.minutes_in)}</div></td>
        <td class="actions"><button class="btn btn-xs" data-tok="${v.id}">🖨 Token</button>
          ${!['completed', 'cancelled'].includes(v.status) && can('receptionist', 'nurse') ? h`<button class="btn btn-xs" data-cancel="${v.id}">Cancel</button>` : ''}</td></tr>`)}
      </tbody></table>` : emptyState('No patients in the queue yet', '🎫'));
    const expected = appts.filter((a) => ['pending', 'confirmed'].includes(a.status));
    setHTML($('#exp-appts'), expected.length ? expected.map((a) => h`<div class="list-row"><b class="mono">${a.time}</b><div><div>${a.patient_name}</div><div class="small muted">${a.doctor_name || ''} ${a.source === 'web' ? '· Online' : ''}</div></div>
      <button class="btn btn-xs btn-success" style="margin-left:auto" data-aci="${a.id}">Check in</button></div>`) : emptyState('No pending appointments for today'));
    $$('[data-tok]', el).forEach((b) => b.onclick = () => printToken(visits.find((v) => v.id == b.dataset.tok)));
    $$('[data-cancel]', el).forEach((b) => b.onclick = async () => {
      if (!(await confirmBox('Cancel this visit? Lab orders, prescriptions and the unpaid invoice will be cancelled.', { danger: true, ok: 'Cancel visit' }))) return;
      try { await POST(`/visits/${b.dataset.cancel}/cancel`, {}); toast('Visit cancelled'); load(); } catch (e) { fail(e); }
    });
    $$('[data-aci]', el).forEach((b) => b.onclick = () => checkinModal({ appointment: appts.find((a) => a.id == b.dataset.aci), onDone: load }));
  };
  $('#ci').onclick = () => checkinModal({ onDone: load });
  $('#new-pt').onclick = () => patientForm({}, (p) => checkinModal({ patient: p, onDone: load }));
  $('#only-active').onchange = () => load().catch(fail);
  await load();
  ctx.every(15000, () => load().catch(() => {}));
}

export default {
  patients: { title: 'Patients', render: renderPatients },
  patient: { title: 'Patient profile', render: renderPatient },
  appointments: { title: 'Appointments', render: renderAppointments },
  checkin: { title: 'Check-in & Queue', render: renderCheckin },
};
