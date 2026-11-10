import { h, raw, $, $$, setHTML, GET, money, fmtTime, mins, cap, badge, emptyState, today, can, role, state } from '../core.js';

export const CIRCLE_NODES = [
  { key: 'checked_in', label: 'Checked in', color: '#0e7c86', link: 'checkin' },
  { key: 'triage', label: 'Triage', color: '#d98e04', link: 'triage' },
  { key: 'doctor', label: 'Doctor', color: '#2563eb', link: 'consult' },
  { key: 'lab', label: 'Laboratory', color: '#7c3aed', link: 'lab' },
  { key: 'results', label: 'Results', color: '#dc3545', link: 'consult' },
  { key: 'pharmacy', label: 'Pharmacy', color: '#db2777', link: 'pharmacy' },
  { key: 'billing', label: 'Billing', color: '#ea580c', link: 'billing' },
  { key: 'completed', label: 'Completed', color: '#15935b', link: 'flow' },
];

// The animated care circle: every stage of the patient journey as a node on a ring.
export function careCircle(flow) {
  const C = 220, R = 158, NR = 39, N = CIRCLE_NODES.length;
  const pos = (deg, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
  const active = (flow.triage || 0) + (flow.doctor || 0) + (flow.lab || 0) + (flow.results || 0) + (flow.pharmacy || 0);
  const arrows = CIRCLE_NODES.map((_, i) => {
    const mid = -90 + i * (360 / N) + 180 / N;
    const [x, y] = pos(mid);
    return h`<path d="M-6,-5 L6,0 L-6,5 Z" fill="#9fb3c8" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${mid + 90})"/>`;
  });
  const nodes = CIRCLE_NODES.map((n, i) => {
    const deg = -90 + i * (360 / N);
    const [x, y] = pos(deg);
    const v = flow[n.key] ?? '–';
    const busy = typeof v === 'number' && v > 0 && !['checked_in', 'completed'].includes(n.key);
    return h`<g class="node" data-link="${n.link}" role="button" tabindex="0" aria-label="${n.label}: ${v}">
      ${busy ? h`<circle class="pulse" cx="${x}" cy="${y}" r="${NR}" fill="${n.color}"/>` : ''}
      <circle cx="${x}" cy="${y}" r="${NR}" fill="#fff" stroke="${n.color}" stroke-width="4"/>
      <circle cx="${x}" cy="${y}" r="${NR - 8}" fill="${n.color}" opacity=".1"/>
      <text x="${x}" y="${y + 3}" text-anchor="middle" font-size="22" font-weight="800" fill="${n.color}">${v}</text>
      <text x="${x}" y="${y + 19}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#4a5568">${n.label.toUpperCase()}</text>
    </g>`;
  });
  return h`<svg class="care-circle" viewBox="0 0 440 440" role="img" aria-label="Patient care circle">
    <defs><radialGradient id="cg" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#e3f5f4"/><stop offset="1" stop-color="#fff"/></radialGradient></defs>
    <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#e3e8f0" stroke-width="14"/>
    <circle class="ring-flow" cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#13a3a0" stroke-width="3"/>
    ${arrows}
    <circle cx="${C}" cy="${C}" r="92" fill="url(#cg)" stroke="#e3e8f0"/>
    <text x="${C}" y="${C - 26}" text-anchor="middle" font-size="11" font-weight="700" fill="#66738a" letter-spacing="2">TODAY</text>
    <text x="${C}" y="${C + 12}" text-anchor="middle" font-size="42" font-weight="800" fill="#0d1b2e">${flow.checked_in || 0}</text>
    <text x="${C}" y="${C + 32}" text-anchor="middle" font-size="11.5" fill="#66738a">patients in the circle</text>
    <text x="${C}" y="${C + 52}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#0e7c86">${active} active now</text>
    ${nodes}
  </svg>`;
}
export function bindCircle(root) {
  $$('.care-circle .node, .legend-item[data-link]', root).forEach((g) => {
    const go = () => { location.hash = '#/' + g.dataset.link; };
    g.addEventListener('click', go);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

function chart(canvas, config) {
  if (!window.Chart || !canvas) return;
  const old = window.Chart.getChart(canvas);
  if (old) old.destroy();
  return new window.Chart(canvas, config);
}
const lastDays = (n) => Array.from({ length: n }, (_, i) => today(i - n + 1));
const shortDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

async function renderDashboard(el, params, ctx) {
  const load = async () => {
    const d = await GET('/dashboard');
    const f = d.finance;
    const stat = (icon, tone, value, label, link) => h`<a class="card stat" href="#/${link}" style="text-decoration:none;color:inherit"><div class="si ${tone}">${icon}</div><div><div class="sv">${value}</div><div class="sl">${label}</div></div></a>`;
    setHTML(el, h`
      <div class="page-head"><div><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${state.user.name.split(' ')[0]}</h1>
        <div class="muted">Here is what is happening across the hospital today.</div></div>
        <div class="actions">${can('receptionist') ? h`<a class="btn btn-primary" href="#/checkin">+ Check-in patient</a>` : ''}<a class="btn" href="#/flow">Open live flow</a></div></div>
      <div class="grid g4" style="margin-bottom:16px">
        ${stat('🧑‍🤝‍🧑', 't-teal', d.flow.checked_in, `Patients today · ${d.flow.completed} completed`, 'flow')}
        ${stat('📅', 't-blue', d.appointments.total, `Appointments today · ${d.appointments.web} online`, 'appointments')}
        ${stat('🧪', 't-purple', d.lab.pending + d.lab.processing, `Lab orders open · ${d.lab.done} done today`, 'lab')}
        ${stat('💊', 't-amber', d.pharmacy.pending, `Prescriptions waiting · ${d.pharmacy.done} dispensed`, 'pharmacy')}
        ${f ? h`${stat('💵', 't-green', money(f.today), 'Collected today', 'billing')}
          ${stat('📈', 't-teal', money(f.month_income - f.month_expense), `Net this month · ${money(f.month_income)} in`, 'reports')}
          ${stat('🧾', 't-red', money(f.outstanding), `Outstanding · ${f.outstanding_count} invoices`, 'billing')}` : ''}
        ${stat('⚠️', 't-red', d.pharmacy.low_stock + d.pharmacy.expiring, `Stock alerts · ${d.pharmacy.low_stock} low, ${d.pharmacy.expiring} expiring`, 'medicines')}
        ${!f ? h`${stat('🆕', 't-blue', d.patients.today, `New patients today · ${d.patients.total} total`, 'patients')}` : ''}
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Care Circle</h2><span class="muted small">Live position of every patient in the care cycle · click a stage to open it</span></div>
        <div class="card-b circle-wrap">${careCircle(d.flow)}
          <div><div class="legend-list">${CIRCLE_NODES.map((n) => h`<div class="legend-item" data-link="${n.link}"><span class="sw" style="background:${n.color}"></span>${n.label}<span class="lv" style="color:${n.color}">${d.flow[n.key] ?? '–'}</span></div>`)}</div>
          <p class="muted small" style="margin-top:14px">Appointment → Check-in → Nurse triage → Doctor consultation → Lab investigation → Results back to doctor → Prescription → Pharmacy → Billing → Completed.</p></div></div></div>
      <div class="grid ${f ? 'g3' : 'g2'}" style="margin-bottom:16px">
        <div class="card"><div class="card-h"><h3>Patient visits · last 14 days</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="c-visits"></canvas></div></div></div>
        ${f ? h`<div class="card"><div class="card-h"><h3>Income vs expenses · 14 days</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="c-rev"></canvas></div></div></div>` : ''}
        <div class="card"><div class="card-h"><h3>Visits by department · 30 days</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="c-dept"></canvas></div></div></div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Today's appointments</h3><div class="actions"><a class="btn btn-sm" href="#/appointments">View all</a></div></div>
          <div class="card-b">${d.today_appointments.length ? d.today_appointments.map((a) => h`<div class="list-row"><b class="mono">${a.time}</b><div><div>${a.patient_name}</div><div class="small muted">${a.doctor_name || ''}</div></div>
            <div style="margin-left:auto" class="row">${a.source === 'web' ? badge('web', 'Online') : ''}${badge(a.status)}</div></div>`) : emptyState('No appointments today')}</div></div>
        <div class="card"><div class="card-h"><h3>Latest lab results</h3></div>
          <div class="card-b">${d.recent_lab.length ? d.recent_lab.map((o) => h`<div class="list-row"><span class="mono small">${o.order_no}</span><div>${o.patient_name}</div>
            <div style="margin-left:auto" class="row">${Number(o.abnormal) ? badge('abnormal', `${o.abnormal} abnormal`) : badge('normal', 'Normal')}<span class="small muted">${fmtTime(o.completed_at)}</span></div></div>`) : emptyState('No results yet')}</div></div>
      </div>`);
    bindCircle(el);
    const days = lastDays(14);
    const vmap = Object.fromEntries(d.visits_14d.map((x) => [x.d, x.n]));
    chart($('#c-visits'), { type: 'line', data: { labels: days.map(shortDay), datasets: [{ label: 'Visits', data: days.map((x) => vmap[x] || 0), borderColor: '#13a3a0', backgroundColor: 'rgba(19,163,160,.12)', fill: true, tension: .35, pointRadius: 3 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    if (f) {
      const r = Object.fromEntries(f.revenue_14d.map((x) => [x.d, x]));
      chart($('#c-rev'), { type: 'bar', data: { labels: days.map(shortDay), datasets: [
        { label: 'Income', data: days.map((x) => (r[x] ? r[x].income : 0)), backgroundColor: '#15935b', borderRadius: 4 },
        { label: 'Expenses', data: days.map((x) => (r[x] ? r[x].expense : 0)), backgroundColor: '#f87171', borderRadius: 4 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
    }
    chart($('#c-dept'), { type: 'doughnut', data: { labels: d.departments.map((x) => x.name), datasets: [{ data: d.departments.map((x) => x.n),
      backgroundColor: ['#0e7c86', '#4f46e5', '#f59e0b', '#db2777', '#15935b', '#2563eb', '#7c3aed', '#ea580c'] }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } } });
  };
  await load();
  ctx.every(30000, () => load().catch(() => {}));
}

/* ---------- Live flow board ---------- */
const COLS = [
  { key: 'triage', label: 'Waiting triage', statuses: ['waiting_triage'], color: '#d98e04' },
  { key: 'doctor', label: 'Doctor', statuses: ['waiting_doctor', 'in_consultation'], color: '#2563eb' },
  { key: 'lab', label: 'Laboratory', statuses: ['waiting_lab'], color: '#7c3aed' },
  { key: 'results', label: 'Results → Doctor', statuses: ['results_ready'], color: '#dc3545' },
  { key: 'pharmacy', label: 'Pharmacy', statuses: ['waiting_pharmacy'], color: '#db2777' },
  { key: 'done', label: 'Completed', statuses: ['completed'], color: '#15935b' },
];
async function renderFlow(el, params, ctx) {
  setHTML(el, h`<div class="page-head"><div><h1>Patient Flow Circle</h1><div class="muted">Every patient checked in today and where they are in the care cycle. Updates automatically.</div></div>
    <div class="actions"><a class="btn" href="/display/" target="_blank">📺 Queue display</a></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-b circle-wrap" id="flow-circle"></div></div>
    <div class="kanban" id="kanban"></div>`);
  const load = async () => {
    const [d, visits] = await Promise.all([GET('/dashboard'), GET('/visits')]);
    setHTML($('#flow-circle'), h`${careCircle(d.flow)}<div><h3 style="margin-bottom:10px">Average time in the circle</h3>
      ${(() => {
        const done = visits.filter((v) => v.status === 'completed');
        const avg = done.length ? Math.round(done.reduce((s, v) => s + v.minutes_in, 0) / done.length) : 0;
        const waiting = visits.filter((v) => !['completed', 'cancelled'].includes(v.status));
        const longest = [...waiting].sort((a, b) => b.minutes_in - a.minutes_in)[0];
        return h`<div class="grid g2"><div class="card stat"><div class="si t-teal">⏱</div><div><div class="sv">${mins(avg)}</div><div class="sl">Avg. completed visit</div></div></div>
          <div class="card stat"><div class="si t-red">⌛</div><div><div class="sv">${longest ? mins(longest.minutes_in) : '–'}</div><div class="sl">Longest waiting ${longest ? '· ' + longest.patient_name : ''}</div></div></div></div>`;
      })()}
      <div class="legend-list" style="margin-top:12px">${CIRCLE_NODES.map((n) => h`<div class="legend-item" data-link="${n.link}"><span class="sw" style="background:${n.color}"></span>${n.label}<span class="lv" style="color:${n.color}">${d.flow[n.key] ?? '–'}</span></div>`)}</div></div>`);
    bindCircle($('#flow-circle'));
    setHTML($('#kanban'), h`${COLS.map((c) => {
      const items = visits.filter((v) => c.statuses.includes(v.status));
      return h`<div class="kcol"><div class="kcol-h"><span class="dot" style="color:${c.color}"></span>${c.label}<span class="n">${items.length}</span></div>
        <div class="kcol-b">${items.length ? items.map((v) => h`<div class="kcard ${v.priority}" data-id="${v.id}">
          <div class="row" style="justify-content:space-between"><span class="token ${v.priority}">${v.token_no}</span><span class="small muted">⏱ ${mins(v.minutes_in)}</span></div>
          <div class="kn" style="margin-top:6px">${v.patient_name}</div><div class="km">${v.doctor_name}</div>
          <div class="row" style="margin-top:6px">${badge(v.status)}${v.priority !== 'normal' ? badge(v.priority) : ''}</div></div>`) : h`<div class="small muted" style="padding:10px;text-align:center">Empty</div>`}</div></div>`;
    })}`);
    $$('.kcard', el).forEach((k) => k.onclick = () => { location.hash = '#/visit/' + k.dataset.id; });
  };
  await load();
  ctx.every(10000, () => load().catch(() => {}));
}

export default {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  flow: { title: 'Patient Flow Circle', render: renderFlow },
};
