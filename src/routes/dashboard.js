const db = require('../db');
const { Router } = require('../utils');

const r = Router();
const FINANCE_ROLES = ['admin', 'accountant', 'receptionist'];

r.get('/dashboard', async (req, res) => {
  const [stages, appt, lab, rx, low, expiring, patients, last14, depts, recentLab, todayAppts] = await Promise.all([
    db.query("SELECT status, COUNT(*) n FROM visits WHERE queue_date=CURDATE() GROUP BY status"),
    db.one("SELECT COUNT(*) total, SUM(status IN ('pending')) pending, SUM(source='web') web FROM appointments WHERE appt_date=CURDATE()"),
    db.one("SELECT SUM(status='pending') pending, SUM(status IN ('sample_collected','in_progress')) processing, SUM(status='completed' AND DATE(completed_at)=CURDATE()) done FROM lab_orders"),
    db.one("SELECT SUM(status IN ('pending','partial')) pending, SUM(status='dispensed' AND DATE(dispensed_at)=CURDATE()) done FROM prescriptions"),
    db.one(`SELECT COUNT(*) n FROM (SELECT m.reorder_level, (SELECT COALESCE(SUM(b.qty_available),0) FROM medicine_batches b WHERE b.medicine_id=m.id
            AND (b.expiry_date IS NULL OR b.expiry_date>=CURDATE())) s FROM medicines m WHERE m.active=1) x WHERE s<=reorder_level`),
    db.one("SELECT COUNT(*) n FROM medicine_batches WHERE qty_available>0 AND expiry_date < DATE_ADD(CURDATE(), INTERVAL 90 DAY)"),
    db.one("SELECT COUNT(*) total, SUM(DATE(created_at)=CURDATE()) today FROM patients"),
    db.query(`SELECT queue_date d, COUNT(*) n FROM visits WHERE queue_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) AND status<>'cancelled' GROUP BY queue_date ORDER BY d`),
    db.query(`SELECT COALESCE(d.name,'Unassigned') name, COUNT(*) n FROM visits v JOIN users u ON u.id=v.doctor_id LEFT JOIN departments d ON d.id=u.department_id
              WHERE v.queue_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND v.status<>'cancelled' GROUP BY d.name ORDER BY n DESC`),
    db.query(`SELECT o.id, o.order_no, o.completed_at, CONCAT(p.first_name,' ',p.last_name) patient_name,
              (SELECT SUM(i.result_flag IN ('high','low','critical','abnormal')) FROM lab_order_items i WHERE i.lab_order_id=o.id) abnormal
              FROM lab_orders o JOIN patients p ON p.id=o.patient_id WHERE o.status='completed' ORDER BY o.completed_at DESC LIMIT 6`),
    db.query(`SELECT a.id, a.ref_code, TIME_FORMAT(a.appt_time,'%H:%i') time, a.status, a.source, CONCAT(p.first_name,' ',p.last_name) patient_name, u.name doctor_name
              FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=a.doctor_id
              WHERE a.appt_date=CURDATE() ${req.user.role === 'doctor' ? 'AND a.doctor_id=' + Number(req.user.id) : ''} ORDER BY a.appt_time LIMIT 12`),
  ]);
  const s = Object.fromEntries(stages.map((x) => [x.status, x.n]));
  const out = {
    flow: {
      checked_in: stages.reduce((a, x) => a + (x.status === 'cancelled' ? 0 : x.n), 0),
      triage: s.waiting_triage || 0,
      doctor: (s.waiting_doctor || 0) + (s.in_consultation || 0),
      lab: s.waiting_lab || 0,
      results: s.results_ready || 0,
      pharmacy: s.waiting_pharmacy || 0,
      completed: s.completed || 0,
      cancelled: s.cancelled || 0,
    },
    appointments: { total: appt.total || 0, pending: Number(appt.pending || 0), web: Number(appt.web || 0) },
    lab: { pending: Number(lab.pending || 0), processing: Number(lab.processing || 0), done: Number(lab.done || 0) },
    pharmacy: { pending: Number(rx.pending || 0), done: Number(rx.done || 0), low_stock: low.n, expiring: expiring.n },
    patients: { total: patients.total, today: Number(patients.today || 0) },
    visits_14d: last14, departments: depts, recent_lab: recentLab, today_appointments: todayAppts,
  };
  if (FINANCE_ROLES.includes(req.user.role)) {
    const [today, month, outstanding, rev14, billing] = await Promise.all([
      db.one("SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE type='income' AND DATE(created_at)=CURDATE()"),
      db.one("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income, COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense FROM transactions WHERE created_at >= DATE_FORMAT(CURDATE(),'%Y-%m-01')"),
      db.one("SELECT COALESCE(SUM(total-amount_paid),0) v, COUNT(*) n FROM invoices WHERE status IN ('unpaid','partial')"),
      db.query(`SELECT DATE(created_at) d, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) expense
                FROM transactions WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY DATE(created_at) ORDER BY d`),
      db.one("SELECT COUNT(*) n FROM invoices i JOIN visits v ON v.id=i.visit_id WHERE v.queue_date=CURDATE() AND i.status IN ('unpaid','partial')"),
    ]);
    out.finance = { today: today.v, month_income: month.income, month_expense: month.expense, outstanding: outstanding.v, outstanding_count: outstanding.n, revenue_14d: rev14 };
    out.flow.billing = billing.n;
  }
  res.json(out);
});

module.exports = r;
