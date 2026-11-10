import { state, h, raw, $, $$, setHTML, GET, POST, api, toast, fail, logout, role, initials, cap, openModal, field, spinner } from './core.js';
import dashboard from './pages/dashboard.js';
import frontdesk from './pages/frontdesk.js';
import clinical from './pages/clinical.js';
import lab from './pages/lab.js';
import pharmacy from './pages/pharmacy.js';
import finance from './pages/finance.js';
import admin from './pages/admin.js';
import accounting from './pages/accounting.js';

const PAGES = { ...dashboard, ...frontdesk, ...clinical, ...lab, ...pharmacy, ...finance, ...accounting, ...admin };

// roles: '*' = everyone. Admin sees everything.
const NAV = [
  { section: 'Overview' },
  { path: 'dashboard', label: 'Dashboard', icon: '▦', roles: '*' },
  { path: 'flow', label: 'Patient Flow Circle', icon: '◎', roles: '*' },
  { section: 'Front Desk' },
  { path: 'patients', label: 'Patients', icon: '👥', roles: ['receptionist', 'nurse', 'doctor', 'lab', 'pharmacist', 'accountant'] },
  { path: 'appointments', label: 'Appointments', icon: '📅', roles: ['receptionist', 'doctor'], badge: 'web' },
  { path: 'checkin', label: 'Check-in & Queue', icon: '🎫', roles: ['receptionist', 'nurse'] },
  { section: 'Clinical' },
  { path: 'triage', label: 'Nurse Triage', icon: '💓', roles: ['nurse'], badge: 'triage' },
  { path: 'consult', label: 'Doctor Workspace', icon: '🩺', roles: ['doctor'], badge: 'doctor' },
  { path: 'lab', label: 'Laboratory', icon: '🧪', roles: ['lab'], badge: 'lab' },
  { path: 'lab-tests', label: 'Lab Test Catalog', icon: '📋', roles: ['lab'] },
  { section: 'Pharmacy' },
  { path: 'pharmacy', label: 'Dispensing', icon: '💊', roles: ['pharmacist'], badge: 'rx' },
  { path: 'pos', label: 'OTC Sales (POS)', icon: '🛒', roles: ['pharmacist'] },
  { path: 'medicines', label: 'Medicine Stock', icon: '📦', roles: ['pharmacist'] },
  { path: 'suppliers', label: 'Suppliers', icon: '🚚', roles: ['pharmacist', 'accountant'] },
  { section: 'Inventory & Finance' },
  { path: 'inventory', label: 'General Inventory', icon: '🏷️', roles: ['pharmacist', 'nurse', 'accountant'] },
  { path: 'billing', label: 'Billing & Cashier', icon: '🧾', roles: ['receptionist', 'accountant'] },
  { path: 'expenses', label: 'Expenses', icon: '💸', roles: ['accountant'] },
  { path: 'transactions', label: 'Transactions Ledger', icon: '📒', roles: ['accountant'] },
  { path: 'reports', label: 'Cash Reports', icon: '📈', roles: ['accountant'] },
  { section: 'Accounting' },
  { path: 'accounts', label: 'Chart of Accounts', icon: '🗂️', roles: ['accountant'] },
  { path: 'journals', label: 'Journal Entries', icon: '📝', roles: ['accountant'] },
  { path: 'statements', label: 'Financial Statements', icon: '📊', roles: ['accountant'] },
  { path: 'ledger', label: 'General Ledger', icon: '📒', roles: ['accountant'], hidden: true },
  { section: 'Administration' },
  { path: 'users', label: 'Staff & Users', icon: '🧑‍⚕️', roles: [] },
  { path: 'departments', label: 'Departments', icon: '🏥', roles: [] },
  { path: 'services', label: 'Services & Fees', icon: '🏷', roles: ['accountant'] },
  { path: 'settings', label: 'Settings', icon: '⚙️', roles: [] },
  { path: 'audit', label: 'Audit Log', icon: '🛡️', roles: [] },
];
const allowed = (n) => n.roles === '*' || role() === 'admin' || n.roles.includes(role());
const HOME = { admin: 'dashboard', receptionist: 'checkin', nurse: 'triage', doctor: 'consult', lab: 'lab', pharmacist: 'pharmacy', accountant: 'billing' };

/* ---------- Login ---------- */
function renderLogin() {
  const demo = [['Admin', 'admin@hospital.com', 'Admin@123'], ['Reception', 'reception@hospital.com'], ['Nurse', 'nurse@hospital.com'], ['Doctor', 'doctor@hospital.com'],
    ['Lab', 'lab@hospital.com'], ['Pharmacy', 'pharmacy@hospital.com'], ['Accounts', 'accounts@hospital.com']];
  setHTML($('#root'), h`<div class="login-wrap">
    <div class="login-hero"><div class="ring"></div><div class="ring r2"></div>
      <div><div class="brand"><span class="brand-logo"></span>MediCircle HMS</div>
      <h1>Complete care,<br>full circle.</h1>
      <p>One connected system from the first appointment to the last pill - reception, nurses, doctors, laboratory, pharmacy and finance working as one team.</p>
      <div class="login-steps">${['Appointment', 'Check-in', 'Triage', 'Doctor', 'Lab', 'Results', 'Prescription', 'Pharmacy', 'Billing'].map((s, i) => h`<span>${i + 1}. ${s}</span>`)}</div></div>
      <div class="small" style="opacity:.7;position:relative">Patient website: <a style="color:#fff" href="/">open booking site</a> · Queue screen: <a style="color:#fff" href="/display/" target="_blank">open display</a></div>
    </div>
    <div class="login-panel"><div class="login-card">
      <h2>Staff sign in</h2><p class="muted" style="margin-top:0">Use your hospital account to continue.</p>
      <form id="login-form">
        ${field('Email', 'email', { type: 'email', required: true, attrs: 'autocomplete="username"' })}
        ${field('Password', 'password', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        <button class="btn btn-primary btn-block" type="submit" style="padding:11px">Sign in</button>
      </form>
      <div class="demo-logins"><b>Demo accounts</b> <span class="muted">(staff password: Staff@123)</span><br>
        ${demo.map(([l, e, p]) => h`<button type="button" class="btn btn-xs" data-e="${e}" data-p="${p || 'Staff@123'}">${l}</button>`)}</div>
    </div></div></div>`);
  const form = $('#login-form');
  const demoBox = $('.demo-logins');
  demoBox.classList.add('hidden');
  fetch('/api/public/info').then((r) => r.json()).then((i) => { if (i.demo) demoBox.classList.remove('hidden'); }).catch(() => {});
  $$('.demo-logins button').forEach((b) => b.onclick = () => { form.email.value = b.dataset.e; form.password.value = b.dataset.p; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const { token, user } = await POST('/auth/login', { email: form.email.value, password: form.password.value });
      state.token = token; state.user = user;
      localStorage.setItem('hms_token', token);
      localStorage.setItem('hms_user', JSON.stringify(user));
      location.hash = '#/' + (HOME[user.role] || 'dashboard');
      await boot();
    } catch (err) { fail(err); } finally { btn.disabled = false; }
  };
}

/* ---------- Shell ---------- */
function renderShell() {
  const u = state.user;
  setHTML($('#root'), h`<div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><span class="brand-logo"></span><div>MediCircle<div class="small" style="font-weight:400;color:#8ea2c0">${state.settings.hospital_name || 'HMS'}</div></div></div>
      <nav class="nav">${NAV.map((n) => {
        if (n.section) {
          const idx = NAV.indexOf(n);
          const next = NAV.slice(idx + 1);
          const end = next.findIndex((x) => x.section);
          const items = (end === -1 ? next : next.slice(0, end)).filter((x) => allowed(x) && !x.hidden);
          return items.length ? h`<div class="nav-section">${n.section}</div>` : '';
        }
        return allowed(n) && !n.hidden ? h`<a href="#/${n.path}" data-path="${n.path}"><span class="ic">${n.icon}</span>${n.label}${n.badge ? h`<span class="count hidden" data-badge="${n.badge}"></span>` : ''}</a>` : '';
      })}
      <div class="nav-section">Screens</div>
      <a href="/display/" target="_blank"><span class="ic">📺</span>Queue Display</a>
      <a href="/" target="_blank"><span class="ic">🌐</span>Patient Website</a></nav>
    </aside>
    <div class="main">
      <header class="topbar"><button class="menu-toggle" id="menu-toggle">☰</button><div class="title" id="page-title"></div><div class="spacer"></div>
        <span class="clock" id="clock"></span>
        <div class="user-chip" id="user-chip"><div class="avatar">${initials(u.name)}</div><div><div style="font-weight:600">${u.name}</div><div class="small muted">${cap(u.role)}${u.department ? ' · ' + u.department : ''}</div></div>
          <div class="menu hidden" id="user-menu"><button data-act="pw">🔑 Change password</button><button data-act="out">↩ Sign out</button></div></div>
      </header>
      <main class="content" id="content"></main>
    </div></div>`);
  $('#menu-toggle').onclick = () => $('#sidebar').classList.toggle('open');
  $('#user-chip').onclick = (e) => { e.stopPropagation(); $('#user-menu').classList.toggle('hidden'); };
  document.addEventListener('click', () => { const m = $('#user-menu'); if (m) m.classList.add('hidden'); });
  $('#user-menu').onclick = (e) => {
    const act = e.target.dataset.act;
    if (act === 'out') logout();
    if (act === 'pw') openModal({ title: 'Change password', submit: 'Update password',
      body: h`${field('Current password', 'current_password', { type: 'password', required: true })}${field('New password (min 6)', 'new_password', { type: 'password', required: true })}`,
      onSubmit: async (d, f, close) => { await POST('/auth/change-password', d); toast('Password updated'); close(); } });
  };
  const tick = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 30000);
  refreshBadges(); setInterval(refreshBadges, 30000);
}

async function refreshBadges() {
  try {
    const d = await GET('/dashboard');
    const vals = { triage: d.flow.triage, doctor: null, lab: d.lab.pending + d.lab.processing, rx: d.pharmacy.pending, web: d.appointments.pending };
    if (role() === 'doctor') {
      const q = await GET('/queue/doctor');
      vals.doctor = q.rows.filter((r) => ['waiting_doctor', 'results_ready'].includes(r.status)).length;
    } else vals.doctor = d.flow.doctor + d.flow.results;
    $$('[data-badge]').forEach((b) => { const v = vals[b.dataset.badge]; b.textContent = v; b.classList.toggle('hidden', !v); });
  } catch { /* ignore */ }
}

/* ---------- Router ---------- */
let timers = [];
let navId = 0;
const ctx = {
  every(ms, fn) { timers.push(setInterval(fn, ms)); },
  refreshBadges,
};
async function route() {
  timers.forEach(clearInterval); timers = [];
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  const parts = (location.hash.replace(/^#\/?/, '') || HOME[role()] || 'dashboard').split('/');
  const path = parts[0], params = parts.slice(1);
  const nav = NAV.find((n) => n.path === path);
  const page = PAGES[path];
  const content = $('#content');
  $$('.nav a[data-path]').forEach((a) => a.classList.toggle('active', a.dataset.path === path));
  $('#sidebar').classList.remove('open');
  if (!page || (nav && !allowed(nav))) {
    $('#page-title').textContent = 'Not available';
    setHTML(content, h`<div class="card card-b"><div class="empty"><div class="ei">🔒</div>This page is not available for your role.</div></div>`);
    return;
  }
  $('#page-title').textContent = page.title || (nav && nav.label) || '';
  // Each navigation renders into a fresh container, so a slow previous page can never draw over this one.
  const my = ++navId;
  content.innerHTML = '';
  const box = document.createElement('div');
  content.appendChild(box);
  setHTML(box, spinner());
  const pageCtx = { ...ctx, every: (ms, fn) => { if (my === navId) timers.push(setInterval(fn, ms)); } };
  try { await page.render(box, params, pageCtx); } catch (e) {
    if (my !== navId) return;
    setHTML(box, h`<div class="card card-b"><div class="empty"><div class="ei">⚠️</div>${e.message}</div></div>`);
  }
}

async function boot() {
  if (!state.token || !state.user) return renderLogin();
  try {
    state.settings = await GET('/settings');
    document.title = `${state.settings.hospital_name || 'MediCircle'} · HMS`;
  } catch (e) { return renderLogin(); }
  renderShell();
  window.onhashchange = route;
  await route();
}
boot();
