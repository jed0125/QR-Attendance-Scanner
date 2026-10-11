# QR Attendance System — Phases 1–3

## Phase 1: Student Self-Registration
- Public registration form (no login)
- Philippine mobile number validation (09XXXXXXXXX or +639XXXXXXXXX) → normalized to `639XXXXXXXXX`
- Consent checkbox for SMS notifications
- Anti-spam: honeypot field + submit-button disable
- QR code generated from the student's UUID (the UUID is the QR payload — no name/phone inside)
- Download PNG and Print buttons
- Row Level Security on all tables

## Phase 2: Teacher Login, Scanner & Approvals
- Teacher email/password login via Supabase Auth
- Teacher authorization via `teachers` table (no public teacher signup)
- Protected scanner page: rear camera QR scan, Time In/Out toggle, debounced scans, student lookup with approval check
- Protected approvals page: list unapproved students (newest first), approve (sets `approved = true`), reject (deletes row with confirm)
- Shared auth guard (`js/auth.js`) for route protection
- Sign-out on protected pages (nav bar: **Scanner | Approvals | Sign Out**)

## Phase 3: Attendance Logging
- Every valid scan is written to `attendance_logs` with duplicate guards
- Uniqueness: at most one `time_in` and one `time_out` per student per day
- Result rules:
  - `time_in` when one already exists today → "Already timed in today at HH:MM"
  - `time_out` with no `time_in` today → "No time in recorded today"
  - `time_out` when one already exists today → "Already timed out at HH:MM"
- Only the scanned teacher's own scan can be inserted (`scanned_by = auth.uid()`)
- Success: green card, short beep + vibrate; Rejection: amber message + different beep
- "Today's Logs" list loads from the database on page load (teacher's scans, newest first, live updates)
- Phase-4 SMS columns (`sms_status`, `sms_sent_at`, `sms_error`) are reserved — teachers cannot write them from the client

---

## Project structure
```
qr-attendance/
├── index.html            # Registration page (Phase 1)
├── login.html            # Teacher login (Phase 2)
├── scanner.html          # QR scanner (Phase 2+3, teacher only)
├── approvals.html        # Approve/reject registrations (Phase 2, teacher only)
├── css/
│   └── styles.css        # Mobile-friendly styling
├── js/
│   ├── config.js         # Central Supabase config (edit this file once)
│   ├── app.js            # Registration logic (Phase 1)
│   ├── auth.js           # Shared auth guard (Phase 2)
│   ├── scanner.js        # Scanner logic (Phase 2+3)
│   └── approvals.js      # Approvals logic (Phase 2)
├── sql/
│   ├── 001_initial_schema.sql   # Schema + RLS (Phase 1)
│   ├── 002_teacher_access.sql   # approved column + teacher policies (Phase 2)
│   └── 003_attendance_logging.sql # Attendance logging + SMS columns (Phase 3)
└── README.md
```

---

## Setup steps

### 1. Create a Supabase project
1. Go to [https://app.supabase.com](https://app.supabase.com) and sign in.
2. Click **New project**.
3. Fill in: Project name (e.g. `qr-attendance`), Organization, Database password.
4. Click **Create** and wait for it to provision (a couple of minutes).

### 2. Run the migrations (in order)
1. In your project, go to **SQL Editor**.
2. Run `sql/001_initial_schema.sql`, then `sql/002_teacher_access.sql`, then `sql/003_attendance_logging.sql`.

The migrations create:
- `students` — id (uuid, IS the QR payload), student_name, guardian_name, guardian_phone, **approved** (bool, default false), created_at
- `attendance_logs` — id, student_id (FK), type (time_in|time_out), scanned_by (FK), created_at, **log_date** (derived, stored), sms_status, sms_sent_at, sms_error
- `teachers` — id (FK to auth.users), name
- RLS policies:
  - `anon` may INSERT into students only, **only rows where approved = false**, and only the columns student_name, guardian_name, guardian_phone
  - authenticated teachers may SELECT students, UPDATE approved, DELETE students, and SELECT/INSERT attendance_logs (with `scanned_by` restricted to their own id)
  - nobody may UPDATE/DELETE attendance_logs from the client (reserved for a server function later)

### 3. Configure the client
Edit **only** `js/config.js` and set your project's values:

```js
window.SUPABASE_URL = 'https://REPLACE_WITH_YOUR_SUPABASE_URL.supabase.co';
window.SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_ANON_KEY';
```

Get them from your project dashboard → **Settings → API**:
- `Project URL` → `SUPABASE_URL`
- `anon / public` key → `SUPABASE_ANON_KEY`

> Security: only the anon key is used here. The service role key never leaves the server. All other pages read the config from `js/config.js`.

### 4. Add a teacher (required for Phase 2+3)
1. In the Supabase dashboard, go to **Authentication > Users**.
2. Create the teacher user (invite by email with a magic link, or add manually and set a password).
3. Copy that user's id (UUID).
4. In SQL Editor, insert a row into the teachers table:
   ```sql
   insert into public.teachers (id, name)
   values ('<teacher-user-id>', 'Teacher Name');
   ```
5. The teacher can now sign in at `login.html`, then access `scanner.html` and `approvals.html`.

> **Important:** There is no public teacher signup. Teachers must be added manually via the steps above.

### 5. Serve the page
Serve from any static host (e.g. Python):
```bash
cd qr-attendance
python3 -m http.server 8000
```
Then open `http://localhost:8000` in a browser.

> **Camera requirement:** The QR scanner uses `html5-qrcode` which requires a **secure context** (HTTPS or `localhost`). Use `localhost` for testing. For deployment, use a proper HTTPS host (e.g., Vercel, Netlify, or your own domain with TLS).

---

## End-to-end test (Phases 1–3)

### A. Register a student (public)
1. Open `http://localhost:8000/index.html`
2. Fill in: student name, guardian name, guardian phone (e.g. `09171234567`)
3. Check the consent checkbox → click **Generate QR Code**
4. Confirm the QR card appears; verify the row landed in `students` with `approved = false` and normalized phone `639171234567`

### B. Approve the student (teacher)
1. Open `login.html`, sign in as a teacher
2. After redirect to `scanner.html`, open `approvals.html`
3. Click **Approve** → confirm. The row should vanish; in the DB the row now has `approved = true`

### C. Test the logging rules (scanner)
On the **teacher** device:
1. **Time in:** Select green **Time In**, scan the student's QR → green result card: "Juan Dela Cruz, Time In recorded, HH:MM". "Today's Logs" shows the entry. In the DB, one row exists.
2. **Scan same code again (Time In still selected):** → amber warning "Already timed in today at HH:MM". No new row.
3. **Switch to Time Out and scan again:** → amber "No time in recorded today". No new row.
4. **Switch back to Time In and scan again:** → amber "Already timed in today at HH:MM". No new row.
5. **Time out:** Switch to **Time Out**, scan the QR → green card "Time Out recorded". One new row (type = `time_out`) with `scanned_by` = your teacher id.
6. **Switch to Time Out and scan again:** → amber "Already timed out today at HH:MM".
7. **Scan a non-UUID QR:** → "Not a valid student QR".
8. **Scan an unapproved student:** → "Student is not approved yet".

### D. Verify the database
In Supabase → **Table Editor → attendance_logs**:
- Exactly two rows for today (one `time_in`, one `time_out`)
- `log_date` = today's date
- `scanned_by` = your teacher's id
- `sms_status` = 'pending' (default, reserved for Phase 4)

---

## Testing each Phase 3 rule
| Rule | How to test |
|---|---|
| time_in already exists today | Select Time In → scan approved student's QR → see amber "Already timed in today at HH:MM"; verify no 2nd row inserted |
| time_out with no time_in | Approve a fresh student, select Time Out, scan → see "No time in recorded today"; no row inserted |
| time_out already exists | After a successful time_in, wait 5s, then Time Out scan → green; scan once more → amber "Already timed out today at HH:MM" |
| Unique constraint enforces no duplicates | Even if a rule above is bypassed, the DB's unique index on (student_id, type, log_date) catches it — error code `23505` is caught and turned into a friendly message |
| No "recorded" on failure | Interrupt the network (devtools → offline) while scanning → see red message, nothing recorded, can scan again |
| scanned_by = teacher's own id | Check DB after each scan: `scanned_by` must equal the logged-in teacher's uid |
| Today's logs live | Scan on device A and device B in parallel — both "Today's Logs" lists update |
| Phase-4 SMS columns are read-only | Any client UPDATE of `sms_status` is rejected by the RLS deny policy and column grants |
| Security: anon can only insert approved=false | Try inserting `approved = true` via the anon key (PostgREST/Supabase JS) → policy rejects |
| Security: anon can't change columns | Try inserting via anon with extra columns (e.g. `created_at`) → `grant insert (...)` on students limits the columns |

---

## Phase 4 (next)
- Write to `attendance_logs` on scan (already done — this was Phase 3)
- SMS notifications: send via a server edge function using the reserved `sms_status` / `sms_sent_at` / `sms_error` columns
- Teacher dashboard: daily logs, filter by student/date, export

## Phase 5 (future)
- Guardian portal to view attendance history
- Batch export (CSV/Excel)
- Analytics / reporting