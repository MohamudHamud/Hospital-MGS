import { h, raw, $, $$, setHTML, GET, POST, PUT, money, fmtDT, cap, badge, emptyState, toast, fail, openModal, field, selectField, areaField, options, state, initials, can } from '../core.js';

const ROLES = ['admin', 'receptionist', 'doctor', 'nurse', 'lab', 'pharmacist', 'accountant'];

async function renderUsers(el) {
  const depts = await GET('/departments');
  let filter = '';
  const form = (u = {}) => {
    const m = openModal({
      title: u.id ? `Edit ${u.name}` : 'Add staff member', size: 'wide', submit: 'Save',
      body: h`<div class="form-grid">${field('Full name', 'name', { value: u.name, required: true })}${field('Email (login)', 'email', { value: u.email, required: true, type: 'email' })}
        ${selectField('Role', 'role', options(ROLES, u.role || 'receptionist'), { required: true })}${field('Phone', 'phone', { value: u.phone })}
        ${field(u.id ? 'New password (leave blank to keep)' : 'Password', 'password', { type: 'password', required: !u.id, attrs: 'autocomplete="new-password"' })}
        ${selectField('Department', 'department_id', options(depts, u.department_id, { empty: 'None' }))}
        <div class="span-all doc-only form-grid" style="grid-column:1/-1">${field('Specialization', 'specialization', { value: u.specialization })}
          ${field('Consultation fee', 'consultation_fee', { type: 'number', value: u.consultation_fee ?? 0, attrs: 'step="0.01" min="0"' })}
          ${field('Room', 'room', { value: u.room })}${areaField('Bio (shown on website)', 'bio', u.bio, { rows: 2 })}</div>
        ${u.id ? h`<label class="check"><input type="checkbox" name="active" ${u.active ? raw('checked') : ''}> Active (can log in)</label>` : ''}</div>`,
      onSubmit: async (d, f, close) => {
        if (!d.password) delete d.password;
        if (u.id) await PUT(`/users/${u.id}`, d); else await POST('/users', d);
        toast('Staff saved'); close(); load();
      },
    });
    const f = $('form', m.el);
    const sync = () => $('.doc-only', m.el).classList.toggle('hidden', f.role.value !== 'doctor');
    f.role.onchange = sync; sync();
  };
  const load = async () => {
    const users = await GET('/users');
    const list = users.filter((u) => !filter || u.role === filter);
    setHTML(el, h`<div class="page-head"><div><h1>Staff & Users</h1><div class="muted">${users.length} accounts · role decides which part of the circle each person works on.</div></div>
      <div class="actions"><button class="btn btn-primary" id="add-u">+ Add staff</button></div></div>
      <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs"><button data-r="" class="${!filter ? 'active' : ''}">All</button>${ROLES.map((r) => h`<button data-r="${r}" class="${filter === r ? 'active' : ''}">${cap(r)}<span class="count">${users.filter((u) => u.role === r).length}</span></button>`)}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Contact</th><th>Fee / Room</th><th>Last login</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((u) => h`<tr><td><div class="row"><div class="avatar">${initials(u.name)}</div><div><b>${u.name}</b><div class="small muted">${u.specialization || ''}</div></div></div></td><td>${badge('confirmed', cap(u.role))}</td>
        <td>${u.department || ''}</td><td class="small">${u.email}<div class="muted">${u.phone || ''}</div></td><td class="small">${u.role === 'doctor' ? h`${money(u.consultation_fee)} · ${u.room || '-'}` : ''}</td>
        <td class="small">${fmtDT(u.last_login) || 'Never'}</td><td>${badge(u.active ? 'active' : 'inactive')}</td><td class="actions"><button class="btn btn-xs" data-e="${u.id}">Edit</button></td></tr>`)}</tbody></table></div></div>`);
    $('#add-u').onclick = () => form();
    $$('[data-e]', el).forEach((b) => b.onclick = () => form(users.find((u) => u.id == b.dataset.e)));
    $$('[data-r]', el).forEach((b) => b.onclick = () => { filter = b.dataset.r; load(); });
  };
  await load();
}

async function renderDepartments(el) {
  const form = (d = {}) => openModal({
    title: d.id ? 'Edit department' : 'Add department', submit: 'Save',
    body: h`<div class="form-grid">${field('Name', 'name', { value: d.name, required: true })}${field('Icon (emoji)', 'icon', { value: d.icon })}${field('Location / block', 'room', { value: d.room })}
      ${d.id ? h`<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="active" ${d.active ? raw('checked') : ''}> Active (visible on website)</label></div>` : ''}
      ${areaField('Description', 'description', d.description, { cls: 'span-all' })}</div>`,
    onSubmit: async (x, f, close) => { if (d.id) await PUT(`/departments/${d.id}`, x); else await POST('/departments', x); toast('Saved'); close(); load(); },
  });
  const load = async () => {
    const rows = await GET('/departments');
    setHTML(el, h`<div class="page-head"><div><h1>Departments</h1><div class="muted">Shown on the patient website for online booking.</div></div><div class="actions"><button class="btn btn-primary" id="add-d">+ Add department</button></div></div>
      <div class="grid g3">${rows.map((d) => h`<div class="card card-b"><div class="row"><span style="font-size:28px">${d.icon || '🏥'}</span><div><h3>${d.name}</h3><div class="small muted">${d.room || ''} · ${d.doctors} doctors</div></div>
        <div style="margin-left:auto">${badge(d.active ? 'active' : 'inactive')}</div></div><p class="small muted">${d.description || ''}</p><button class="btn btn-sm" data-e="${d.id}">Edit</button></div>`)}</div>`);
    $('#add-d').onclick = () => form();
    $$('[data-e]', el).forEach((b) => b.onclick = () => form(rows.find((d) => d.id == b.dataset.e)));
  };
  await load();
}

async function renderServices(el) {
  const form = (s = {}) => openModal({
    title: s.id ? 'Edit service' : 'Add service', submit: 'Save',
    body: h`<div class="form-grid">${field('Name', 'name', { value: s.name, required: true, cls: 'span-2' })}${field('Category', 'category', { value: s.category })}
      ${field('Price', 'price', { type: 'number', value: s.price, required: true, attrs: 'step="0.01" min="0"' })}
      ${s.id ? h`<label class="check"><input type="checkbox" name="active" ${s.active ? raw('checked') : ''}> Active</label>` : ''}</div>`,
    onSubmit: async (d, f, close) => { if (s.id) await PUT(`/services/${s.id}`, d); else await POST('/services', d); toast('Saved'); close(); load(); },
  });
  const load = async () => {
    const [rows, docs] = await Promise.all([GET('/services'), GET('/users?role=doctor')]);
    setHTML(el, h`<div class="page-head"><div><h1>Services & Fees</h1><div class="muted">Procedures and charges the cashier can add to invoices. Consultation fees are set per doctor.</div></div>
      <div class="actions"><button class="btn btn-primary" id="add-s">+ Add service</button></div></div>
      <div class="grid g-21"><div class="card table-wrap"><table class="table"><thead><tr><th>Service</th><th>Category</th><th class="right">Price</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((s) => h`<tr><td><b>${s.name}</b></td><td>${s.category || ''}</td><td class="right">${money(s.price)}</td><td>${badge(s.active ? 'active' : 'inactive')}</td><td class="actions"><button class="btn btn-xs" data-e="${s.id}">Edit</button></td></tr>`)}</tbody></table></div>
      <div class="card"><div class="card-h"><h3>Consultation fees</h3></div><div class="card-b">${docs.map((d) => h`<div class="list-row"><span>${d.name}<div class="small muted">${d.department || ''}</div></span><b style="margin-left:auto">${money(d.consultation_fee)}</b></div>`)}
        ${can() ? h`<a class="btn btn-sm" href="#/users" style="margin-top:10px">Edit in Staff</a>` : ''}</div></div></div>`);
    $('#add-s').onclick = () => form();
    $$('[data-e]', el).forEach((b) => b.onclick = () => form(rows.find((s) => s.id == b.dataset.e)));
  };
  await load();
}

async function renderSettings(el) {
  const s = await GET('/settings');
  setHTML(el, h`<div class="page-head"><div><h1>Settings</h1><div class="muted">Hospital details appear on printouts, the website and the queue display.</div></div></div>
    <form class="card card-b" id="sf" style="max-width:860px"><div class="section-t">Hospital</div><div class="form-grid">
      ${field('Hospital name', 'hospital_name', { value: s.hospital_name, required: true })}${field('Tagline', 'tagline', { value: s.tagline })}
      ${field('Address', 'address', { value: s.address })}${field('Phone', 'phone', { value: s.phone })}${field('Email', 'email', { value: s.email })}${field('Currency symbol', 'currency', { value: s.currency })}</div>
      <div class="section-t" style="margin-top:10px">Appointments & pharmacy</div><div class="form-grid c4">
      ${field('Slots start', 'slot_start', { type: 'time', value: s.slot_start })}${field('Slots end', 'slot_end', { type: 'time', value: s.slot_end })}
      ${field('Slot length (min)', 'slot_minutes', { type: 'number', value: s.slot_minutes, attrs: 'min="5" max="240"' })}${field('Expiry alert (days)', 'expiry_alert_days', { type: 'number', value: s.expiry_alert_days, attrs: 'min="1"' })}</div>
      <button class="btn btn-primary">Save settings</button></form>`);
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    try { state.settings = await PUT('/settings', Object.fromEntries(new FormData(e.target))); toast('Settings saved'); } catch (err) { fail(err); }
  };
}

async function renderAudit(el) {
  setHTML(el, h`<div class="page-head"><div><h1>Audit Log</h1><div class="muted">Who did what, and when.</div></div></div>
    <div class="card"><div class="card-h filters"><div class="search"><input class="input" id="aq" placeholder="Search action, user or details"></div>
      <select id="ae">${options(['', 'visit', 'patient', 'appointment', 'lab_order', 'prescription', 'invoice', 'medicine', 'inventory', 'expense', 'user', 'settings'].map((x) => ({ id: x, name: x ? cap(x) : 'All entities' })), '')}</select></div>
    <div class="table-wrap" id="at"></div></div>`);
  const load = async () => {
    const rows = await GET(`/audit?q=${encodeURIComponent($('#aq').value)}&entity=${$('#ae').value}`);
    setHTML($('#at'), rows.length ? h`<table class="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
      ${rows.map((a) => h`<tr><td class="small nowrap">${fmtDT(a.created_at)}</td><td>${a.user_name || h`<span class="muted">Website</span>`}<div class="small muted">${cap(a.role || '')}</div></td>
        <td>${badge('confirmed', cap(a.action))}</td><td class="small">${cap(a.entity || '')} ${a.entity_id ? '#' + a.entity_id : ''}</td><td class="small">${a.details || ''}</td></tr>`)}</tbody></table>` : emptyState('No entries'));
  };
  let t; $('#aq').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); };
  $('#ae').onchange = () => load().catch(fail);
  await load();
}

export default {
  users: { title: 'Staff & Users', render: renderUsers },
  departments: { title: 'Departments', render: renderDepartments },
  services: { title: 'Services & Fees', render: renderServices },
  settings: { title: 'Settings', render: renderSettings },
  audit: { title: 'Audit Log', render: renderAudit },
};
