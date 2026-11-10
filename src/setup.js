// DEMO / DEVELOPMENT setup: runs migrations, then fills an empty database with demo data.
//   npm run setup         -> migrate + seed demo data only when the database is empty
//   npm run reset         -> DROP the database and rebuild with demo data (destroys everything!)
// For a real hospital use:  npm run migrate  &&  npm run create-admin
require('dotenv').config();
const mysql = require('mysql2/promise');
const { migrate } = require('./migrate');
const bcrypt = require('bcryptjs');

const DB = process.env.DB_NAME || 'hospital_mgs';
if (!/^[A-Za-z0-9_]+$/.test(DB)) throw new Error('DB_NAME may only contain letters, digits and underscores');
const reset = process.argv.includes('--reset');

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pickOne = (arr) => arr[rnd(0, arr.length - 1)];
const no = (prefix, date, id) => `${prefix}${ymd(date).replace(/-/g, '').slice(2)}-${String(id).padStart(5, '0')}`;

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true, dateStrings: true,
  });
  if (reset) {
    if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) throw new Error('Refusing to reset in production (add --force if you really mean it)');
    await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``); console.log(`Dropped database ${DB}`);
  }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB}\``);
  const cq = async (sql, p) => (await conn.query(sql, p))[0];
  const c = { query: cq, one: async (sql, p) => (await cq(sql, p))[0] || null };
  const applied = await migrate(c);
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Schema up to date.');

  const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM users');
  const accounting = () => require('./services/accounting').ensure(c);
  if (n > 0) {
    await accounting();
    console.log('Data already present - skipping seed. Use "npm run reset" to rebuild.');
    await conn.end(); return;
  }

  const q = async (sql, p) => (await conn.query(sql, p))[0];
  const ins = async (table, row) => (await q(`INSERT INTO \`${table}\` SET ?`, [row])).insertId;

  /* Settings */
  const settings = {
    hospital_name: 'MediCircle Hospital', tagline: 'Complete care, full circle.', address: 'KM4 Street, Mogadishu',
    phone: '+252 61 000 0000', email: 'info@medicircle.local', currency: '$', slot_start: '08:00', slot_end: '17:00', slot_minutes: '30', expiry_alert_days: '90',
  };
  for (const [k, v] of Object.entries(settings)) await q('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, v]);

  /* Departments */
  const depts = [
    ['General Medicine', 'Primary care, diagnosis and treatment of common illnesses.', 'Block A', '🩺'],
    ['Pediatrics', 'Healthcare for infants, children and adolescents.', 'Block B', '🧸'],
    ['Cardiology', 'Heart and blood vessel care, ECG and hypertension clinics.', 'Block C', '❤️'],
    ['Obstetrics & Gynecology', 'Women\'s health, antenatal and maternity care.', 'Block D', '🤰'],
    ['Orthopedics', 'Bones, joints, fractures and sports injuries.', 'Block E', '🦴'],
    ['Dermatology', 'Skin, hair and nail conditions.', 'Block A', '🧴'],
    ['ENT', 'Ear, nose and throat care.', 'Block B', '👂'],
  ];
  const deptIds = {};
  for (const [name, description, room, icon] of depts) deptIds[name] = await ins('departments', { name, description, room, icon });

  /* Staff */
  const staffPw = await bcrypt.hash('Staff@123', 10);
  const adminPw = await bcrypt.hash('Admin@123', 10);
  await ins('users', { name: 'System Administrator', email: 'admin@hospital.com', password_hash: adminPw, role: 'admin', phone: '0610000001' });
  const staff = [
    { name: 'Amina Hassan', email: 'reception@hospital.com', role: 'receptionist', phone: '0610000002' },
    { name: 'Nurse Fadumo Ali', email: 'nurse@hospital.com', role: 'nurse', phone: '0610000003' },
    { name: 'Abdirahman Lab', email: 'lab@hospital.com', role: 'lab', phone: '0610000004' },
    { name: 'Hodan Pharmacist', email: 'pharmacy@hospital.com', role: 'pharmacist', phone: '0610000005' },
    { name: 'Mohamed Accounts', email: 'accounts@hospital.com', role: 'accountant', phone: '0610000006' },
  ];
  for (const s of staff) await ins('users', { ...s, password_hash: staffPw });
  const doctors = [
    { name: 'Dr. Ahmed Warsame', email: 'doctor@hospital.com', dept: 'General Medicine', specialization: 'General Physician', fee: 10, room: 'A-101', bio: '12 years in family and internal medicine.' },
    { name: 'Dr. Sahra Osman', email: 'sahra@hospital.com', dept: 'Pediatrics', specialization: 'Pediatrician', fee: 15, room: 'B-201', bio: 'Child health and immunization specialist.' },
    { name: 'Dr. Yusuf Abdi', email: 'yusuf@hospital.com', dept: 'Cardiology', specialization: 'Cardiologist', fee: 25, room: 'C-301', bio: 'Interventional cardiology and hypertension care.' },
    { name: 'Dr. Maryan Farah', email: 'maryan@hospital.com', dept: 'Obstetrics & Gynecology', specialization: 'Gynecologist', fee: 20, room: 'D-105', bio: 'Antenatal care and women\'s health.' },
    { name: 'Dr. Omar Jama', email: 'omar@hospital.com', dept: 'Orthopedics', specialization: 'Orthopedic Surgeon', fee: 20, room: 'E-110', bio: 'Trauma, fractures and joint care.' },
    { name: 'Dr. Leyla Nur', email: 'leyla@hospital.com', dept: 'Dermatology', specialization: 'Dermatologist', fee: 15, room: 'A-120', bio: 'Clinical and cosmetic dermatology.' },
  ];
  const docIds = [];
  for (const d of doctors) {
    docIds.push({ id: await ins('users', { name: d.name, email: d.email, password_hash: staffPw, role: 'doctor', department_id: deptIds[d.dept],
      specialization: d.specialization, consultation_fee: d.fee, room: d.room, bio: d.bio, phone: '0615' + rnd(100000, 999999) }), fee: d.fee, name: d.name });
  }

  /* Services */
  for (const [name, category, price] of [['Wound Dressing', 'Procedure', 5], ['Injection Administration', 'Procedure', 2], ['IV Cannulation & Drip', 'Procedure', 8],
    ['ECG', 'Diagnostics', 12], ['X-Ray (Single View)', 'Imaging', 20], ['Ultrasound Scan', 'Imaging', 30], ['Nebulization', 'Procedure', 6],
    ['Suturing (Minor)', 'Procedure', 15], ['Medical Certificate', 'Admin', 3], ['Admission (per day)', 'Ward', 40]]) {
    await ins('services', { name, category, price });
  }

  /* Lab tests */
  const tests = [
    ['CBC', 'Complete Blood Count (Hb)', 'Hematology', 'Blood (EDTA)', 'g/dL', '12-17', 8],
    ['WBC', 'White Blood Cell Count', 'Hematology', 'Blood (EDTA)', 'x10^9/L', '4-11', 5],
    ['PLT', 'Platelet Count', 'Hematology', 'Blood (EDTA)', 'x10^9/L', '150-400', 5],
    ['ESR', 'Erythrocyte Sedimentation Rate', 'Hematology', 'Blood (EDTA)', 'mm/hr', '0-20', 4],
    ['FBS', 'Fasting Blood Sugar', 'Biochemistry', 'Blood (Fluoride)', 'mg/dL', '70-110', 4],
    ['RBS', 'Random Blood Sugar', 'Biochemistry', 'Blood', 'mg/dL', '70-140', 3],
    ['HBA1C', 'HbA1c', 'Biochemistry', 'Blood (EDTA)', '%', '4-5.6', 15],
    ['CREA', 'Serum Creatinine', 'Biochemistry', 'Serum', 'mg/dL', '0.6-1.3', 6],
    ['ALT', 'ALT (SGPT)', 'Biochemistry', 'Serum', 'U/L', '7-56', 6],
    ['CHOL', 'Total Cholesterol', 'Biochemistry', 'Serum', 'mg/dL', '0-200', 7],
    ['MAL', 'Malaria Parasite (Smear/RDT)', 'Parasitology', 'Blood', '', 'Negative', 4],
    ['WIDAL', 'Widal Test (Typhoid)', 'Serology', 'Serum', 'titre', 'Below 1:80', 6],
    ['HBSAG', 'Hepatitis B Surface Antigen', 'Serology', 'Serum', '', 'Negative', 8],
    ['HIV', 'HIV 1&2 Screening', 'Serology', 'Serum', '', 'Negative', 8],
    ['URINE', 'Urinalysis', 'Microbiology', 'Urine', '', 'Normal', 5],
    ['STOOL', 'Stool Examination', 'Microbiology', 'Stool', '', 'No ova/cysts', 5],
    ['PREG', 'Pregnancy Test (hCG)', 'Serology', 'Urine', '', 'Negative', 4],
    ['HPYL', 'H. pylori Antigen', 'Serology', 'Stool', '', 'Negative', 10],
  ];
  const testIds = [];
  for (const [code, name, category, sample_type, unit, normal_range, price] of tests) {
    testIds.push({ id: await ins('lab_tests', { code, name, category, sample_type, unit, normal_range, price, turnaround: '1-2 hrs' }), name, unit, normal_range, price });
  }

  /* Suppliers */
  const supIds = [];
  for (const s of [
    { name: 'Horn Pharma Distributors', contact_person: 'Ali Mohamud', phone: '0612223344', email: 'sales@hornpharma.local', address: 'Bakara Market' },
    { name: 'East Africa Medical Supplies', contact_person: 'Grace Wanjiru', phone: '0615556677', email: 'orders@eams.local', address: 'Nairobi Rd' },
    { name: 'Global Health Imports', contact_person: 'Farhan Yusuf', phone: '0618889900', email: 'info@ghi.local', address: 'Port Area' },
  ]) supIds.push(await ins('suppliers', s));

  /* Medicines with batches */
  const meds = [
    ['MED001', 'Paracetamol', 'Paracetamol', 'Analgesic', 'Tablet', '500mg', 0.1, 0.04, 100],
    ['MED002', 'Amoxicillin', 'Amoxicillin', 'Antibiotic', 'Capsule', '500mg', 0.3, 0.12, 60],
    ['MED003', 'Ibuprofen', 'Ibuprofen', 'NSAID', 'Tablet', '400mg', 0.15, 0.06, 80],
    ['MED004', 'Metformin', 'Metformin HCl', 'Antidiabetic', 'Tablet', '500mg', 0.2, 0.08, 60],
    ['MED005', 'Amlodipine', 'Amlodipine', 'Antihypertensive', 'Tablet', '5mg', 0.25, 0.1, 60],
    ['MED006', 'Omeprazole', 'Omeprazole', 'Antacid/PPI', 'Capsule', '20mg', 0.2, 0.07, 60],
    ['MED007', 'Ciprofloxacin', 'Ciprofloxacin', 'Antibiotic', 'Tablet', '500mg', 0.35, 0.14, 40],
    ['MED008', 'Metronidazole', 'Metronidazole', 'Antibiotic', 'Tablet', '400mg', 0.15, 0.05, 50],
    ['MED009', 'Artemether/Lumefantrine', 'Coartem', 'Antimalarial', 'Tablet', '20/120mg', 0.5, 0.22, 50],
    ['MED010', 'ORS Sachet', 'Oral Rehydration Salts', 'Electrolyte', 'Sachet', '20.5g', 0.3, 0.1, 50],
    ['MED011', 'Salbutamol Inhaler', 'Salbutamol', 'Bronchodilator', 'Inhaler', '100mcg', 4.5, 2.2, 10],
    ['MED012', 'Cetirizine', 'Cetirizine', 'Antihistamine', 'Tablet', '10mg', 0.1, 0.03, 50],
    ['MED013', 'Amoxicillin Syrup', 'Amoxicillin', 'Antibiotic', 'Syrup', '125mg/5ml', 2.5, 1.1, 15],
    ['MED014', 'Paracetamol Syrup', 'Paracetamol', 'Analgesic', 'Syrup', '120mg/5ml', 1.5, 0.6, 15],
    ['MED015', 'Ferrous Sulphate + Folic', 'Ferrous/Folic acid', 'Supplement', 'Tablet', '200mg', 0.08, 0.03, 80],
    ['MED016', 'Losartan', 'Losartan', 'Antihypertensive', 'Tablet', '50mg', 0.3, 0.12, 40],
    ['MED017', 'Diclofenac Gel', 'Diclofenac', 'NSAID', 'Gel', '1%', 3, 1.3, 10],
    ['MED018', 'Hydrocortisone Cream', 'Hydrocortisone', 'Steroid', 'Cream', '1%', 2.5, 1, 10],
    ['MED019', 'Ceftriaxone Injection', 'Ceftriaxone', 'Antibiotic', 'Injection', '1g', 3.5, 1.5, 20],
    ['MED020', 'Insulin (Regular)', 'Human Insulin', 'Antidiabetic', 'Vial', '100IU/ml', 12, 7, 5],
  ];
  const medIds = [];
  for (const [code, name, generic_name, category, form, strength, unit_price, cost, reorder] of meds) {
    const id = await ins('medicines', { code, name, generic_name, category, form, strength, unit_price, reorder_level: reorder,
      unit: ['Syrup', 'Inhaler', 'Gel', 'Cream', 'Vial'].includes(form) ? 'bottle' : 'pcs' });
    medIds.push({ id, name, strength, unit_price });
    const batches = code === 'MED011' ? [[8, 200]] : code === 'MED020' ? [[3, 120]] : [[rnd(200, 600), rnd(200, 700)], [rnd(100, 300), rnd(30, 80)]];
    for (const [qty, expDays] of batches) {
      const bid = await ins('medicine_batches', { medicine_id: id, batch_no: `B${rnd(1000, 9999)}`, expiry_date: addDays(expDays), qty_received: qty,
        qty_available: qty, cost_price: cost, supplier_id: pickOne(supIds), received_by: 1, received_at: ymd(daysAgo(rnd(15, 60))) + ' 10:00:00' });
      await ins('stock_movements', { item_type: 'medicine', item_id: id, batch_id: bid, movement: 'in', quantity: qty, reference: 'Opening', notes: 'Opening stock', user_id: 1 });
    }
  }
  // One expired batch to show alerts
  const exp = await ins('medicine_batches', { medicine_id: medIds[11].id, batch_no: 'B0EXP1', expiry_date: addDays(-10), qty_received: 40, qty_available: 25, cost_price: 0.03, supplier_id: supIds[0], received_by: 1 });
  await ins('stock_movements', { item_type: 'medicine', item_id: medIds[11].id, batch_id: exp, movement: 'in', quantity: 40, reference: 'Opening', user_id: 1 });

  /* General inventory */
  for (const [code, name, category, unit, quantity, reorder_level, unit_cost, location] of [
    ['INV001', 'Surgical Gloves (box)', 'Consumables', 'box', 45, 20, 6, 'Store A'],
    ['INV002', 'Syringes 5ml', 'Consumables', 'pcs', 800, 300, 0.08, 'Store A'],
    ['INV003', 'Cotton Wool Roll', 'Consumables', 'roll', 30, 15, 2.5, 'Store A'],
    ['INV004', 'Face Masks (box)', 'Consumables', 'box', 12, 15, 4, 'Store A'],
    ['INV005', 'IV Cannula G20', 'Consumables', 'pcs', 150, 50, 0.6, 'Store B'],
    ['INV006', 'Blood Sample Tubes EDTA', 'Lab Supplies', 'pcs', 400, 150, 0.15, 'Lab Store'],
    ['INV007', 'Malaria RDT Kits', 'Lab Supplies', 'kit', 60, 40, 1.2, 'Lab Store'],
    ['INV008', 'Patient Beds', 'Equipment', 'pcs', 40, 0, 250, 'Wards'],
    ['INV009', 'Digital Thermometers', 'Equipment', 'pcs', 15, 5, 8, 'Nursing Station'],
    ['INV010', 'Printer Paper A4 (ream)', 'Stationery', 'ream', 8, 10, 5, 'Admin Office'],
  ]) {
    const id = await ins('inventory_items', { code, name, category, unit, quantity, reorder_level, unit_cost, location, supplier_id: pickOne(supIds) });
    await ins('stock_movements', { item_type: 'inventory', item_id: id, movement: 'in', quantity, balance_after: quantity, notes: 'Opening stock', user_id: 1 });
  }

  /* Patients */
  const first = ['Abdi', 'Hawa', 'Hassan', 'Ifrah', 'Mahad', 'Nasra', 'Faisal', 'Khadra', 'Ibrahim', 'Sagal', 'Bashir', 'Ayaan', 'Zakaria', 'Muna', 'Guled', 'Ubah', 'Liban', 'Hibo', 'Sharmarke', 'Deeqa', 'Mustafe', 'Asli', 'Ridwan', 'Filsan'];
  const last = ['Mohamed', 'Ali', 'Hassan', 'Abdullahi', 'Ahmed', 'Farah', 'Warsame', 'Osman', 'Jama', 'Yusuf', 'Nur', 'Aden'];
  const patIds = [];
  for (let i = 0; i < 40; i++) {
    const fn = first[i % first.length];
    const id = await ins('patients', {
      first_name: fn, last_name: pickOne(last), gender: ['Hawa', 'Ifrah', 'Nasra', 'Khadra', 'Sagal', 'Ayaan', 'Muna', 'Ubah', 'Hibo', 'Deeqa', 'Asli', 'Filsan'].includes(fn) ? 'female' : 'male',
      dob: ymd(daysAgo(rnd(365 * 2, 365 * 70))), phone: '061' + rnd(1000000, 9999999), address: pickOne(['Hodan', 'Wadajir', 'Hamarweyne', 'Karaan', 'Shibis', 'Dharkenley']),
      blood_group: pickOne(['A+', 'B+', 'O+', 'O-', 'AB+', 'A-']), allergies: i % 7 === 0 ? 'Penicillin' : null, chronic_conditions: i % 9 === 0 ? 'Hypertension' : i % 11 === 0 ? 'Diabetes' : null,
      created_at: ymd(daysAgo(rnd(1, 30))) + ' 09:00:00',
    });
    await q("UPDATE patients SET mrn=CONCAT('MRN', LPAD(?,6,'0')) WHERE id=?", [id, id]);
    patIds.push(id);
  }

  /* 14 days of completed visit history (for charts & reports) */
  const diagnoses = ['Malaria', 'Upper respiratory tract infection', 'Typhoid fever', 'Hypertension follow-up', 'Gastritis', 'Type 2 diabetes review', 'Urinary tract infection', 'Acute gastroenteritis', 'Allergic dermatitis', 'Low back pain'];
  for (let day = 13; day >= 1; day--) {
    const date = daysAgo(day);
    const tokens = {};
    for (let k = 0; k < rnd(3, 8); k++) {
      const doc = pickOne(docIds);
      tokens[doc.id] = (tokens[doc.id] || 0) + 1;
      const pid = pickOne(patIds);
      const t = `${ymd(date)} ${String(rnd(8, 15)).padStart(2, '0')}:${String(rnd(0, 59)).padStart(2, '0')}:00`;
      const vid = await ins('visits', { patient_id: pid, doctor_id: doc.id, queue_date: ymd(date), token_no: tokens[doc.id], status: 'completed',
        chief_complaint: 'Fever and body aches', diagnosis: pickOne(diagnoses), checked_in_at: t, triaged_at: t, called_at: t, completed_at: t });
      await q('UPDATE visits SET visit_no=? WHERE id=?', [no('V-', date, vid), vid]);
      await ins('vitals', { visit_id: vid, patient_id: pid, nurse_id: 3, temperature: (36 + Math.random() * 3).toFixed(1), bp_systolic: rnd(100, 160), bp_diastolic: rnd(60, 100), pulse: rnd(60, 110), spo2: rnd(93, 100), weight: rnd(15, 95), created_at: t });
      const inv = await ins('invoices', { patient_id: pid, visit_id: vid, created_by: 2, created_at: t });
      await q('UPDATE invoices SET invoice_no=? WHERE id=?', [no('INV-', date, inv), inv]);
      let total = doc.fee;
      await ins('invoice_items', { invoice_id: inv, item_type: 'consultation', ref_id: vid, description: `Consultation - ${doc.name}`, quantity: 1, unit_price: doc.fee, amount: doc.fee, created_at: t });
      if (Math.random() < 0.6) {
        const tst = pickOne(testIds);
        const oid = await ins('lab_orders', { visit_id: vid, patient_id: pid, doctor_id: doc.id, status: 'completed', technician_id: 4, created_at: t, collected_at: t, completed_at: t });
        await q('UPDATE lab_orders SET order_no=? WHERE id=?', [no('LAB-', date, oid), oid]);
        const abnormal = Math.random() < 0.3;
        await ins('lab_order_items', { lab_order_id: oid, test_id: tst.id, test_name: tst.name, unit: tst.unit, normal_range: tst.normal_range, price: tst.price,
          result_value: tst.normal_range.includes('-') ? String(abnormal ? 250 : rnd(...tst.normal_range.split('-').map((x) => Math.ceil(Number(x))))) : (abnormal ? 'Positive' : tst.normal_range), result_flag: abnormal ? 'abnormal' : 'normal' });
        await ins('invoice_items', { invoice_id: inv, item_type: 'lab', ref_id: oid, description: `Lab: ${tst.name}`, quantity: 1, unit_price: tst.price, amount: tst.price, created_at: t });
        total += tst.price;
      }
      if (Math.random() < 0.8) {
        const m = pickOne(medIds); const qty = rnd(6, 20);
        const rid = await ins('prescriptions', { visit_id: vid, patient_id: pid, doctor_id: doc.id, status: 'dispensed', pharmacist_id: 5, created_at: t, dispensed_at: t });
        await q('UPDATE prescriptions SET rx_no=? WHERE id=?', [no('RX-', date, rid), rid]);
        await ins('prescription_items', { prescription_id: rid, medicine_id: m.id, dosage: '1 tab', frequency: '3x daily', duration: '5 days', quantity: qty, qty_dispensed: qty });
        const amt = Math.round(qty * m.unit_price * 100) / 100;
        await ins('invoice_items', { invoice_id: inv, item_type: 'medicine', ref_id: m.id, description: `${m.name} ${m.strength}`, quantity: qty, unit_price: m.unit_price, amount: amt, created_at: t });
        total += amt;
      }
      total = Math.round(total * 100) / 100;
      const paid = Math.random() < 0.9 ? total : 0;
      await q('UPDATE invoices SET subtotal=?, total=?, amount_paid=?, status=? WHERE id=?', [total, total, paid, paid ? 'paid' : 'unpaid', inv]);
      if (paid) {
        const method = pickOne(['cash', 'cash', 'mobile', 'mobile', 'card']);
        const pay = await ins('payments', { invoice_id: inv, amount: paid, method, received_by: 2, created_at: t });
        await q('UPDATE payments SET payment_no=? WHERE id=?', [no('RCT-', date, pay), pay]);
        const tx = await ins('transactions', { type: 'income', category: 'Patient Services', amount: paid, method, reference: no('INV-', date, inv), description: 'Visit payment', user_id: 2, created_at: t });
        await q('UPDATE transactions SET txn_no=? WHERE id=?', [no('TXN-', date, tx), tx]);
      }
    }
    if (day % 3 === 0) {
      const cat = pickOne(['Utilities', 'Maintenance', 'Supplies', 'Transport']);
      const amount = rnd(20, 180);
      const e = await ins('expenses', { category: cat, description: `${cat} payment`, amount, method: 'cash', paid_to: 'Vendor', expense_date: ymd(date), recorded_by: 6 });
      await q('UPDATE expenses SET expense_no=? WHERE id=?', [no('EXP-', date, e), e]);
      const tx = await ins('transactions', { type: 'expense', category: cat, amount, method: 'cash', reference: no('EXP-', date, e), description: `${cat} payment`, user_id: 6, created_at: ymd(date) + ' 12:00:00' });
      await q('UPDATE transactions SET txn_no=? WHERE id=?', [no('TXN-', date, tx), tx]);
    }
  }

  /* Upcoming appointments (today and next days) */
  const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00', '15:30', '16:00'];
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 14; i++) {
    const doc = docIds[i % docIds.length];
    let ref = 'APT-'; for (let j = 0; j < 7; j++) ref += A[rnd(0, A.length - 1)];
    const date = addDays(i < 6 ? 0 : rnd(1, 5));
    await q("INSERT IGNORE INTO appointments (ref_code, patient_id, doctor_id, department_id, appt_date, appt_time, reason, source, status) SELECT ?,?,?,department_id,?,?,?,?,? FROM users WHERE id=?",
      [ref, patIds[i], doc.id, date, times[(i * 3) % times.length], pickOne(['Follow-up', 'Fever', 'Check-up', 'Cough', 'Skin rash', 'Chest pain']), i % 2 ? 'web' : 'reception', i % 3 ? 'confirmed' : 'pending', doc.id]);
  }

  await accounting();
  await conn.end();
  console.log('\nDemo data seeded. Logins (password):');
  console.log('  admin@hospital.com      Admin@123');
  console.log('  reception@hospital.com  Staff@123   nurse@hospital.com   Staff@123');
  console.log('  doctor@hospital.com     Staff@123   lab@hospital.com     Staff@123');
  console.log('  pharmacy@hospital.com   Staff@123   accounts@hospital.com Staff@123');
}

main().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
