# MediCircle HMS — Hospital Management System

A connected hospital system built around the **patient care circle**:

```
 Appointment (website / reception)
        │
        ▼
  Check-in + queue token ──► Nurse triage (vitals, priority)
                                   │
                                   ▼
                         Doctor consultation ◄─────────────┐
                           │            │                   │
                 orders lab tests   prescribes          results ready
                           │            │                   │
                           ▼            ▼                   │
                      Laboratory ───────┼───────────────────┘
                                        ▼
                               Pharmacy dispensing (FEFO stock)
                                        │
                                        ▼
                             Billing & cashier ──► Completed
```

Every step updates the patient's visit automatically. The doctor never has to chase results: when the lab completes the last test, the patient goes back to the doctor's queue marked **Results ready**.

## Features

| Area | What it does |
|---|---|
| **Care Circle dashboard** | Animated live ring that shows how many patients are at each stage. Also KPIs and charts. |
| **Patient Flow board** | Kanban board of every patient in the circle today, with waiting times |
| **Patients** | Master patient index (MRN), allergies, chronic conditions, insurance, full history |
| **Appointments** | Reception/phone bookings, online bookings from the website, slot management, check-in, no-show |
| **Check-in & queue** | Per-doctor queue tokens, priority (normal/urgent/emergency), printable token slips |
| **Nurse triage** | Vitals (temperature, BP, pulse, SpO₂, weight, BMI…), priority update |
| **Doctor workspace** | Live queue, consultation notes, lab ordering, results review, e-prescription with auto quantity, follow-up |
| **Laboratory** | Sample collection, result entry with automatic high/low/critical flags, printable lab reports, turnaround times |
| **Pharmacy** | Dispensing queue, partial dispensing, batches + expiry, FEFO deduction, low stock / expiry alerts, OTC point-of-sale |
| **General inventory** | Consumables, lab supplies, equipment, stock in / issue / adjust, movement log |
| **Finance** | Auto-built visit invoices (consultation + lab + medicine + services), payments (cash, mobile, card, bank, insurance), discounts, expenses, transaction ledger, CSV export, reports |
| **Accounting (double-entry)** | Chart of accounts (create / edit / group / deactivate accounts, opening balances), automatic journal posting, manual journals, transfers, supplier payments, general ledger, trial balance, income statement, balance sheet, receivables aging, supplier payables |
| **Admin** | Staff and roles, departments, services and fees, settings, audit log |
| **Patient website** | Departments, doctors, 4-step online booking with live slots, booking lookup/cancel |
| **Queue display** | Full-screen TV board (`/display`), "now serving" per doctor, voice announcement, pharmacy list |

## Requirements

- Node.js 18+ (tested on 24)
- MySQL 8+ (tested on MySQL 9.6)

## Setup

**Try it with demo data (development):**

```bash
npm install
cp .env.example .env   # set DB_USER / DB_PASSWORD / JWT_SECRET, and DEMO_MODE=true, NODE_ENV=development
npm run setup          # runs migrations + loads demo data into an empty database
npm start
```

**Real hospital (production):** no demo data.

```bash
npm ci --omit=dev
cp .env.example .env   # fill in real values
npm run migrate        # create / upgrade the database schema
npm run create-admin   # your first administrator
npm start
```

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for servers, Docker, HTTPS, backups and updates.

| Command | What it does |
|---|---|
| `npm start` | Start the server (applies pending migrations first) |
| `npm run migrate` / `migrate:status` | Apply / list database migrations (`migrations/`) |
| `npm run create-admin` | Create an admin, or reset an admin's password |
| `npm run backup` | Dump the database to `backups/` |
| `npm run setup` | Demo install: migrations + demo data (only if empty) |
| `npm run reset` | ⚠ Drop the database and reload demo data (blocked in production) |

Open:

- Patient website: http://localhost:3000/
- Staff portal: http://localhost:3000/app/
- Queue display: http://localhost:3000/display/

## Demo accounts (only after `npm run setup`)

| Role | Email | Password |
|---|---|---|
| Admin (everything) | admin@hospital.com | Admin@123 |
| Reception / cashier | reception@hospital.com | Staff@123 |
| Nurse | nurse@hospital.com | Staff@123 |
| Doctor | doctor@hospital.com | Staff@123 |
| Laboratory | lab@hospital.com | Staff@123 |
| Pharmacist | pharmacy@hospital.com | Staff@123 |
| Accountant | accounts@hospital.com | Staff@123 |

Other doctors: sahra@, yusuf@, maryan@, omar@, leyla@ `@hospital.com` (password `Staff@123`).

**Change these passwords before real use** (top-right menu → Change password, or Admin → Staff & Users).

## Walk through the circle

1. **Website**: book an appointment at `/` and note the reference code.
2. **Reception** (`reception@`): open *Appointments* or *Check-in & Queue* → **Check in** → print the token.
3. **Nurse** (`nurse@`): *Nurse Triage* → **Record vitals**.
4. **Doctor** (`doctor@`): *Doctor Workspace* → pick the patient → **Call patient in** → write notes → **Order lab tests**.
5. **Lab** (`lab@`): *Laboratory* → **Collect sample** → **Enter results** → **Complete & send to doctor**.
6. **Doctor**: the patient is back in the queue as *Results ready* → review → **Prescribe**.
7. **Pharmacy** (`pharmacy@`): *Dispensing* → **Dispense** (stock is deducted by earliest expiry).
8. **Cashier** (`reception@` or `accounts@`): *Billing & Cashier* → **Collect** → print the receipt.

Keep `/display/` open on a second screen to watch tokens move.

## Accounting

Log in as `accounts@` (or admin) and use **Chart of Accounts**, **Journal Entries** and **Financial Statements**.

Every operation posts a balanced journal automatically:

| Event | Debit | Credit |
|---|---|---|
| Charge added (consultation / lab / medicine / service) | Accounts Receivable – Patients | Matching revenue account |
| Discount given | Discounts & Waivers | Accounts Receivable |
| Payment received | Chosen cash / bank / mobile account (or Insurance Receivable) | Accounts Receivable |
| Medicine dispensed or sold | Cost of Medicines Sold | Pharmacy Inventory (batch cost) |
| Medicine / supplies purchased | Inventory | Money account, or Accounts Payable (on credit), or Opening Balance Equity |
| Supplies issued to a ward | Medical Supplies Used | Supplies Inventory |
| Expired / damaged stock | Stock Write-offs | Inventory |
| Expense | Chosen expense (or fixed-asset) account | Money account or Accounts Payable |
| Supplier payment | Accounts Payable (per supplier) | Money account |
| Transfer | Destination money account | Source money account |

Posted entries are never edited or deleted. Manual entries are corrected by **Reverse**, and automatic ones by correcting the source document. System accounts (🔒) can be renamed but not deleted. Add your own banks or mobile wallets as asset accounts with **Cash / bank** ticked; they then appear in every payment form.

On first start after upgrading, existing invoices, payments, expenses and stock movements are converted to journal entries automatically.

## Project structure

```
server.js                 Express app
migrations/               Versioned database migrations (001, 002, ...)
src/migrate.js            Migration runner (schema_migrations table)
src/setup.js              Demo install: migrations + demo seed
scripts/                  create-admin, backup
deploy/                   nginx example, MySQL app-user script
Dockerfile, docker-compose.yml, ecosystem.config.js   Deployment
src/db.js                 MySQL pool + transaction helper
src/middleware/auth.js    JWT auth + role guard
src/services/             billing, stock (FEFO), clinical (visits, slots)
src/routes/               REST API (public, auth, admin, patients, appointments,
                          visits, lab, pharmacy, inventory, finance, dashboard)
public/app/               Staff portal (vanilla JS modules, no build step)
public/site/              Patient website
public/display/           Queue TV display
```

## Security notes

- Passwords are hashed with bcrypt. Sessions use JWT (12h) with the secret in `.env`.
- Role-based access is enforced on every API route, not only in the menu.
- All SQL is parameterised. All user data is HTML-escaped in the UI.
- Public endpoints are rate-limited. Bookings can only be looked up with reference **and** phone number.
- The queue display shows token numbers only, never patient names.
- For production: put it behind HTTPS (e.g. nginx), use a dedicated MySQL user instead of `root`, and back up the database regularly.
