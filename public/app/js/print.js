import { h, raw, state, money, fmtDate, fmtDT, cap, GET, fail } from './core.js';

const CSS = `
*{box-sizing:border-box} body{font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:0;padding:28px;font-size:13px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e7c86;padding-bottom:12px;margin-bottom:16px}
.hd h1{margin:0;font-size:22px;color:#0e7c86}.hd .meta{text-align:right;font-size:12px;color:#444}
h2{font-size:16px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left}
th{background:#f1f5f9;font-size:11px;text-transform:uppercase}.r{text-align:right}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.grid b{display:inline-block;min-width:110px;color:#555;font-weight:600}
.tot td{font-weight:700;border-top:2px solid #111}.flag{color:#c00;font-weight:700}.foot{margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#555}
.sig{border-top:1px solid #111;padding-top:4px;width:200px;text-align:center}.rx{font-size:40px;font-family:serif;color:#0e7c86;margin:0 0 4px}
.slip{width:280px;margin:auto;text-align:center;border:2px dashed #0e7c86;padding:18px;border-radius:10px}.slip .tk{font-size:64px;font-weight:800;margin:6px 0}
.stamp{display:inline-block;border:2px solid #15935b;color:#15935b;padding:3px 12px;border-radius:6px;font-weight:800;transform:rotate(-6deg)}
@media print{body{padding:10px}.noprint{display:none}}`;

function header(title) {
  const s = state.settings;
  return h`<div class="hd"><div><h1>${s.hospital_name || 'Hospital'}</h1><div>${s.address || ''}</div><div>${s.phone || ''} ${s.email ? '· ' + s.email : ''}</div></div>
    <div class="meta"><h2>${title}</h2>Printed ${fmtDT(new Date().toISOString())}<br>By ${state.user ? state.user.name : ''}</div></div>`;
}

export function printDoc(title, body) {
  const w = window.open('', '_blank', 'width=860,height=900');
  if (!w) { fail(new Error('Allow pop-ups to print')); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '')}</title><style>${CSS}</style></head><body>
    <div class="noprint" style="text-align:right;margin-bottom:10px"><button onclick="window.print()">Print</button></div>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 350);
}

export function printToken(v) {
  const s = state.settings;
  printDoc('Queue Token', String(h`<div class="slip"><b>${s.hospital_name || ''}</b><div>Queue Token</div><div class="tk">${v.token_no}</div>
    <div><b>${v.doctor_name || ''}</b></div><div>${v.department || ''} ${v.doctor_room ? '· Room ' + v.doctor_room : ''}</div>
    <div style="margin-top:8px">${v.patient_name || ''} (${v.mrn || ''})</div><div>${v.visit_no || ''}</div><div style="margin-top:8px;font-size:11px">${fmtDT(v.checked_in_at || new Date().toISOString())}</div>
    <div style="margin-top:8px;font-size:11px">Please wait for your token on the display screen.</div></div>`));
}

function patientGrid(p, extra = '') {
  return h`<div class="grid"><div><b>Patient</b>${p.first_name ? p.first_name + ' ' + p.last_name : p.patient_name}</div><div><b>MRN</b>${p.mrn || ''}</div>
    <div><b>Age / Gender</b>${p.age ?? '-'} / ${cap(p.gender || '-')}</div><div><b>Phone</b>${p.phone || ''}</div>${extra}</div>`;
}

export async function printPrescription(visitId, rxId) {
  try {
    const d = await GET(`/visits/${visitId}`);
    const rx = d.prescriptions.find((x) => x.id === rxId) || d.prescriptions[d.prescriptions.length - 1];
    if (!rx) throw new Error('No prescription on this visit');
    printDoc('Prescription', String(h`${header('Prescription')}${patientGrid(d.patient, h`<div><b>Rx No</b>${rx.rx_no}</div><div><b>Date</b>${fmtDate(rx.created_at)}</div>
      <div><b>Diagnosis</b>${d.visit.diagnosis || '-'}</div><div><b>Allergies</b>${d.patient.allergies || 'None known'}</div>`)}
      <div class="rx">℞</div>
      <table><thead><tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th class="r">Qty</th><th>Instructions</th></tr></thead>
      <tbody>${rx.items.map((i, n) => h`<tr><td>${n + 1}</td><td><b>${i.name}</b> ${i.strength || ''} <small>${i.form || ''}</small></td><td>${i.dosage || ''}</td><td>${i.frequency || ''}</td><td>${i.duration || ''}</td><td class="r">${i.quantity}</td><td>${i.instructions || ''}</td></tr>`)}</tbody></table>
      ${rx.notes ? h`<p><b>Notes:</b> ${rx.notes}</p>` : ''}
      ${d.visit.follow_up_date ? h`<p><b>Follow-up:</b> ${fmtDate(d.visit.follow_up_date)}</p>` : ''}
      <div class="foot"><div>Status: ${cap(rx.status)}</div><div class="sig">${d.visit.doctor_name}<br>Signature</div></div>`));
  } catch (e) { fail(e); }
}

export async function printLabReport(orderId) {
  try {
    const o = await GET(`/lab/orders/${orderId}`);
    printDoc('Lab Report', String(h`${header('Laboratory Report')}${patientGrid(o, h`<div><b>Order No</b>${o.order_no}</div><div><b>Requested by</b>${o.doctor_name || '-'}</div>
      <div><b>Collected</b>${fmtDT(o.collected_at) || '-'}</div><div><b>Reported</b>${fmtDT(o.completed_at) || 'Pending'}</div>`)}
      ${o.clinical_notes ? h`<p><b>Clinical notes:</b> ${o.clinical_notes}</p>` : ''}
      <table><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th><th>Remarks</th></tr></thead>
      <tbody>${o.items.map((i) => h`<tr><td><b>${i.test_name}</b><br><small>${i.sample_type || ''}</small></td><td class="${i.result_flag && i.result_flag !== 'normal' ? 'flag' : ''}">${i.result_value || '—'}</td>
        <td>${i.unit || ''}</td><td>${i.normal_range || ''}</td><td class="${i.result_flag && i.result_flag !== 'normal' ? 'flag' : ''}">${cap(i.result_flag || '')}</td><td>${i.remarks || ''}</td></tr>`)}</tbody></table>
      <div class="foot"><div>Status: ${cap(o.status)}</div><div class="sig">${o.technician || 'Lab Technician'}<br>Verified by</div></div>`));
  } catch (e) { fail(e); }
}

export async function printInvoice(invoiceId, { receipt = false } = {}) {
  try {
    const i = await GET(`/finance/invoices/${invoiceId}`);
    const title = receipt ? 'Payment Receipt' : 'Invoice';
    printDoc(title, String(h`${header(title)}
      <div class="grid"><div><b>Invoice No</b>${i.invoice_no}</div><div><b>Date</b>${fmtDT(i.created_at)}</div>
      <div><b>Bill to</b>${i.patient_name || 'Walk-in'}</div><div><b>MRN</b>${i.mrn || '-'}</div>
      ${i.visit_no ? h`<div><b>Visit</b>${i.visit_no}</div><div><b>Doctor</b>${i.doctor_name || ''}</div>` : ''}
      ${i.insurance_provider ? h`<div><b>Insurance</b>${i.insurance_provider} ${i.insurance_no || ''}</div>` : ''}</div>
      <table><thead><tr><th>#</th><th>Description</th><th>Type</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
      <tbody>${i.items.map((it, n) => h`<tr><td>${n + 1}</td><td>${it.description}</td><td>${cap(it.item_type)}</td><td class="r">${Number(it.quantity)}</td><td class="r">${money(it.unit_price)}</td><td class="r">${money(it.amount)}</td></tr>`)}
      <tr><td colspan="5" class="r">Subtotal</td><td class="r">${money(i.subtotal)}</td></tr>
      ${i.discount > 0 ? h`<tr><td colspan="5" class="r">Discount</td><td class="r">-${money(i.discount)}</td></tr>` : ''}
      <tr class="tot"><td colspan="5" class="r">Total</td><td class="r">${money(i.total)}</td></tr>
      <tr><td colspan="5" class="r">Paid</td><td class="r">${money(i.amount_paid)}</td></tr>
      <tr class="tot"><td colspan="5" class="r">Balance due</td><td class="r">${money(i.total - i.amount_paid)}</td></tr></tbody></table>
      ${i.payments.length ? h`<h2 style="margin-top:18px">Payments</h2><table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Reference</th><th>Received by</th><th class="r">Amount</th></tr></thead>
        <tbody>${i.payments.map((p) => h`<tr><td>${p.payment_no}</td><td>${fmtDT(p.created_at)}</td><td>${cap(p.method)}</td><td>${p.reference || ''}</td><td>${p.received_by_name || ''}</td><td class="r">${money(p.amount)}</td></tr>`)}</tbody></table>` : ''}
      <div class="foot"><div>${i.status === 'paid' ? raw('<span class="stamp">PAID</span>') : 'Status: ' + cap(i.status)}</div><div class="sig">Cashier</div></div>
      <p style="text-align:center;margin-top:30px;color:#666">Thank you for choosing ${state.settings.hospital_name || 'us'}. Get well soon!</p>`));
  } catch (e) { fail(e); }
}
