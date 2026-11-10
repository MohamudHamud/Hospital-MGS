// Core helpers: API client, safe HTML templating, UI primitives.

export const state = {
  token: localStorage.getItem('hms_token'),
  user: JSON.parse(localStorage.getItem('hms_user') || 'null'),
  settings: {},
};

/* ---------- API ---------- */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && state.token && !path.startsWith('/auth/login')) { logout(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
export const GET = (p) => api(p);
export const POST = (p, b = {}) => api(p, { method: 'POST', body: b });
export const PUT = (p, b = {}) => api(p, { method: 'PUT', body: b });
export const DEL = (p) => api(p, { method: 'DELETE' });

export function logout() {
  localStorage.removeItem('hms_token');
  localStorage.removeItem('hms_user');
  location.hash = '';
  location.reload();
}
export const role = () => (state.user ? state.user.role : null);
export const can = (...roles) => role() === 'admin' || roles.includes(role());

/* ---------- Safe HTML ---------- */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function conv(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(conv).join('');
  return esc(v);
}
// Tagged template: interpolations are escaped unless wrapped with raw() or produced by h``.
export function h(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += conv(v) + strings[i + 1]; });
  return new Safe(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function setHTML(el, html) { el.innerHTML = Array.isArray(html) ? html.map(String).join('') : String(html); return el; }

/* ---------- Formatting ---------- */
export function money(n) {
  const cur = state.settings.currency || '$';
  const v = Number(n || 0);
  return `${v < 0 ? '-' : ''}${cur}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtDate(d) {
  if (!d) return '';
  const x = new Date(String(d).length <= 10 ? d + 'T00:00:00' : String(d).replace(' ', 'T'));
  return isNaN(x) ? d : x.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDT(d) {
  if (!d) return '';
  const x = new Date(String(d).replace(' ', 'T'));
  return isNaN(x) ? d : x.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(d) {
  if (!d) return '';
  const x = new Date(String(d).replace(' ', 'T'));
  return isNaN(x) ? d : x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function mins(m) {
  m = Number(m || 0);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function today(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const initials = (name = '') => name.replace(/^Dr\.?\s*/i, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const cap = (s = '') => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_COLORS = {
  pending: 'amber', confirmed: 'blue', checked_in: 'teal', completed: 'green', cancelled: 'gray', no_show: 'red',
  waiting_triage: 'amber', waiting_doctor: 'blue', in_consultation: 'teal', waiting_lab: 'purple', results_ready: 'red', waiting_pharmacy: 'amber',
  sample_collected: 'blue', in_progress: 'purple', partial: 'amber', dispensed: 'green', unpaid: 'red', paid: 'green',
  normal: 'gray', urgent: 'amber', emergency: 'red', stat: 'red', web: 'purple', reception: 'blue', phone: 'teal',
  income: 'green', expense: 'red', low: 'blue', high: 'red', critical: 'red', abnormal: 'red', active: 'green', inactive: 'gray',
};
const STATUS_LABELS = { waiting_triage: 'Waiting triage', waiting_doctor: 'Waiting doctor', in_consultation: 'In consultation', waiting_lab: 'At lab',
  results_ready: 'Results ready', waiting_pharmacy: 'At pharmacy', sample_collected: 'Sample collected' };
export const badge = (s, label) => (s ? h`<span class="badge b-${STATUS_COLORS[s] || 'gray'}">${label || STATUS_LABELS[s] || cap(s)}</span>` : '');

/* ---------- Toast ---------- */
export function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}
export const fail = (e) => toast(e.message || String(e), 'error');

/* ---------- Modal ---------- */
// openModal({ title, body, size, submit: 'Save', onSubmit(data, form, close) }) -> { el, close }
export function openModal({ title, body, size = '', submit = null, submitClass = 'btn-primary', onSubmit, footer, onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const tag = onSubmit ? 'form' : 'div';
  setHTML(back, h`<div class="modal ${size}"><${raw(tag)} class="modal-form" novalidate>
      <div class="modal-h"><h3>${title}</h3><button type="button" class="x" data-close>&times;</button></div>
      <div class="modal-b">${body}</div>
      ${footer !== undefined ? footer : (onSubmit ? h`<div class="modal-f"><button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn ${submitClass}">${submit || 'Save'}</button></div>` : '')}
    </${raw(tag)}></div>`);
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
  if (onSubmit) {
    const form = $('form', back);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      for (const el of $$('[required]', form)) {
        if (!String(el.value).trim()) { el.focus(); toast(`${el.dataset.label || el.name || 'Field'} is required`, 'warn'); return; }
      }
      if (btn) btn.disabled = true;
      try { await onSubmit(formData(form), form, close); } catch (err) { fail(err); } finally { if (btn) btn.disabled = false; }
    });
  }
  const first = $('input:not([type=hidden]):not([type=checkbox]),select,textarea', back);
  if (first) setTimeout(() => first.focus(), 30);
  return { el: back, close };
}

export function confirmBox(message, { title = 'Please confirm', ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({ title, body: h`<p style="margin:0">${message}</p>`, submit: ok, submitClass: danger ? 'btn-danger' : 'btn-primary',
      onSubmit: (_, __, close) => { done = true; close(); resolve(true); }, onClose: () => { if (!done) resolve(false); } });
    return m;
  });
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] = o[el.name] || []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

/* ---------- Small components ---------- */
export const options = (list, selected, { value = 'id', label = 'name', empty } = {}) => h`${empty !== undefined ? h`<option value="">${empty}</option>` : ''}${list.map((x) => {
  const v = typeof x === 'object' ? x[value] : x;
  const l = typeof x === 'object' ? (typeof label === 'function' ? label(x) : x[label]) : cap(x);
  return h`<option value="${v}" ${String(v) === String(selected ?? '') ? raw('selected') : ''}>${l}</option>`;
})}`;

export const field = (lbl, name, { type = 'text', value = '', required = false, cls = '', attrs = '', placeholder = '' } = {}) =>
  h`<div class="field ${cls}"><label>${lbl}${required ? ' *' : ''}</label><input class="input" type="${type}" name="${name}" value="${value ?? ''}" placeholder="${placeholder}" data-label="${lbl}" ${required ? raw('required') : ''} ${raw(attrs)}></div>`;
export const selectField = (lbl, name, opts, { required = false, cls = '' } = {}) =>
  h`<div class="field ${cls}"><label>${lbl}${required ? ' *' : ''}</label><select name="${name}" data-label="${lbl}" ${required ? raw('required') : ''}>${opts}</select></div>`;
export const areaField = (lbl, name, value = '', { cls = '', rows = 3, placeholder = '' } = {}) =>
  h`<div class="field ${cls}"><label>${lbl}</label><textarea name="${name}" rows="${rows}" placeholder="${placeholder}">${value ?? ''}</textarea></div>`;

export const emptyState = (msg, icon = '📭') => h`<div class="empty"><div class="ei">${icon}</div>${msg}</div>`;
export const spinner = () => h`<div class="spinner"></div>`;

// Patient search picker. Calls onPick(patient|null).
export function patientPicker(container, onPick, { allowNew = true } = {}) {
  const render = (p) => {
    if (p) {
      setHTML(container, h`<div class="picked"><div class="avatar">${initials(p.first_name + ' ' + p.last_name)}</div>
        <div><b>${p.first_name} ${p.last_name}</b><div class="small muted">${p.mrn} · ${p.phone || ''} ${p.age != null ? '· ' + p.age + ' yrs' : ''}</div></div>
        <button type="button" class="x">&times;</button></div>`);
      $('.x', container).onclick = () => { render(null); onPick(null); };
      return;
    }
    setHTML(container, h`<div class="picker"><div class="search"><input class="input" placeholder="Search patient by name, MRN or phone..." autocomplete="off"></div><div class="picker-list hidden"></div></div>`);
    const input = $('input', container), list = $('.picker-list', container);
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { list.classList.add('hidden'); return; }
      timer = setTimeout(async () => {
        try {
          const { rows } = await GET(`/patients?q=${encodeURIComponent(q)}&limit=8`);
          setHTML(list, h`${rows.map((p) => h`<div data-id="${p.id}"><b>${p.first_name} ${p.last_name}</b> <span class="muted small">${p.mrn} · ${p.phone || ''}</span></div>`)}
            ${!rows.length ? h`<div class="muted">No match.${allowNew ? ' Register a new patient below.' : ''}</div>` : ''}`);
          list.classList.remove('hidden');
          $$('[data-id]', list).forEach((d) => d.onclick = () => { const p = rows.find((x) => x.id == d.dataset.id); render(p); onPick(p); });
        } catch (e) { fail(e); }
      }, 220);
    });
    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 200));
  };
  render(null);
  return { set: (p) => { render(p); onPick(p); } };
}

/* ---------- Journey (the care circle per visit) ---------- */
export const STAGES = [
  { key: 'checkin', label: 'Check-in' },
  { key: 'triage', label: 'Triage' },
  { key: 'doctor', label: 'Doctor' },
  { key: 'lab', label: 'Lab' },
  { key: 'results', label: 'Review' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'done', label: 'Done' },
];
const STAGE_INDEX = { waiting_triage: 1, waiting_doctor: 2, in_consultation: 2, waiting_lab: 3, results_ready: 4, waiting_pharmacy: 5, completed: 6, cancelled: -1 };
export function journeyStates(visit, { hasLab, hasRx } = {}) {
  const idx = STAGE_INDEX[visit.status] ?? 0;
  const reviewed = visit.status === 'in_consultation' && hasLab;
  const cur = reviewed ? 4 : idx;
  return STAGES.map((s, i) => {
    if (visit.status === 'cancelled') return 'skip';
    if (i === 3 && hasLab === false && cur > 3) return 'skip';
    if (i === 4 && hasLab === false && cur > 4) return 'skip';
    if (i === 5 && hasRx === false && cur > 5) return 'skip';
    if (i === 1 && !visit.triaged_at && cur > 1) return 'skip';
    if (i < cur || (i === 6 && visit.status === 'completed')) return 'done';
    if (i === cur) return 'now';
    return '';
  });
}
export function journey(visit, opts) {
  const st = journeyStates(visit, opts);
  return h`<div class="journey">${STAGES.map((s, i) => h`<div class="st ${st[i]}"><div class="c">${st[i] === 'done' ? '✓' : i + 1}</div>${s.label}</div>`)}</div>`;
}
export function miniJourney(visit) {
  const st = journeyStates(visit, {});
  return h`<div class="mini-journey" title="${cap(visit.status)}">${st.map((s) => h`<i class="${s}"></i>`)}</div>`;
}
