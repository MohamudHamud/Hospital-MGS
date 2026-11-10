(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path, body) => {
    const res = await fetch('/api/public' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  };
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 4000); };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const initials = (n) => n.replace(/^Dr\.?\s*/i, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('');
  let info = { currency: '$' };
  const money = (n) => `${info.currency || '$'}${Number(n || 0).toFixed(2)}`;

  $('#yr').textContent = new Date().getFullYear();
  $('#burger').onclick = () => $('#links').classList.toggle('open');
  $$('#links a').forEach((a) => a.onclick = () => $('#links').classList.remove('open'));

  const state = { dept: null, doctor: null, date: null, time: null, depts: [], doctors: [] };

  async function init() {
    try {
      info = await api('/info');
      $$('[data-info]').forEach((el) => { const v = info[el.dataset.info]; if (v) el.textContent = v; });
      if (info.hospital_name) document.title = info.hospital_name;
    } catch { /* keep defaults */ }
    const [depts, doctors] = await Promise.all([api('/departments'), api('/doctors')]);
    state.depts = depts; state.doctors = doctors;
    $('#st-depts').textContent = depts.length;
    $('#st-docs').textContent = doctors.length;
    $('#dept-grid').innerHTML = depts.map((d) => `<div class="dept" data-id="${d.id}"><div class="ic">${esc(d.icon || '🏥')}</div><h3>${esc(d.name)}</h3><p>${esc(d.description || '')}</p>
      <p><b style="color:var(--teal)">${d.doctors} doctor${d.doctors == 1 ? '' : 's'}</b> · Book now →</p></div>`).join('');
    $$('.dept').forEach((el) => el.onclick = () => { location.hash = '#book'; pickDept(Number(el.dataset.id)); });
    $('#doc-grid').innerHTML = doctors.map((d) => `<div class="doc"><div class="av">${esc(initials(d.name))}</div><h3>${esc(d.name)}</h3><div class="sp">${esc(d.specialization || '')} · ${esc(d.department || '')}</div>
      <p>${esc(d.bio || '')}</p><button class="btn btn-ghost" data-doc="${d.id}">Book with ${esc(d.name.split(' ').slice(0, 2).join(' '))}</button></div>`).join('');
    $$('[data-doc]').forEach((b) => b.onclick = () => { const d = doctors.find((x) => x.id == b.dataset.doc); location.hash = '#book'; state.dept = d.department_id; pickDoctor(d.id); });
    $('#ch-depts').innerHTML = depts.filter((d) => d.doctors > 0).map((d) => `<button type="button" class="choice" data-dept="${d.id}"><span class="ic">${esc(d.icon || '🏥')}</span><span>${esc(d.name)}<small>${d.doctors} doctor(s)</small></span></button>`).join('');
    $$('[data-dept]').forEach((b) => b.onclick = () => pickDept(Number(b.dataset.dept)));
  }

  function go(step) {
    $$('.step').forEach((s) => s.classList.toggle('hidden', Number(s.dataset.step) !== step));
    $$('#stepper span').forEach((s, i) => s.classList.toggle('on', i < step));
    $('#back').hidden = step === 1;
    $('#back').onclick = () => go(step - 1);
    state.step = step;
  }

  function pickDept(id) {
    state.dept = id;
    $$('[data-dept]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.dept) === id));
    const docs = state.doctors.filter((d) => d.department_id === id);
    $('#ch-docs').innerHTML = docs.length ? docs.map((d) => `<button type="button" class="choice" data-d="${d.id}"><span class="ic">👩‍⚕️</span><span><b>${esc(d.name)}</b><small>${esc(d.specialization || '')}</small></span>
      <span class="fee">${money(d.consultation_fee)}</span></button>`).join('') : '<p class="muted">No doctors available in this department yet.</p>';
    $$('[data-d]').forEach((b) => b.onclick = () => pickDoctor(Number(b.dataset.d)));
    go(2);
  }

  function pickDoctor(id) {
    state.doctor = state.doctors.find((d) => d.id === id);
    state.date = null; state.time = null;
    const days = [];
    for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(d); }
    $('#dates').innerHTML = days.map((d) => `<button type="button" class="date" data-date="${ymd(d)}"><small>${d.toLocaleDateString(undefined, { weekday: 'short' })}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString(undefined, { month: 'short' })}</small></button>`).join('');
    $$('[data-date]').forEach((b) => b.onclick = () => pickDate(b.dataset.date));
    $('#slots').innerHTML = '<p class="muted">Select a date.</p>';
    go(3);
    pickDate(ymd(days[0]));
  }

  async function pickDate(date) {
    state.date = date; state.time = null;
    $$('[data-date]').forEach((b) => b.classList.toggle('sel', b.dataset.date === date));
    $('#slots').innerHTML = '<p class="muted">Loading available times…</p>';
    try {
      const slots = await api(`/slots?doctor_id=${state.doctor.id}&date=${date}`);
      const free = slots.filter((s) => s.available).length;
      $('#slots').innerHTML = slots.length && free ? slots.map((s) => `<button type="button" class="slot" data-t="${s.time}" ${s.available ? '' : 'disabled'}>${s.time}</button>`).join('')
        : '<p class="muted">No free times on this day. Please choose another date.</p>';
      $$('[data-t]').forEach((b) => b.onclick = () => {
        state.time = b.dataset.t;
        const dept = state.depts.find((d) => d.id === state.doctor.department_id);
        $('#summary').innerHTML = `<b>${esc(state.doctor.name)}</b> · ${esc(dept ? dept.name : '')}<br>📅 ${new Date(state.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} at <b>${esc(state.time)}</b> · Fee ${money(state.doctor.consultation_fee)}`;
        go(4);
      });
    } catch (e) { toast(e.message); }
  }

  $('#book-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    for (const el of $$('[required]', f)) if (!el.value.trim()) { el.focus(); toast('Please fill in all required fields'); return; }
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Booking…';
    try {
      const data = Object.fromEntries(new FormData(f));
      const r = await api('/appointments', { ...data, doctor_id: state.doctor.id, department_id: state.doctor.department_id, date: state.date, time: state.time });
      f.classList.add('hidden'); $('#stepper').classList.add('hidden');
      const d = $('#done');
      d.classList.remove('hidden');
      d.innerHTML = `<div class="check">✓</div><h3>Appointment requested!</h3><p class="muted">Save your reference code. Show it at reception when you arrive.</p>
        <div class="ref">${esc(r.ref_code)}</div><p><b>${esc(r.doctor)}</b><br>${new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at <b>${esc(r.time)}</b></p>
        <p class="muted">Please arrive 15 minutes early.</p><button class="btn btn-ghost" onclick="window.print()">🖨 Print</button> <button class="btn btn-primary" id="again">Book another</button>`;
      $('#again').onclick = () => { f.reset(); f.classList.remove('hidden'); $('#stepper').classList.remove('hidden'); d.classList.add('hidden'); go(1); };
    } catch (err) {
      toast(err.message);
      if (/no longer available/i.test(err.message)) pickDate(state.date).then(() => go(3));
    } finally { btn.disabled = false; btn.textContent = 'Confirm booking'; }
  };

  const showResult = (a, phone) => {
    const box = $('#lookup-result');
    const canCancel = ['pending', 'confirmed'].includes(a.status);
    box.innerHTML = `<div class="result"><dl><dt>Reference</dt><dd>${esc(a.ref_code)}</dd><dt>Patient</dt><dd>${esc(a.patient_name)}</dd><dt>Doctor</dt><dd>${esc(a.doctor_name || '')} · ${esc(a.department || '')}</dd>
      <dt>Date & time</dt><dd>${new Date(a.appt_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} at ${esc(a.time)}</dd>
      <dt>Status</dt><dd><span class="status ${esc(a.status)}">${esc(a.status.replace('_', ' '))}</span></dd>
      ${a.token_no ? `<dt>Queue token</dt><dd style="font-size:22px">${esc(a.token_no)}</dd>` : ''}</dl>
      ${canCancel ? '<button class="btn btn-danger" id="cancel-appt">Cancel appointment</button>' : ''}</div>`;
    const c = $('#cancel-appt');
    if (c) c.onclick = async () => {
      if (!confirm('Cancel this appointment?')) return;
      try { await api('/appointments/cancel', { ref_code: a.ref_code, phone }); showResult({ ...a, status: 'cancelled' }, phone); toast('Appointment cancelled'); } catch (e) { toast(e.message); }
    };
  };
  $('#lookup').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { showResult(await api('/appointments/lookup', d), d.phone); } catch (err) { $('#lookup-result').innerHTML = ''; toast(err.message); }
  };

  go(1);
  init().catch((e) => toast(e.message));
})();
