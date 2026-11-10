import { h, raw, $, $$, setHTML, GET, POST, PUT, DEL, money, fmtDate, fmtDT, cap, badge, emptyState, today, toast, fail,
  openModal, confirmBox, field, selectField, areaField, options } from '../core.js';
import { printDoc } from '../print.js';

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const TYPE_LABEL = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const TYPE_TONE = { asset: 'blue', liability: 'amber', equity: 'purple', income: 'green', expense: 'red' };
const SOURCE_LABEL = { manual: 'Manual', invoice: 'Invoice', payment: 'Payment', expense: 'Expense', purchase: 'Purchase', stock: 'Stock', transfer: 'Transfer',
  supplier_payment: 'Supplier payment', opening: 'Opening', reversal: 'Reversal' };
const typeBadge = (t) => h`<span class="badge b-${TYPE_TONE[t]}">${cap(t)}</span>`;
const amt = (n) => (Number(n) ? money(n) : h`<span class="muted">—</span>`);

/* ---------- Shared helpers (also used by finance & pharmacy pages) ---------- */
let moneyCache = null;
export async function moneyAccounts(force = false) {
  if (!moneyCache || force) moneyCache = await GET('/accounting/money-accounts');
  return moneyCache;
}
// <select name="payment"> with money accounts + optional credit / no-payment choices.
export async function paymentSelect({ name = 'payment', label = 'Payment', credit = true, none = true, selected = '' } = {}) {
  const accts = await moneyAccounts();
  const def = selected || (accts.find((a) => a.system_key === 'cash') ? `acct:${accts.find((a) => a.system_key === 'cash').id}` : '');
  return h`<div class="field"><label>${label}</label><select name="${name}">
    <optgroup label="Paid now from">${accts.map((a) => h`<option value="acct:${a.id}" ${def === `acct:${a.id}` ? raw('selected') : ''}>${a.name}</option>`)}</optgroup>
    ${credit || none ? h`<optgroup label="Not paid now">${credit ? h`<option value="credit">On credit (we owe the supplier)</option>` : ''}${none ? h`<option value="none">Opening stock / donation (no payment)</option>` : ''}</optgroup>` : ''}
  </select></div>`;
}
function accountSelect(accounts, name, selected = '', { filter = () => true, empty = 'Select account' } = {}) {
  const list = accounts.filter((a) => !a.is_group && a.active && filter(a));
  return h`<select name="${name}"><option value="">${empty}</option>${TYPES.map((t) => {
    const items = list.filter((a) => a.type === t);
    return items.length ? h`<optgroup label="${TYPE_LABEL[t]}">${items.map((a) => h`<option value="${a.id}" ${String(a.id) === String(selected) ? raw('selected') : ''}>${a.code} · ${a.name}</option>`)}</optgroup>` : '';
  })}</select>`;
}
const depthOf = (a, byId) => { let d = 0, p = a.parent_id && byId.get(a.parent_id); const seen = new Set(); while (p && !seen.has(p.id)) { seen.add(p.id); d++; p = p.parent_id && byId.get(p.parent_id); } return d; };
function ordered(accounts) {
  const byParent = new Map();
  for (const a of accounts) { const k = a.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(a); }
  const ids = new Set(accounts.map((a) => a.id));
  const out = [];
  const walk = (pid) => (byParent.get(pid) || []).sort((x, y) => x.code.localeCompare(y.code)).forEach((a) => { out.push(a); walk(a.id); });
  walk(0);
  accounts.filter((a) => a.parent_id && !ids.has(a.parent_id)).forEach((a) => { if (!out.includes(a)) { out.push(a); walk(a.id); } });
  return out;
}

/* ---------- Quick action modals ---------- */
export async function transferModal(onDone) {
  const accts = await moneyAccounts(true);
  openModal({
    title: 'Transfer between accounts', submit: 'Transfer',
    body: h`<p class="muted small" style="margin-top:0">Move money between cash, bank and mobile-money accounts (e.g. deposit the day's cash to the bank).</p>
      <div class="form-grid">${selectField('From', 'from_account_id', options(accts, '', { empty: 'Select', label: (a) => a.name }), { required: true })}
      ${selectField('To', 'to_account_id', options(accts, '', { empty: 'Select', label: (a) => a.name }), { required: true })}
      ${field('Amount', 'amount', { type: 'number', required: true, attrs: 'step="0.01" min="0.01"' })}${field('Date', 'date', { type: 'date', value: today(), required: true })}
      ${field('Reference', 'reference', { placeholder: 'Deposit slip no.' })}${field('Memo', 'memo', {})}</div>`,
    onSubmit: async (d, f, close) => { const r = await POST('/accounting/transfer', d); toast(`Transfer posted · ${r.entry_no}`); close(); onDone && onDone(); },
  });
}
export async function supplierPaymentModal(onDone, supplierId = '') {
  const [accts, pay] = await Promise.all([moneyAccounts(true), GET('/accounting/payables')]);
  openModal({
    title: 'Pay a supplier', submit: 'Record payment', submitClass: 'btn-success',
    body: h`<div class="form-grid">${selectField('Supplier', 'supplier_id', options(pay.rows, supplierId, { empty: 'Select supplier', label: (s) => `${s.name} · owe ${money(s.balance)}` }), { required: true, cls: 'span-all' })}
      ${selectField('Pay from', 'account_id', options(accts, accts.find((a) => a.system_key === 'bank') ? accts.find((a) => a.system_key === 'bank').id : '', { label: (a) => a.name }), { required: true })}
      ${field('Amount', 'amount', { type: 'number', required: true, attrs: 'step="0.01" min="0.01"' })}${field('Date', 'date', { type: 'date', value: today(), required: true })}
      ${field('Reference', 'reference', { placeholder: 'Cheque / transfer ref' })}${field('Memo', 'memo', { cls: 'span-all' })}</div>`,
    onSubmit: async (d, f, close) => { const r = await POST('/accounting/supplier-payment', d); toast(`Supplier paid · ${r.entry_no}`); close(); onDone && onDone(); },
  });
}
export async function journalModal(onDone) {
  const accounts = await GET('/accounting/accounts');
  const line = () => h`<tr class="jl"><td style="min-width:260px">${accountSelect(accounts, 'account_id')}</td>
    <td><input class="input" type="number" step="0.01" min="0" name="debit" placeholder="0.00"></td>
    <td><input class="input" type="number" step="0.01" min="0" name="credit" placeholder="0.00"></td>
    <td><input class="input" name="memo"></td><td><button type="button" class="btn btn-xs btn-ghost" data-del>✕</button></td></tr>`;
  const m = openModal({
    title: 'New journal entry', size: 'xl', submit: 'Post journal',
    body: h`<div class="form-grid c3">${field('Date', 'entry_date', { type: 'date', value: today(), required: true })}${field('Description', 'description', { required: true, placeholder: 'e.g. Owner capital, loan received, depreciation' })}
      ${field('Reference', 'reference', {})}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Account</th><th style="width:140px">Debit</th><th style="width:140px">Credit</th><th>Memo</th><th></th></tr></thead>
      <tbody id="jl-rows">${line()}${line()}</tbody>
      <tfoot><tr><td class="right"><button type="button" class="btn btn-sm" id="jl-add" style="float:left">+ Add line</button><b>Totals</b></td><td><b id="jl-dr">0.00</b></td><td><b id="jl-cr">0.00</b></td><td colspan="2" id="jl-diff"></td></tr></tfoot></table></div>
      <p class="small muted">Debits must equal credits. Assets & expenses increase with a debit; liabilities, equity & income increase with a credit.</p>`,
    onSubmit: async (d, f, close) => {
      const lines = $$('.jl', f).map((tr) => ({ account_id: $('[name=account_id]', tr).value, debit: $('[name=debit]', tr).value, credit: $('[name=credit]', tr).value, memo: $('[name=memo]', tr).value }))
        .filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)));
      const r = await POST('/accounting/journals', { entry_date: d.entry_date, description: d.description, reference: d.reference, lines });
      toast(`Journal posted · ${r.entry_no}`); close(); onDone && onDone();
    },
  });
  const tbody = $('#jl-rows', m.el), btn = $('button[type=submit]', m.el);
  const calc = () => {
    const dr = $$('[name=debit]', tbody).reduce((s, i) => s + (Number(i.value) || 0), 0), cr = $$('[name=credit]', tbody).reduce((s, i) => s + (Number(i.value) || 0), 0);
    $('#jl-dr', m.el).textContent = dr.toFixed(2); $('#jl-cr', m.el).textContent = cr.toFixed(2);
    const diff = Math.round((dr - cr) * 100) / 100;
    $('#jl-diff', m.el).innerHTML = diff === 0 && dr > 0 ? '<span class="badge b-green">Balanced</span>' : `<span class="badge b-red">Difference ${Math.abs(diff).toFixed(2)}</span>`;
    btn.disabled = !(diff === 0 && dr > 0);
  };
  const wire = () => $$('.jl', tbody).forEach((tr) => {
    $('[data-del]', tr).onclick = () => { if ($$('.jl', tbody).length > 2) { tr.remove(); calc(); } };
    const d = $('[name=debit]', tr), c = $('[name=credit]', tr);
    d.oninput = () => { if (d.value) c.value = ''; calc(); };
    c.oninput = () => { if (c.value) d.value = ''; calc(); };
  });
  $('#jl-add', m.el).onclick = () => { tbody.insertAdjacentHTML('beforeend', String(line())); wire(); };
  wire(); calc();
}

/* ---------- Chart of accounts ---------- */
async function accountForm(accounts, a = {}, onDone, preset = {}) {
  const isNew = !a.id;
  const init = { ...preset, ...a };
  const m = openModal({
    title: isNew ? 'New account' : `Edit ${a.code} · ${a.name}`, size: 'wide', submit: 'Save account',
    body: h`<div class="form-grid">
      ${field('Account code', 'code', { value: init.code, required: true, placeholder: 'e.g. 1105' })}${field('Account name', 'name', { value: init.name, required: true, placeholder: 'e.g. Salaam Bank' })}
      ${selectField('Type', 'type', options(TYPES, init.type || 'asset', { label: (t) => t }), { required: true })}
      <div class="field"><label>Parent group</label><select name="parent_id"></select></div>
      <label class="check"><input type="checkbox" name="is_group" ${init.is_group ? raw('checked') : ''} ${a.system_key ? raw('disabled') : ''}> Group / header account (holds sub-accounts, no posting)</label>
      <label class="check cash-opt"><input type="checkbox" name="is_cash" ${init.is_cash ? raw('checked') : ''} ${a.system_key ? raw('disabled') : ''}> Cash / bank / mobile-money account (receives & pays money)</label>
      ${areaField('Description', 'description', init.description, { cls: 'span-all', rows: 2 })}
      ${isNew ? h`<div class="ob form-grid span-all" style="grid-column:1/-1">${field('Opening balance (optional)', 'opening_balance', { type: 'number', attrs: 'step="0.01"' })}${field('Opening date', 'opening_date', { type: 'date', value: today() })}</div>` : ''}
      ${!isNew ? h`<label class="check"><input type="checkbox" name="active" ${a.active ? raw('checked') : ''} ${a.system_key ? raw('disabled') : ''}> Active</label>` : ''}
      ${a.system_key ? h`<div class="small muted span-all">🔒 System account used by automatic posting. You can rename it and change its code, but not delete or deactivate it.</div>` : ''}
    </div>`,
    onSubmit: async (d, f, close) => {
      if (a.system_key) { delete d.is_group; delete d.is_cash; delete d.active; }
      if (isNew) await POST('/accounting/accounts', d); else await PUT(`/accounting/accounts/${a.id}`, d);
      toast('Account saved'); close(); onDone();
    },
  });
  const f = $('form', m.el);
  const sync = () => {
    const t = f.type.value;
    const groups = accounts.filter((x) => x.is_group && x.type === t && x.id !== a.id);
    const cur = f.parent_id.value || init.parent_id || '';
    setHTML(f.parent_id, options(groups, cur, { empty: '— Top level —', label: (g) => `${g.code} · ${g.name}` }));
    $('.cash-opt', m.el).classList.toggle('hidden', t !== 'asset' || f.is_group.checked);
    const ob = $('.ob', m.el); if (ob) ob.classList.toggle('hidden', f.is_group.checked);
  };
  f.type.onchange = () => { f.parent_id.value = ''; init.parent_id = ''; sync(); };
  f.is_group.onchange = sync;
  sync();
}

async function renderAccounts(el) {
  let filter = '', q = '', asOf = today();
  setHTML(el, h`<div class="page-head"><div><h1>Chart of Accounts</h1><div class="muted">Every financial event posts here automatically with double-entry bookkeeping.</div></div>
    <div class="actions"><button class="btn" id="q-tr">⇄ Transfer</button><button class="btn" id="q-sp">🚚 Pay supplier</button><button class="btn" id="q-je">📝 Journal entry</button><button class="btn btn-primary" id="new-a">+ New account</button></div></div>
    <div class="grid g4" id="ov" style="margin-bottom:16px"></div>
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Cash, bank & mobile money</h3><span class="small muted">Live balances</span></div><div class="card-b" id="money" style="display:flex;gap:12px;flex-wrap:wrap"></div></div>
    <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs" id="atabs"></div>
      <div class="filters" style="margin-bottom:12px"><div class="search"><input class="input" id="aq" placeholder="Search code or name"></div>
        <label class="small">Balance as of <input type="date" class="input" id="asof" value="${asOf}" style="width:auto;display:inline-block"></label></div></div>
      <div class="table-wrap" id="atable"></div></div>`);
  let accounts = [];
  const load = async () => {
    const [ov, list] = await Promise.all([GET('/accounting/overview'), GET(`/accounting/accounts?as_of=${asOf}`)]);
    accounts = list;
    const stat = (i, t, v, l, link) => h`<a class="card stat" ${link ? raw(`href="${link}"`) : ''} style="color:inherit;text-decoration:none"><div class="si ${t}">${i}</div><div><div class="sv">${v}</div><div class="sl">${l}</div></div></a>`;
    setHTML($('#ov'), h`${stat('🏦', 't-teal', money(ov.cash_total), 'Total cash & bank')}${stat('🧾', 't-blue', money(ov.receivable), 'Receivables (patients + insurance)', '#/statements/aging')}
      ${stat('🚚', 't-amber', money(ov.payable), 'Payables (owed to suppliers)', '#/statements/payables')}${stat('📈', ov.month_profit >= 0 ? 't-green' : 't-red', money(ov.month_profit), `Profit this month · ${money(ov.month_income)} income`, '#/statements/income')}`);
    setHTML($('#money'), ov.money.map((a) => h`<div class="vital" style="min-width:190px;cursor:pointer" data-ledger="${a.id}"><div class="vl">${a.code} · ${a.name}</div><div class="vv" style="color:${a.balance < 0 ? 'var(--danger)' : 'inherit'}">${money(a.balance)}</div></div>`));
    $$('[data-ledger]', $('#money')).forEach((x) => x.onclick = () => { location.hash = '#/ledger/' + x.dataset.ledger; });
    render();
  };
  const render = () => {
    setHTML($('#atabs'), h`<button data-f="" class="${!filter ? 'active' : ''}">All<span class="count">${accounts.filter((a) => !a.is_group).length}</span></button>
      ${TYPES.map((t) => h`<button data-f="${t}" class="${filter === t ? 'active' : ''}">${TYPE_LABEL[t]}<span class="count">${accounts.filter((a) => a.type === t && !a.is_group).length}</span></button>`)}`);
    $$('[data-f]', el).forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const ql = q.toLowerCase();
    const list = ordered(accounts).filter((a) => (!filter || a.type === filter) && (!ql || `${a.code} ${a.name}`.toLowerCase().includes(ql)));
    setHTML($('#atable'), list.length ? h`<table class="table"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Flags</th><th class="right">Debits</th><th class="right">Credits</th><th class="right">Balance</th><th></th></tr></thead><tbody>
      ${list.map((a) => {
        const d = ql ? 0 : depthOf(a, byId);
        return h`<tr style="${a.is_group ? 'background:var(--surface-2)' : ''}${!a.active ? ';opacity:.5' : ''}"><td class="mono ${a.is_group ? '' : 'small'}">${a.is_group ? h`<b>${a.code}</b>` : a.code}</td>
          <td><span style="padding-left:${d * 22}px">${a.is_group ? h`<b>📁 ${a.name}</b>` : a.name}</span>${a.description ? h`<div class="small muted" style="padding-left:${d * 22}px">${a.description}</div>` : ''}</td>
          <td>${typeBadge(a.type)}</td><td>${a.is_cash ? badge('confirmed', 'Cash/Bank') : ''} ${a.system_key ? h`<span class="badge b-gray" title="Used by automatic posting">🔒 System</span>` : ''} ${!a.active ? badge('inactive') : ''}</td>
          <td class="right small">${a.is_group ? '' : amt(a.dr)}</td><td class="right small">${a.is_group ? '' : amt(a.cr)}</td>
          <td class="right">${a.is_group ? h`<b>${money(a.balance)}</b>` : h`<span style="color:${a.balance < 0 ? 'var(--danger)' : 'inherit'}">${money(a.balance)}</span>`}</td>
          <td class="actions"><button class="btn btn-xs" data-l="${a.id}">Ledger</button>${a.is_group ? h`<button class="btn btn-xs" data-sub="${a.id}">+ Sub</button>` : ''}<button class="btn btn-xs" data-e="${a.id}">Edit</button>
            ${!a.system_key && !a.line_count && !accounts.some((x) => x.parent_id === a.id) ? h`<button class="btn btn-xs btn-ghost" data-del="${a.id}" title="Delete">🗑</button>` : ''}</td></tr>`;
      })}</tbody></table>` : emptyState('No accounts match'));
    $$('[data-l]', el).forEach((b) => b.onclick = () => { location.hash = '#/ledger/' + b.dataset.l; });
    $$('[data-e]', el).forEach((b) => b.onclick = () => accountForm(accounts, byId.get(Number(b.dataset.e)), load));
    $$('[data-sub]', el).forEach((b) => b.onclick = () => { const p = byId.get(Number(b.dataset.sub)); accountForm(accounts, {}, load, { type: p.type, parent_id: p.id }); });
    $$('[data-del]', el).forEach((b) => b.onclick = async () => {
      const a = byId.get(Number(b.dataset.del));
      if (!(await confirmBox(`Delete account ${a.code} · ${a.name}?`, { danger: true, ok: 'Delete' }))) return;
      try { await DEL(`/accounting/accounts/${a.id}`); toast('Account deleted'); load(); } catch (e) { fail(e); }
    });
  };
  $('#aq').oninput = (e) => { q = e.target.value; render(); };
  $('#asof').onchange = (e) => { asOf = e.target.value || today(); load().catch(fail); };
  $('#new-a').onclick = () => accountForm(accounts, {}, load, { type: filter || 'asset' });
  $('#q-tr').onclick = () => transferModal(load);
  $('#q-sp').onclick = () => supplierPaymentModal(load);
  $('#q-je').onclick = () => journalModal(load);
  await load();
}

/* ---------- Ledger ---------- */
async function renderLedger(el, [id]) {
  let from = `${today().slice(0, 4)}-01-01`, to = today();
  const load = async () => {
    const d = await GET(`/accounting/accounts/${id}/ledger?from=${from}&to=${to}`);
    const a = d.account;
    setHTML(el, h`<div class="page-head"><a href="#/accounts" class="btn btn-sm">‹ Chart of accounts</a><h1>${a.code} · ${a.name}</h1>${typeBadge(a.type)}${a.is_group ? badge('confirmed', 'Group — includes sub-accounts') : ''}
      <div class="actions filters"><input type="date" class="input" id="lf" value="${from}"><input type="date" class="input" id="lt" value="${to}"><button class="btn" id="lprint">🖨 Print</button><button class="btn" id="lcsv">⬇ CSV</button></div></div>
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card stat"><div class="si t-blue">⏮</div><div><div class="sv">${money(d.opening)}</div><div class="sl">Opening balance · ${fmtDate(d.from)}</div></div></div>
        <div class="card stat"><div class="si t-green">＋</div><div><div class="sv">${money(d.total_debit)}</div><div class="sl">Total debits</div></div></div>
        <div class="card stat"><div class="si t-red">－</div><div><div class="sv">${money(d.total_credit)}</div><div class="sl">Total credits</div></div></div>
        <div class="card stat"><div class="si t-teal">⏭</div><div><div class="sv">${money(d.closing)}</div><div class="sl">Closing balance · ${fmtDate(d.to)}</div></div></div></div>
      <div class="card table-wrap" id="ledger-table">${d.lines.length ? h`<table class="table"><thead><tr><th>Date</th><th>Entry</th><th>Description</th>${a.is_group ? h`<th>Account</th>` : ''}<th>Reference</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead><tbody>
        <tr style="background:var(--surface-2)"><td colspan="${a.is_group ? 5 : 4}"><b>Opening balance</b></td><td></td><td></td><td class="right"><b>${money(d.opening)}</b></td></tr>
        ${d.lines.map((l) => h`<tr><td class="nowrap">${fmtDate(l.entry_date)}</td><td class="mono small">${l.entry_no}</td><td>${l.description || ''}${l.memo ? h`<div class="small muted">${l.memo}</div>` : ''}${l.supplier ? h`<div class="small muted">Supplier: ${l.supplier}</div>` : ''}
          <div>${badge('confirmed', SOURCE_LABEL[l.source] || l.source)}${l.status === 'reversed' ? badge('cancelled', 'Reversed') : ''}</div></td>${a.is_group ? h`<td class="small">${l.account_code} · ${l.account_name}</td>` : ''}
          <td class="mono small">${l.reference || ''}</td><td class="right">${amt(l.debit)}</td><td class="right">${amt(l.credit)}</td><td class="right"><b>${money(l.balance)}</b></td></tr>`)}
        <tr style="background:var(--surface-2)"><td colspan="${a.is_group ? 5 : 4}"><b>Closing balance</b></td><td class="right"><b>${money(d.total_debit)}</b></td><td class="right"><b>${money(d.total_credit)}</b></td><td class="right"><b>${money(d.closing)}</b></td></tr>
        </tbody></table>` : emptyState('No transactions in this period', '📒')}</div>`);
    $('#lf').onchange = (e) => { from = e.target.value; load().catch(fail); };
    $('#lt').onchange = (e) => { to = e.target.value; load().catch(fail); };
    $('#lprint').onclick = () => printDoc(`Ledger ${a.code}`, `<h2>General Ledger: ${a.code} · ${a.name.replace(/</g, '&lt;')}</h2><p>${fmtDate(d.from)} – ${fmtDate(d.to)}</p>${$('#ledger-table').innerHTML}`);
    $('#lcsv').onclick = () => csv(`ledger_${a.code}_${from}_${to}.csv`, ['entry_date', 'entry_no', 'description', 'reference', 'debit', 'credit', 'balance'], d.lines);
  };
  await load();
}

function csv(filename, cols, rows) {
  const text = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = filename; a.click();
}

/* ---------- Journals ---------- */
async function renderJournals(el) {
  setHTML(el, h`<div class="page-head"><div><h1>Journal Entries</h1><div class="muted">The book of original entry. Automatic entries come from invoices, payments, stock and expenses.</div></div>
    <div class="actions"><button class="btn" id="q-tr">⇄ Transfer</button><button class="btn" id="q-sp">🚚 Pay supplier</button><button class="btn btn-primary" id="q-je">📝 New journal</button></div></div>
    <div class="card"><div class="card-h filters"><input type="date" class="input" id="jf" value="${today(-6)}"><input type="date" class="input" id="jt" value="${today()}">
      <select id="js">${options([{ id: '', name: 'All sources' }, ...Object.entries(SOURCE_LABEL).map(([id, name]) => ({ id, name }))], '')}</select>
      <div class="search"><input class="input" id="jq" placeholder="Description, reference or entry no"></div><span class="muted small" id="jcount" style="margin-left:auto"></span></div>
      <div class="table-wrap" id="jtable"></div></div>`);
  const load = async () => {
    const rows = await GET(`/accounting/journals?from=${$('#jf').value}&to=${$('#jt').value}&source=${$('#js').value}&q=${encodeURIComponent($('#jq').value)}`);
    $('#jcount').textContent = `${rows.length} entries · ${money(rows.reduce((s, e) => s + Number(e.amount || 0), 0))}`;
    setHTML($('#jtable'), rows.length ? h`<table class="table"><thead><tr><th>Entry</th><th>Date</th><th>Description</th><th>Lines</th><th>Source</th><th class="right">Amount</th><th></th></tr></thead><tbody>
      ${rows.map((e) => h`<tr><td class="mono small">${e.entry_no}${e.status === 'reversed' ? h`<div>${badge('cancelled', 'Reversed')}</div>` : ''}</td><td class="nowrap">${fmtDate(e.entry_date)}</td>
        <td>${e.description || ''}${e.reference ? h`<div class="small muted">Ref: ${e.reference}</div>` : ''}<div class="small muted">${e.created_by_name ? 'by ' + e.created_by_name : ''}</div></td>
        <td class="small" style="min-width:300px">${(e.lines || []).map((l) => h`<div class="row" style="gap:6px;flex-wrap:nowrap"><span style="${l.credit > 0 ? 'padding-left:18px' : ''}">${l.code} ${l.name}</span>
          <span style="margin-left:auto" class="${l.debit > 0 ? '' : 'muted'}">${l.debit > 0 ? 'Dr ' + money(l.debit) : 'Cr ' + money(l.credit)}</span></div>`)}</td>
        <td>${badge('confirmed', SOURCE_LABEL[e.source] || e.source)}</td><td class="right"><b>${money(e.amount)}</b></td>
        <td class="actions">${['manual', 'transfer', 'opening'].includes(e.source) && e.status === 'posted' ? h`<button class="btn btn-xs" data-rev="${e.id}">Reverse</button>` : ''}</td></tr>`)}</tbody></table>` : emptyState('No journal entries for this filter', '📝'));
    $$('[data-rev]', el).forEach((b) => b.onclick = async () => {
      if (!(await confirmBox('Post a reversing entry? The original stays in the books, and the reversal cancels its effect.', { ok: 'Reverse entry' }))) return;
      try { const r = await POST(`/accounting/journals/${b.dataset.rev}/reverse`, {}); toast(`Reversed · ${r.entry_no}`); load(); } catch (e) { fail(e); }
    });
  };
  ['#jf', '#jt', '#js'].forEach((s) => { $(s).onchange = () => load().catch(fail); });
  let t; $('#jq').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); };
  $('#q-tr').onclick = () => transferModal(load);
  $('#q-sp').onclick = () => supplierPaymentModal(load);
  $('#q-je').onclick = () => journalModal(load);
  await load();
}

/* ---------- Financial statements ---------- */
function stmtRows(nodes, depth = 0) {
  return nodes.filter((n) => n.balance || (n.children && n.children.length)).map((n) => h`
    <tr style="${n.is_group ? 'background:var(--surface-2)' : ''}"><td style="padding-left:${12 + depth * 22}px">${n.is_group ? h`<b>${n.name}</b>` : h`<a href="#/ledger/${n.id}">${n.code} · ${n.name}</a>`}</td>
      <td class="right">${n.is_group ? h`<b>${money(n.balance)}</b>` : money(n.balance)}</td></tr>${n.children ? stmtRows(n.children, depth + 1) : ''}`);
}
const section = (title, nodes, totalLabel, totalVal) => h`<tr><td colspan="2" style="padding-top:18px"><h3>${title}</h3></td></tr>${stmtRows(nodes)}
  <tr><td><b>${totalLabel}</b></td><td class="right" style="border-top:2px solid var(--text)"><b>${money(totalVal)}</b></td></tr>`;

async function renderStatements(el, params) {
  let tab = params[0] || 'income';
  const tabs = [['income', 'Income Statement (P&L)'], ['balance', 'Balance Sheet'], ['trial', 'Trial Balance'], ['aging', 'Receivables Aging'], ['payables', 'Supplier Payables']];
  setHTML(el, h`<div class="page-head"><div><h1>Financial Statements</h1><div class="muted">Generated live from the general ledger.</div></div>
    <div class="actions"><button class="btn" id="sprint">🖨 Print</button></div></div>
    <div class="card"><div class="card-b" style="padding-bottom:0"><div class="tabs">${tabs.map(([k, l]) => h`<button data-t="${k}">${l}</button>`)}</div>
      <div class="filters" id="sfil" style="margin-bottom:12px"></div></div><div class="card-b" id="sbody" style="padding-top:0"></div></div>`);
  const state = { from: `${today().slice(0, 7)}-01`, to: today(), asOf: today() };
  const filters = () => {
    if (tab === 'income') {
      setHTML($('#sfil'), h`<select id="sp">${options([{ id: 'm', name: 'This month' }, { id: 'lm', name: 'Last month' }, { id: 'y', name: 'This year' }, { id: 'c', name: 'Custom' }], 'm')}</select>
        <input type="date" class="input" id="sf" value="${state.from}"><input type="date" class="input" id="st" value="${state.to}">`);
      $('#sp').onchange = (e) => {
        const d = new Date();
        if (e.target.value === 'm') { state.from = `${today().slice(0, 7)}-01`; state.to = today(); }
        if (e.target.value === 'y') { state.from = `${d.getFullYear()}-01-01`; state.to = today(); }
        if (e.target.value === 'lm') { const s = new Date(d.getFullYear(), d.getMonth() - 1, 1), en = new Date(d.getFullYear(), d.getMonth(), 0);
          const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; state.from = f(s); state.to = f(en); }
        $('#sf').value = state.from; $('#st').value = state.to; load().catch(fail);
      };
      $('#sf').onchange = (e) => { state.from = e.target.value; load().catch(fail); };
      $('#st').onchange = (e) => { state.to = e.target.value; load().catch(fail); };
    } else if (tab === 'balance' || tab === 'trial') {
      setHTML($('#sfil'), h`<label class="small">As of <input type="date" class="input" id="sa" value="${state.asOf}" style="width:auto;display:inline-block"></label>`);
      $('#sa').onchange = (e) => { state.asOf = e.target.value; load().catch(fail); };
    } else if (tab === 'payables') {
      setHTML($('#sfil'), h`<button class="btn btn-sm btn-success" id="pay-sup">🚚 Pay supplier</button>`);
      $('#pay-sup').onclick = () => supplierPaymentModal(load);
    } else setHTML($('#sfil'), '');
  };
  const load = async () => {
    const body = $('#sbody');
    if (tab === 'income') {
      const d = await GET(`/accounting/income-statement?from=${state.from}&to=${state.to}`);
      setHTML(body, h`<div class="grid g4" style="margin-bottom:16px">
        <div class="card stat"><div class="si t-green">💵</div><div><div class="sv">${money(d.total_income)}</div><div class="sl">Net revenue</div></div></div>
        <div class="card stat"><div class="si t-amber">📦</div><div><div class="sv">${money(d.cost_of_sales)}</div><div class="sl">Cost of sales</div></div></div>
        <div class="card stat"><div class="si t-blue">📊</div><div><div class="sv">${money(d.gross_profit)}</div><div class="sl">Gross profit</div></div></div>
        <div class="card stat"><div class="si ${d.net_profit >= 0 ? 't-teal' : 't-red'}">${d.net_profit >= 0 ? '📈' : '📉'}</div><div><div class="sv">${money(d.net_profit)}</div><div class="sl">Net ${d.net_profit >= 0 ? 'profit' : 'loss'} · margin ${d.total_income ? Math.round((d.net_profit / d.total_income) * 100) : 0}%</div></div></div></div>
        <div id="stmt"><h2 style="text-align:center">Income Statement</h2><p class="muted" style="text-align:center">${fmtDate(d.from)} – ${fmtDate(d.to)}</p>
        <table class="table" style="max-width:760px;margin:auto"><tbody>${section('Income', d.income, 'Total income', d.total_income)}${section('Expenses', d.expenses, 'Total expenses', d.total_expense)}
          <tr><td style="padding-top:16px"><h3>Net ${d.net_profit >= 0 ? 'profit' : 'loss'}</h3></td><td class="right" style="padding-top:16px;border-bottom:4px double var(--text)"><h3 style="color:${d.net_profit >= 0 ? 'var(--success)' : 'var(--danger)'}">${money(d.net_profit)}</h3></td></tr></tbody></table></div>
        <p class="small muted" style="text-align:center">Discounts given appear as negative income. Cost of sales = medicines sold + supplies used + write-offs.</p>`);
    } else if (tab === 'balance') {
      const d = await GET(`/accounting/balance-sheet?as_of=${state.asOf}`);
      setHTML(body, h`<div id="stmt"><h2 style="text-align:center">Balance Sheet</h2><p class="muted" style="text-align:center">As of ${fmtDate(d.as_of)}</p>
        <div class="grid g2"><table class="table"><tbody>${section('Assets', d.assets, 'Total assets', d.total_assets)}</tbody></table>
        <table class="table"><tbody>${section('Liabilities', d.liabilities, 'Total liabilities', d.total_liabilities)}
          <tr><td colspan="2" style="padding-top:18px"><h3>Equity</h3></td></tr>${stmtRows(d.equity)}
          <tr><td style="padding-left:12px">Current period earnings (unclosed profit)</td><td class="right">${money(d.current_earnings)}</td></tr>
          <tr><td><b>Total equity</b></td><td class="right" style="border-top:2px solid var(--text)"><b>${money(d.total_equity)}</b></td></tr>
          <tr><td style="padding-top:16px"><b>Total liabilities + equity</b></td><td class="right" style="padding-top:16px;border-bottom:4px double var(--text)"><b>${money(d.total_liabilities + d.total_equity)}</b></td></tr></tbody></table></div>
        <p style="text-align:center">${Math.abs(d.difference) < 0.01 ? badge('paid', '✓ Balanced: Assets = Liabilities + Equity') : badge('cancelled', `Out of balance by ${money(d.difference)}`)}</p></div>`);
    } else if (tab === 'trial') {
      const d = await GET(`/accounting/trial-balance?as_of=${state.asOf}`);
      setHTML(body, h`<div id="stmt"><h2 style="text-align:center">Trial Balance</h2><p class="muted" style="text-align:center">As of ${fmtDate(d.as_of)}</p>
        <table class="table" style="max-width:860px;margin:auto"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead><tbody>
        ${d.rows.map((a) => h`<tr><td class="mono small">${a.code}</td><td><a href="#/ledger/${a.id}">${a.name}</a></td><td>${typeBadge(a.type)}</td><td class="right">${amt(a.debit)}</td><td class="right">${amt(a.credit)}</td></tr>`)}
        <tr><td colspan="3" class="right"><b>Totals</b></td><td class="right" style="border-top:2px solid var(--text)"><b>${money(d.total_debit)}</b></td><td class="right" style="border-top:2px solid var(--text)"><b>${money(d.total_credit)}</b></td></tr></tbody></table>
        <p style="text-align:center">${Math.abs(d.total_debit - d.total_credit) < 0.01 ? badge('paid', '✓ Debits equal credits') : badge('cancelled', 'Not balanced')}</p></div>`);
    } else if (tab === 'aging') {
      const d = await GET('/accounting/ar-aging');
      setHTML(body, h`<div class="grid g4" style="margin-bottom:16px">${Object.entries(d.buckets).map(([k, v]) => h`<div class="card stat"><div class="si ${k === '0-30' ? 't-green' : k === '90+' ? 't-red' : 't-amber'}">⏳</div><div><div class="sv">${money(v)}</div><div class="sl">${k} days</div></div></div>`)}</div>
        <div id="stmt"><div class="row" style="margin-bottom:8px"><h3>Unpaid patient invoices · ${money(d.total)}</h3><span class="muted small" style="margin-left:auto">Insurance receivable (claims to collect): <b>${money(d.insurance_receivable)}</b></span></div>
        ${d.rows.length ? h`<table class="table"><thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th>Phone</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th><th>Age</th></tr></thead><tbody>
          ${d.rows.map((x) => h`<tr><td class="mono small"><a href="#/billing/${x.id}">${x.invoice_no}</a></td><td>${fmtDate(x.created_at)}</td><td>${x.patient_name || ''}<div class="small muted">${x.mrn || ''} ${x.insurance_provider ? '· ' + x.insurance_provider : ''}</div></td>
            <td>${x.phone || ''}</td><td class="right">${money(x.total)}</td><td class="right">${money(x.amount_paid)}</td><td class="right"><b>${money(x.balance)}</b></td>
            <td>${badge(x.bucket === '0-30' ? 'paid' : x.bucket === '90+' ? 'cancelled' : 'pending', `${x.age} days`)}</td></tr>`)}</tbody></table>` : emptyState('No outstanding invoices 🎉')}</div>`);
    } else {
      const d = await GET('/accounting/payables');
      setHTML(body, h`<div id="stmt"><div class="row" style="margin-bottom:8px"><h3>Owed to suppliers · ${money(d.total)}</h3>${d.unassigned ? h`<span class="small muted" style="margin-left:auto">Not linked to a supplier: ${money(d.unassigned)}</span>` : ''}</div>
        <table class="table"><thead><tr><th>Supplier</th><th>Phone</th><th class="right">Purchased on credit</th><th class="right">Paid / returned</th><th class="right">Balance owed</th><th></th></tr></thead><tbody>
        ${d.rows.map((s) => h`<tr><td><b>${s.name}</b></td><td>${s.phone || ''}</td><td class="right">${money(s.purchased)}</td><td class="right">${money(s.paid)}</td>
          <td class="right"><b style="color:${s.balance > 0 ? 'var(--danger)' : 'inherit'}">${money(s.balance)}</b></td>
          <td class="actions"><button class="btn btn-xs" data-st="${s.id}">Statement</button>${s.balance > 0 ? h`<button class="btn btn-xs btn-success" data-pay="${s.id}">Pay</button>` : ''}</td></tr>`)}</tbody></table>
        <p class="small muted">Buy on credit from <b>Medicine Stock → Receive stock</b> or <b>General Inventory → In</b> using payment "On credit". Pay suppliers here.</p></div>`);
      $$('[data-pay]', body).forEach((b) => b.onclick = () => supplierPaymentModal(load, b.dataset.pay));
      $$('[data-st]', body).forEach((b) => b.onclick = async () => {
        const s = await GET(`/accounting/supplier/${b.dataset.st}/statement`);
        openModal({ title: `Statement · ${s.supplier.name}`, size: 'wide', body: s.lines.length ? h`<table class="table"><thead><tr><th>Date</th><th>Entry</th><th>Description</th><th class="right">Bills</th><th class="right">Payments</th><th class="right">Balance</th></tr></thead><tbody>
          ${s.lines.map((l) => h`<tr><td>${fmtDate(l.entry_date)}</td><td class="mono small">${l.entry_no}</td><td>${l.description}</td><td class="right">${amt(l.credit)}</td><td class="right">${amt(l.debit)}</td><td class="right"><b>${money(l.balance)}</b></td></tr>`)}</tbody></table>` : emptyState('No credit transactions with this supplier') });
      });
    }
  };
  const show = (k) => { tab = k; $$('[data-t]', el).forEach((b) => b.classList.toggle('active', b.dataset.t === k)); history.replaceState(null, '', `#/statements/${k}`); filters(); load().catch(fail); };
  $$('[data-t]', el).forEach((b) => b.onclick = () => show(b.dataset.t));
  $('#sprint').onclick = () => { const s = $('#stmt'); if (s) printDoc(tabs.find((t) => t[0] === tab)[1], s.innerHTML); };
  show(tab);
}

export default {
  accounts: { title: 'Chart of Accounts', render: renderAccounts },
  ledger: { title: 'General Ledger', render: renderLedger },
  journals: { title: 'Journal Entries', render: renderJournals },
  statements: { title: 'Financial Statements', render: renderStatements },
};
