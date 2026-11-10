-- 001: core hospital schema (patients, visits, lab, pharmacy, inventory, billing)

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(64) PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  room VARCHAR(50),
  icon VARCHAR(16),
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','receptionist','doctor','nurse','lab','pharmacist','accountant') NOT NULL,
  phone VARCHAR(30),
  department_id INT NULL,
  specialization VARCHAR(120),
  consultation_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  room VARCHAR(30),
  bio TEXT,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_login DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mrn VARCHAR(24) UNIQUE,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  gender ENUM('male','female','other') NULL,
  dob DATE NULL,
  phone VARCHAR(30),
  email VARCHAR(120),
  address VARCHAR(255),
  blood_group VARCHAR(5),
  allergies TEXT,
  chronic_conditions TEXT,
  emergency_contact VARCHAR(120),
  emergency_phone VARCHAR(30),
  insurance_provider VARCHAR(120),
  insurance_no VARCHAR(60),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pat_phone (phone),
  INDEX idx_pat_name (last_name, first_name)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ref_code VARCHAR(20) NOT NULL UNIQUE,
  patient_id INT NOT NULL,
  doctor_id INT NULL,
  department_id INT NULL,
  appt_date DATE NOT NULL,
  appt_time TIME NOT NULL,
  reason TEXT,
  source ENUM('web','reception','phone') NOT NULL DEFAULT 'reception',
  status ENUM('pending','confirmed','checked_in','completed','cancelled','no_show') NOT NULL DEFAULT 'pending',
  visit_id INT NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  INDEX idx_appt_date (appt_date),
  INDEX idx_appt_doc (doctor_id, appt_date)
);

CREATE TABLE IF NOT EXISTS visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visit_no VARCHAR(24) UNIQUE,
  patient_id INT NOT NULL,
  doctor_id INT NOT NULL,
  appointment_id INT NULL,
  queue_date DATE NOT NULL,
  token_no INT NOT NULL,
  priority ENUM('normal','urgent','emergency') NOT NULL DEFAULT 'normal',
  status ENUM('waiting_triage','waiting_doctor','in_consultation','waiting_lab','results_ready','waiting_pharmacy','completed','cancelled') NOT NULL DEFAULT 'waiting_triage',
  chief_complaint TEXT,
  symptoms TEXT,
  examination TEXT,
  diagnosis TEXT,
  notes TEXT,
  follow_up_date DATE NULL,
  created_by INT NULL,
  checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  triaged_at DATETIME NULL,
  called_at DATETIME NULL,
  completed_at DATETIME NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES users(id),
  INDEX idx_visit_q (queue_date, status),
  INDEX idx_visit_doc (doctor_id, queue_date)
);

CREATE TABLE IF NOT EXISTS vitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visit_id INT NOT NULL,
  patient_id INT NOT NULL,
  nurse_id INT NULL,
  temperature DECIMAL(4,1) NULL,
  bp_systolic INT NULL,
  bp_diastolic INT NULL,
  pulse INT NULL,
  resp_rate INT NULL,
  spo2 INT NULL,
  weight DECIMAL(5,1) NULL,
  height DECIMAL(5,1) NULL,
  pain_score INT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE,
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(60),
  sample_type VARCHAR(60),
  unit VARCHAR(30),
  normal_range VARCHAR(80),
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  turnaround VARCHAR(30),
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lab_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(24) UNIQUE,
  visit_id INT NULL,
  patient_id INT NOT NULL,
  doctor_id INT NULL,
  priority ENUM('normal','urgent','stat') NOT NULL DEFAULT 'normal',
  status ENUM('pending','sample_collected','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  clinical_notes TEXT,
  technician_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  collected_at DATETIME NULL,
  completed_at DATETIME NULL,
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  INDEX idx_lab_status (status)
);

CREATE TABLE IF NOT EXISTS lab_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lab_order_id INT NOT NULL,
  test_id INT NOT NULL,
  test_name VARCHAR(120),
  unit VARCHAR(30),
  normal_range VARCHAR(80),
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  result_value VARCHAR(255),
  result_flag ENUM('normal','low','high','critical','abnormal') NULL,
  remarks TEXT,
  FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES lab_tests(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  contact_person VARCHAR(120),
  phone VARCHAR(30),
  email VARCHAR(120),
  address VARCHAR(255),
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  generic_name VARCHAR(120),
  category VARCHAR(60),
  form VARCHAR(40),
  strength VARCHAR(40),
  unit VARCHAR(20) DEFAULT 'pcs',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 20,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicine_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_no VARCHAR(60) NOT NULL,
  expiry_date DATE NULL,
  qty_received INT NOT NULL,
  qty_available INT NOT NULL,
  cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  supplier_id INT NULL,
  received_by INT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  INDEX idx_batch_med (medicine_id, expiry_date)
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rx_no VARCHAR(24) UNIQUE,
  visit_id INT NULL,
  patient_id INT NOT NULL,
  doctor_id INT NULL,
  status ENUM('pending','partial','dispensed','cancelled') NOT NULL DEFAULT 'pending',
  notes TEXT,
  pharmacist_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  dispensed_at DATETIME NULL,
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  INDEX idx_rx_status (status)
);

CREATE TABLE IF NOT EXISTS prescription_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prescription_id INT NOT NULL,
  medicine_id INT NOT NULL,
  dosage VARCHAR(60),
  frequency VARCHAR(60),
  duration VARCHAR(60),
  quantity INT NOT NULL DEFAULT 1,
  qty_dispensed INT NOT NULL DEFAULT 0,
  instructions VARCHAR(255),
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(60),
  unit VARCHAR(20) DEFAULT 'pcs',
  quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  location VARCHAR(80),
  supplier_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_type ENUM('medicine','inventory') NOT NULL,
  item_id INT NOT NULL,
  batch_id INT NULL,
  movement ENUM('in','out','dispense','sale','adjust','expired','return') NOT NULL,
  quantity INT NOT NULL,
  balance_after INT NULL,
  reference VARCHAR(60),
  notes VARCHAR(255),
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mv_item (item_type, item_id),
  INDEX idx_mv_date (created_at)
);

CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(60),
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(24) UNIQUE,
  patient_id INT NULL,
  visit_id INT NULL,
  customer_name VARCHAR(160),
  status ENUM('unpaid','partial','paid','cancelled') NOT NULL DEFAULT 'unpaid',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL,
  INDEX idx_inv_status (status),
  INDEX idx_inv_date (created_at)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  item_type ENUM('consultation','lab','medicine','service','other') NOT NULL,
  ref_id INT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_no VARCHAR(24) UNIQUE,
  invoice_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('cash','card','mobile','bank','insurance') NOT NULL DEFAULT 'cash',
  reference VARCHAR(80),
  received_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  INDEX idx_pay_date (created_at)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_no VARCHAR(24) UNIQUE,
  category VARCHAR(60) NOT NULL,
  description VARCHAR(255),
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('cash','card','mobile','bank','insurance') NOT NULL DEFAULT 'cash',
  paid_to VARCHAR(120),
  expense_date DATE NOT NULL,
  recorded_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  txn_no VARCHAR(24) UNIQUE,
  type ENUM('income','expense') NOT NULL,
  category VARCHAR(60) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(20),
  reference VARCHAR(80),
  description VARCHAR(255),
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_txn_date (created_at)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60),
  entity_id INT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_date (created_at)
);
