# School attendance registration — Phase 1, 2, 3, 4, 5 & 6A

This is a plain HTML, CSS, and JavaScript app. It uses the Firebase modular Web SDK from Google's gstatic CDN (pinned to `13.1.0`), QRCode.js from cdnjs (pinned to `1.0.0`), and html5-qrcode from jsDelivr (pinned to `2.3.8`). It has no npm dependencies, framework, or build step. Do not run `firebase deploy`.

Phase 1 lets a student submit a registration and receive a QR code containing only the generated UUID. There is no login, QR scanner, email/SMS delivery, or staff approval interface. A teacher must approve each registration before the QR works for attendance.

Phase 2 adds a staff approval interface. Staff (teachers/admins) sign in with email/password, view pending student registrations, and approve or reject them.

Phase 3 adds a staff-only scanner page that scans a student's QR code, records time-in or time-out in Firestore, and shows today's log. The security rules enforce the attendance rules, not just the browser code.

Phase 4 adds guardian email notifications. After a scan is saved, the guardian gets an email via a Google Apps Script web app. Everything is free and needs no domain.

Phase 5 adds guardian ("parent") portal. Parents sign in with a Firebase Auth email link and see only their own children and today's attendance status. Read-only.

Phase 6A adds an admin-managed school calendar, shared late/absent logic, and a full read-only parent portal with history and monthly summaries.

## 1. Prepare Firebase

1. In the [Firebase console](https://console.firebase.google.com/), create or open your project on the Spark plan.
2. Add a Web app in Project settings if you have not already registered one.
3. Copy that app's Firebase configuration object.
4. Open `js/firebase-config.js` and replace each `YOUR_...` placeholder with the matching value from your Firebase configuration. Keep the property names and JavaScript object syntax intact. The Firebase web configuration is client-side configuration, not a service-account key.
5. In the Firebase console, open **Build → Firestore Database** and create the database if needed.
6. Open **Firestore Database → Rules**. Replace the rules editor contents with the entire contents of `firestore.rules`, then click **Publish**.
7. In Project settings → General → Your apps, add the Live Server origin to **Authorized domains** only if your Firebase project requests it. Do not put private service-account credentials in this project.

The rules allow unauthenticated document creation only for the exact Phase 1 student shape. They deny reads, updates, deletes, and all other paths. No student details can be read back by this page.

## 2. Set up staff accounts

Staff members are identified by a document in the `staff/{uid}` Firestore collection. You must create these manually in the Firebase console.

For each staff member:

1. In the Firebase console, open **Authentication → Users** and click **Add user**.
2. Choose **Email/Password** provider. Enter the staff member's email and a secure password. Save the user — note the generated UID.
3. In the Firebase console, open **Build → Firestore Database → Data**.
4. Create a new collection named `staff` (if it doesn't exist).
5. Add a document with the **document ID equal to the UID** from step 2.
6. Set the following fields:
   - `name` (string): The staff member's display name, e.g., "Ms. Santos"
   - `role` (string): Either `"teacher"` or `"admin"`
7. Repeat for each staff member.

**Important:** The client never writes to the `staff` collection. Only you (via the Firebase console or Admin SDK) can create or modify staff documents.

## 3. Publishing the rules

The `firestore.rules` file contains Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, and Phase 6A rules. After setting up staff documents:

1. Open **Firestore Database → Rules** in the Firebase console.
2. Replace the entire contents with the contents of `firestore.rules`.
3. Click **Publish**.

The rules include:
- Phase 1 public create rule (unchanged, plus optional `gradeSection` field)
- `isStaff()` helper function
- `isAdmin()` helper function (checks staff document `role == 'admin'`)
- `isParent()` helper function
- `isGuardianOf(resource)` helper function
- Staff read access to their own document only
- Staff read (get/list) access to students
- Staff update access to students: only `approved`, `approvedAt`, `approvedBy` fields, only when `approved == false`, with strict field validation
- Staff delete access to students: only when `approved == false`
- Phase 3 attendance collection rules
- Phase 4 notifications collection rules
- Phase 5 parent read access to students and attendance (via `isGuardianOf` with email equality)
- Phase 6A settings document rules:
  - Read: any signed-in user
  - Write: admin staff only, with strict validation of dates, times, schoolDays, holidays
- No deletes for settings, attendance, notifications

### How the equality queries work (Phase 5/6A)

The rules for parent read access use:
```javascript
resource.data.guardianEmail == request.auth.token.email.lower()
```

This is a valid Firestore query because:
- The `guardianEmail` field is stored in lowercase (normalized during registration).
- The Firebase Auth token's `email` field is already normalized to lowercase.
- The equality filter (`==`) on a single field makes this a valid index-free query.
- The composite query for students adds `approved == true`, which is also an equality filter.

For attendance, the parent query uses:
```javascript
where("guardianEmail", "==", email)  // equality
where("logDay", "==", todayLogDay)   // equality
```

Both are equality filters, so no composite index is needed for the "Today" view.

For the History view, the query uses:
```javascript
where("guardianEmail", "==", email)  // equality
where("logDay", ">=", firstLogDay)   // range
where("logDay", "<=", lastLogDay)    // range
```

This requires a composite index on `(guardianEmail ASC, logDay ASC)`. See the **Indexes** section below.

## 4. Run with VS Code Live Server

1. Open this folder in VS Code.
2. Install the **Live Server** extension if it is not already installed.
3. Open `index.html`, right-click in the editor, and choose **Open with Live Server**.
4. Use the local URL opened by Live Server (usually `http://127.0.0.1:5500`). Opening the file directly as `file://` will not work with JavaScript modules.

**Important:** If login fails on Live Server's address (e.g., `http://127.0.0.1:5500`), add `127.0.0.1` under **Firebase Authentication → Settings → Authorized domains** in the Firebase console.

**Camera note:** The scanner requires a camera and a secure context. `localhost` (127.0.0.1) and HTTPS origins are secure contexts. The scanner will not work on plain HTTP origins other than localhost. If testing on a phone, use HTTPS (e.g., via ngrok, Cloudflare Tunnel, or deploy to Firebase Hosting) or run Live Server on the phone's network IP with a self-signed certificate — but the simplest path is to run Live Server on the laptop and show the QR code from the phone screen to the laptop's webcam.

## 5. Phase 4: Email notifications via Google Apps Script

### 5.1 Create the Apps Script project

1. Go to [script.google.com](https://script.google.com/).
2. Click **New project**.
3. Name it (e.g., "School Attendance Email Sender").
4. Delete the default `Code.gs` content and paste the entire contents of `apps-script/Code.gs`.
5. Save (Ctrl+S).

### 5.2 Set Script Properties

In the Apps Script editor:
1. Click the **gear icon (Project Settings)** on the left sidebar.
2. Scroll to **Script properties** and click **Add script property**.
3. Add these three properties:
   - `FIREBASE_API_KEY`: Your Firebase Web API Key (from Project settings → General → Your apps → Web app config → `apiKey`).
   - `FIREBASE_PROJECT_ID`: Your Firebase project ID (from Project settings → General → Project ID).
   - `EMAIL_DRY_RUN`: Set to `"true"` for testing (skips actual email sending, marks notification as `skipped`). Set to `"false"` for production.
4. Save.

**No secrets in the code.** The API key and project ID are stored in Script Properties, not in the source.

### 5.3 Deploy as a Web App

1. Click **Deploy** → **New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Configuration:
   - **Description**: "Attendance email sender v1"
   - **Execute as**: **Me** (your Google account)
   - **Who has access**: **Anyone**
4. Click **Deploy**.
5. Authorize the script when prompted (it needs Gmail send permission).
6. Copy the **Web App URL** (looks like `https://script.google.com/macros/s/AKfycb.../exec`).

**Important:** Every time you change the Apps Script code, you must create a **new deployment version** (Deploy → Manage deployments → click the pencil icon → New version → Deploy). The old URL continues to serve the old version until you update it.

### 5.4 Configure the website

1. Open `js/firebase-config.js`.
2. Replace `YOUR_APPS_SCRIPT_WEB_APP_URL` with the Web App URL you copied.
3. Save.

### 5.5 Email quota limits

- **gmail.com** (personal) accounts: **100 emails/day** (MailApp quota).
- **Google Workspace** accounts: higher limits (1,500/day or more depending on edition).
- The script checks `MailApp.getRemainingDailyQuota()` before sending. If quota is exhausted, the notification status becomes `failed` with `lastError: "Daily email limit reached"`.
- Use `EMAIL_DRY_RUN=true` during development to test without consuming quota.

## 6. Phase 5: Parent email-link login

### 6.1 Enable Email link sign-in in Firebase Console

1. Open **Authentication → Sign-in method**.
2. Click **Email/Password**.
3. Enable **Email link (passwordless sign-in)**.
4. Save.

### 6.2 How parent login works

- `parent-login.html`: Enter email → click "Send me a login link" → Firebase sends an email with a sign-in link.
- The link points back to `parent-login.html` with a code in the URL.
- On page load, if `isSignInWithEmailLink` is true, the code reads the email from `localStorage` (same device) or prompts for it (other device), then calls `signInWithEmailLink`.
- On success, redirects to `parent.html`.
- 60-second cooldown on the "Send link" button.
- Same message always shown: "If this email is registered with the school, check your inbox (and spam) for the link." (Prevents email enumeration.)
- Link from `login.html` (staff) to `parent-login.html` and vice versa.

### 6.3 Same-device vs other-device behaviour

- **Same device**: Email is stored in `localStorage` before sending the link. When the link is opened, the email is retrieved automatically.
- **Other device**: `localStorage` is empty, so a `prompt()` asks for the email. This is a fallback; for production consider a more user-friendly input.

### 6.4 Notes

- Sign-in emails can land in **spam/junk** folders. Advise parents to check there.
- Firebase limits how many sign-in emails it sends per IP/account per hour. The 60-second cooldown helps, but if you hit the limit, wait and try again.
- The parent portal is read-only. Parents cannot access `approvals.html`, `scanner.html`, or `settings.html` (the staff guard checks for a staff document with `role`).

## 7. Phase 6A: School calendar, late/absent logic, and full parent portal

### 7.1 Settings document (`settings/school`)

A single document at `settings/school` controls the school calendar:

| Field | Type | Description |
|-------|------|-------------|
| `schoolYearStart` | string (YYYY-MM-DD) | First day of school year |
| `schoolYearEnd` | string (YYYY-MM-DD) | Last day of school year |
| `schoolDays` | array of int (1-7) | 1=Monday ... 7=Sunday. Default: `[1,2,3,4,5]` |
| `lateAfter` | string (HH:MM) | Time after which arrival is "late". Default: `"08:00"` |
| `absentAfter` | string (HH:MM) | Time after which no-arrival is "absent". Default: `"10:00"` |
| `holidays` | array of string (YYYY-MM-DD) | Non-school days. Max 100. |
| `updatedAt` | timestamp | Server timestamp (auto) |
| `updatedBy` | string | Staff UID (auto) |

If the document doesn't exist, the code uses defaults: Monday-Friday, lateAfter 08:00, absentAfter 10:00, no holidays, school year = current calendar year.

### 7.2 Status rules (shared in `js/school-calendar.js`)

The function `getDayStatus()` returns one of:

| Status | When |
|--------|------|
| `no_class` | Weekend (not in `schoolDays`), holiday, outside school year, before student's approval date, or future day |
| `present` | School day with time-in at or before `lateAfter` |
| `late` | School day with time-in after `lateAfter` (counts as attended) |
| `absent` | Past school day with no time-in, OR today after `absentAfter` with no time-in |
| `not_yet_in` | Today (school day), before `absentAfter`, no time-in yet |

Additional flag: `missingTimeOut = true` when a past day has time-in but no time-out.

### 7.3 Settings page (`settings.html`)

- Admin only (staff with `role == 'admin'`). Non-admins see "Admins only" with a link back.
- Form for all settings fields: date inputs, time inputs, day checkboxes, holiday list with add/remove.
- Validation: end after start, `lateAfter` before `absentAfter`, valid dates, max 100 holidays.
- Saves with `serverTimestamp()`; loads current values on open.
- **Settings** link added to staff nav (visible to admins only).

### 7.4 Registration: optional Grade and section

- `index.html` and `js/app.js`: added optional "Grade and section" field (max 40 chars).
- Written as `gradeSection` only when filled in.
- Firestore rules allow it as an optional field in the student create rule.

### 7.5 Parent portal (`parent.html` + `js/parent.js`)

- Guard: waits for `onAuthStateChanged`; redirects to `parent-login.html` if no user or email not verified.
- Header: parent's email + Sign out button.
- Loads `settings/school` (or defaults) and approved children (guardianEmail equality + approved == true).
- Child switcher (dropdown) when more than one child.

**Three tabs per child:**

1. **Today** (live via `onSnapshot`):
   - Status card with `present`/`late`/`absent`/`not_yet_in`/`no_class`.
   - Shows arrival/departure times.
   - Shows "No time-out" warning when applicable.

2. **History** (month picker):
   - Previous/Next month buttons, default current month.
   - Query: `where('guardianEmail','==', email) AND where('logDay','>=', firstDay) AND where('logDay','<=', lastDay)`.
   - Filters by `studentId` in JavaScript.
   - One row per calendar day: date, weekday, In time, Out time, status chip.
   - Chips show text + color: Present, Late, Absent, No class, Not yet in.
   - "No time-out" note when applicable.

3. **Summary** (for chosen month):
   - Cards: school days, present, late, absent, attendance rate (%).
   - Lists of late dates and absent dates.

### 7.6 Composite index for History query

The History query needs a composite index:

```
Collection: attendance
Fields: guardianEmail (Ascending), logDay (Ascending)
```

**File:** `firestore.indexes.json` (commit this to your repo).

**First-time setup:** When you first run the History query, the browser console will show a link like:
```
https://console.firebase.google.com/v1/r/project/.../firestore/indexes?create_composite=...
```
Click it to create the index in the Firebase Console. Wait a few minutes for the index to build (status changes from "Building" to "Enabled"). After that, the query will work.

### 7.7 Calendar tests

Open `tests/calendar-tests.html` with Live Server. It imports `js/school-calendar.js` and runs assertions, printing PASS/FAIL per test. Covers:
- Saturday → no_class
- Holiday → no_class
- Day before approval → no_class
- Past school day, no time-in → absent
- Time-in 07:55 with lateAfter 08:00 → present
- Time-in 08:01 → late
- Today before absentAfter, no time-in → not_yet_in
- Today after absentAfter, no time-in → absent
- Past day with time-in, no time-out → missingTimeOut
- `summarize()` counts

## 8. Manual test list

### Phase 1 (student registration)
- [ ] With valid names, guardian email, consent, and no phone, submit the form. Confirm a student document is created and the QR appears.
- [ ] Confirm the document ID equals its `id` field and the QR payload is that ID only. Confirm the document has exactly the allowed fields, `approved` is `false`, `consent` is `true`, and the server timestamp is set.
- [ ] Submit phone numbers in `09XXXXXXXXX` and `+639XXXXXXXXX` formats. Confirm both are stored as `639XXXXXXXXX`.
- [ ] Try a malformed phone number, invalid email, names shorter than 2 or longer than 100 characters, and missing consent. Confirm each receives a clear validation message and no record is written.
- [ ] Try entering text in the hidden honeypot field in browser developer tools and submit; confirm the form rejects it without writing a record.
- [ ] Click submit repeatedly while a request is pending. Confirm the button is disabled and only one record is created.
- [ ] After a successful registration, confirm the form is no longer available, the approval note is shown, and the QR image can be downloaded as PNG.
- [ ] Use the Print button and confirm the print view shows the QR and student's name.
- [ ] In the Firestore Rules playground or with a test client, confirm unauthenticated reads, updates, deletes, extra fields, invalid IDs, and malformed values are denied.
- [ ] Fill in "Grade and section" (e.g., "Grade 7 - St. Francis"). Confirm it appears in the student document as `gradeSection`.
- [ ] Leave "Grade and section" empty. Confirm no `gradeSection` field is written (or is null).

### Phase 2 (staff approvals)
- [ ] Open `login.html` in Live Server. Sign in with a staff email/password. Confirm redirect to `approvals.html`.
- [ ] Try signing in with a non-staff Firebase Auth user. Confirm "This account is not authorized." appears and user is signed out.
- [ ] Try wrong password. Confirm "Incorrect email or password." message.
- [ ] Try too many failed attempts. Confirm "Too many failed attempts. Please try again later." message.
- [ ] On `approvals.html`, confirm the nav bar shows "Approvals", "Scanner", "Settings" (if admin), "Sign out", and the staff member's name.
- [ ] Confirm pending registrations load (approved == false), sorted newest first, limited to 200.
- [ ] For each row, confirm: student name, guardian name, guardian email, guardian phone (or "—"), registration time in Asia/Manila 12-hour format.
- [ ] Click **Approve** on a registration. Confirm: button disables, shows "Approving…", row removes on success, status message shows "Approved: [name]".
- [ ] In Firestore, confirm the document now has `approved: true`, `approvedAt` (server timestamp), `approvedBy` (staff UID).
- [ ] Click **Reject** on a registration. Confirm: confirm dialog appears, button disables, shows "Rejecting…", row removes on success, status message shows "Rejected: [name]".
- [ ] In Firestore, confirm the document is deleted.
- [ ] Click **Refresh**. Confirm list reloads.
- [ ] When no pending registrations exist, confirm "No pending registrations" message shows and table is hidden.
- [ ] Try approving/rejecting a record that was already approved (simulate race condition). Confirm a clear error message appears.
- [ ] Click **Sign out**. Confirm redirect to `login.html` and session ends.
- [ ] Open `approvals.html` directly without signing in. Confirm redirect to `login.html`.
- [ ] In Firestore Rules playground, test:
  - [ ] Unauthenticated read of students → denied
  - [ ] Unauthenticated update of students → denied
  - [ ] Authenticated non-staff read of students → denied
  - [ ] Staff update changing fields other than approved/approvedAt/approvedBy → denied
  - [ ] Staff update when approved == true → denied
  - [ ] Staff delete when approved == true → denied
  - [ ] Staff list of staff collection → denied
  - [ ] Staff write to staff collection → denied

### Phase 3 (attendance scanner)
- [ ] Open `scanner.html` in Live Server while signed in as staff. Confirm redirect to `scanner.html` (not `login.html`).
- [ ] Confirm nav bar shows "Scanner" (active), "Approvals", "Settings" (if admin), "Sign out", and staff name.
- [ ] Confirm Time In button is green, pressed (`aria-pressed="true"`); Time Out button is amber, not pressed.
- [ ] Click Time Out button. Confirm it becomes pressed and amber; Time In becomes unpressed.
- [ ] Click Time In button. Confirm it becomes pressed and green; Time Out becomes unpressed.
- [ ] Camera starts automatically. Confirm rear camera is used first (label shows "Switch to front camera").
- [ ] Click camera switch button. Confirm camera switches; button label updates accordingly.
- [ ] Deny camera permission in browser, reload. Confirm helpful message: "Camera permission denied. Please allow camera access in your browser settings and reload."
- [ ] With no camera connected, reload. Confirm helpful message: "No camera found. Please connect a camera and reload."
- [ ] Register a student (Phase 1), approve them (Phase 2). Note the student's UUID.
- [ ] Display the student's QR code on a phone screen (open the registration result page on the phone, or generate a QR from the UUID at a QR generator site).
- [ ] Point the laptop webcam at the phone screen. Confirm scan succeeds.
- [ ] After scan, confirm green result card shows: "Juan Dela Cruz, Time In recorded" with time in 12-hour Asia/Manila format.
- [ ] Confirm "Today's logs" table updates live with the new entry (student name, Time In, time).
- [ ] Scan the same QR again within 3 seconds. Confirm it is ignored (no duplicate write, no message).
- [ ] Scan the same QR after 3 seconds. Confirm amber message: "Already timed in today at HH:MM" and no new document written.
- [ ] Switch to Time Out mode. Scan the same QR. Confirm green result card shows "Juan Dela Cruz, Time Out recorded" with time.
- [ ] Confirm "Today's logs" now shows both Time In and Time Out entries, newest first.
- [ ] Scan again in Time Out mode. Confirm amber message: "Already timed out today at HH:MM".
- [ ] Try scanning an unapproved student's QR. Confirm red message: "Student registration not approved".
- [ ] Try scanning a random non-UUID text QR. Confirm red message: "Not a valid student QR".
- [ ] Try scanning a valid UUID that doesn't exist in Firestore. Confirm red message: "Student not found".
- [ ] Try Time Out before Time In for a student. Confirm amber message: "No time in recorded today".
- [ ] In Firestore, verify attendance documents have deterministic IDs: `studentId_time_in_logDay` and `studentId_time_out_logDay`.
- [ ] In Firestore, verify attendance documents have exactly the allowed fields: `studentId`, `type`, `logDay`, `studentName`, `guardianEmail`, `scannedBy`, `createdAt`.
- [ ] In Firestore, verify `createdAt` is a server timestamp, `logDay` matches Asia/Manila day, `scannedBy` is the staff UID.
- [ ] Open `scanner.html` directly without signing in. Confirm redirect to `login.html`.
- [ ] Click **Sign out** on scanner page. Confirm redirect to `login.html` and session ends.
- [ ] In Firestore Rules playground, test:
  - [ ] Unauthenticated read of attendance → denied
  - [ ] Unauthenticated create of attendance → denied
  - [ ] Authenticated non-staff create of attendance → denied
  - [ ] Staff create with extra fields → denied
  - [ ] Staff create with invalid type → denied
  - [ ] Staff create with wrong logDay (not matching server time) → denied
  - [ ] Staff create with wrong docId → denied
  - [ ] Staff create with wrong scannedBy → denied
  - [ ] Staff create for non-existent student → denied
  - [ ] Staff create for unapproved student → denied
  - [ ] Staff create with mismatched studentName/guardianEmail → denied
  - [ ] Staff create time_out without time_in for same day → denied
  - [ ] Staff update attendance → denied
  - [ ] Staff delete attendance → denied

### Phase 4 (email notifications)
- [ ] Set `EMAIL_DRY_RUN=true` in Apps Script properties. Deploy a new version.
- [ ] In `js/firebase-config.js`, set `APPS_SCRIPT_URL` to your deployed Web App URL.
- [ ] Open `scanner.html`, sign in as staff.
- [ ] Scan an approved student's QR (Time In). Confirm:
  - Green result card appears with student name, type, time.
  - Below the time, "Sending email…" appears briefly.
  - Then "Email skipped (test mode)" appears in green.
  - In Firestore, check `notifications/{attendanceId}`: status is `skipped`, attempts=1, createdAt/updatedAt set.
- [ ] In "Today's logs" table, confirm the new row shows an "Email status" column with badge "Skipped (test)".
- [ ] Change `EMAIL_DRY_RUN=false` in Apps Script properties. Deploy a new version.
- [ ] Scan another student (or Time Out for the same student). Confirm:
  - "Sending email…" appears briefly.
  - Then "Email sent" appears in green.
  - In Firestore, notification status is `sent`, `sentAt` set.
  - Guardian receives an email with subject "Attendance Alert: Student Arrival" or "Attendance Alert: Student Departure".
  - Email body contains student name (HTML-escaped), date (Month D, YYYY), time (h:mm AM/PM) in Asia/Manila.
- [ ] In "Today's logs", confirm email status badge shows "Sent" (green).
- [ ] Test retry: In Firestore, manually set a notification's status to `failed`, attempts=1, lastError="test". Reload scanner page. Confirm the row shows "Failed (1/3)" and a "Retry" button.
- [ ] Click "Retry". Confirm status changes to "Sending…" then "Sent" (or "Failed" if quota exhausted).
- [ ] Test quota exhaustion: Set `EMAIL_DRY_RUN=false`, send emails until quota runs out (or simulate by setting quota check). Next scan should show "Email failed: Daily email limit reached" and notification status `failed`.
- [ ] Test idempotency: With `EMAIL_DRY_RUN=false`, scan a student, wait for "Email sent", then immediately scan the same student again (should show "Already timed in…" — no new attendance, no new email). Verify only one email was sent.
- [ ] Test Apps Script crash recovery: In Firestore, manually set a notification status to `sending`, updatedAt to 5 minutes ago. Reload scanner page. The row should show "Sending…" briefly then the listener should trigger a retry (since > 2 min stale) and eventually show "Sent" or "Failed".
- [ ] In Firestore Rules playground, test notifications rules:
  - [ ] Unauthenticated read of notifications → denied
  - [ ] Unauthenticated create of notifications → denied
  - [ ] Authenticated non-staff create of notifications → denied
  - [ ] Staff create without matching attendance doc → denied
  - [ ] Staff create with extra fields → denied
  - [ ] Staff create with status != 'sending' → denied
  - [ ] Staff create with attempts != 1 → denied
  - [ ] Staff create with createdAt != request.time → denied
  - [ ] Staff update from 'sent' to anything → denied
  - [ ] Staff update from 'skipped' to anything → denied
  - [ ] Staff update changing fields other than status/attempts/lastError/updatedAt/sentAt → denied
  - [ ] Staff retry from 'failed' with attempts >= 3 → denied
  - [ ] Staff retry from 'sending' updated < 2 min ago → denied
  - [ ] Staff update 'sending' → 'sent' without sentAt == request.time → denied
  - [ ] Staff delete notifications → denied

### Phase 5 (parent email-link login)
- [ ] Open `parent-login.html` in Live Server. Enter a guardian email that exists in an approved student record. Click "Send me a login link". Confirm the generic message appears and button starts 60s cooldown.
- [ ] Check email inbox (and spam). Click the link. Confirm redirect to `parent.html` and the parent's email shows in the header.
- [ ] Open `parent.html` directly without signing in. Confirm redirect to `parent-login.html`.
- [ ] Click **Sign out** on parent page. Confirm redirect to `parent-login.html` and session ends.
- [ ] Try signing in with an email not linked to any approved student. Confirm `parent.html` shows "No approved students are linked to this email yet."
- [ ] Try opening the link on a different device (or incognito). Confirm it prompts for the email, then signs in.
- [ ] In Firestore Rules playground, test:
  - [ ] Unauthenticated read of students → denied
  - [ ] Unauthenticated read of attendance → denied
  - [ ] Authenticated parent read of their own approved student → allowed
  - [ ] Authenticated parent read of another guardian's student → denied
  - [ ] Authenticated parent read of unapproved student → denied
  - [ ] Authenticated parent read of attendance for their student → allowed
  - [ ] Authenticated parent read of attendance for another student → denied

### Phase 6A (school calendar, late/absent, full parent portal)
- [ ] Sign in as admin staff. Confirm "Settings" link appears in the staff nav bar.
- [ ] Open `settings.html`. Confirm all fields load with defaults (Mon-Fri, 08:00/10:00, no holidays, current year).
- [ ] Change school year start/end, days, times, add holidays. Save. Confirm success message.
- [ ] Reload `settings.html`. Confirm values persist.
- [ ] Try saving with end date before start date. Confirm validation error.
- [ ] Try saving with lateAfter after absentAfter. Confirm validation error.
- [ ] Try adding >100 holidays. Confirm validation error.
- [ ] Sign in as non-admin staff. Open `settings.html`. Confirm "Admins only" message with link back.
- [ ] Register a student with "Grade and section" filled. Approve. Sign in as that parent. Confirm grade shows in Today tab.
- [ ] Open `parent.html` as a parent with multiple children. Confirm child switcher dropdown works.
- [ ] **Today tab**: Scan a student's QR. Confirm parent portal shows "Arrived at HH:MM AM" (green "Present" chip) or "Late" (amber chip) based on `lateAfter`.
- [ ] Wait past `absentAfter` without scanning. Confirm Today tab shows "Absent" (red chip).
- [ ] **History tab**: Confirm month picker shows current month. Click Previous/Next month. Confirm rows load for each calendar day.
- [ ] Verify status chips show correct text and color: Present (green), Late (amber), Absent (red), No class (gray), Not yet in (blue).
- [ ] For a past day with time-in but no time-out, confirm "No time-out" note appears.
- [ ] **Summary tab**: Confirm cards show correct counts (school days, present, late, absent, rate%).
- [ ] Confirm late dates list and absent dates list match the data.
- [ ] Run `tests/calendar-tests.html` with Live Server. Confirm all tests PASS.
- [ ] In Firestore Rules playground, test settings rules:
  - [ ] Unauthenticated read of settings → denied
  - [ ] Unauthenticated write of settings → denied
  - [ ] Signed-in parent read of settings → allowed
  - [ ] Non-admin staff write of settings → denied
  - [ ] Admin staff write with valid data → allowed
  - [ ] Admin staff write with end before start → denied
  - [ ] Admin staff write with lateAfter >= absentAfter → denied
  - [ ] Admin staff write with invalid date format → denied
  - [ ] Admin staff write with invalid time format → denied
  - [ ] Admin staff write with schoolDays containing 0 or 8 → denied
  - [ ] Admin staff write with >100 holidays → denied
  - [ ] Admin staff write with updatedAt != request.time → denied
  - [ ] Admin staff write with updatedBy != request.auth.uid → denied
  - [ ] Delete settings → denied
- [ ] Deploy `firestore.indexes.json` (or click the console link from the first History query run). Wait for index to build. Confirm History tab works without "failed-precondition" error.

## Files created/changed in Phase 6A

**Created:**
- `js/school-calendar.js` — Shared pure functions for date helpers, status logic, summaries.
- `tests/calendar-tests.html` — Browser-based test suite for calendar logic.
- `settings.html` — Admin-only settings page.
- `js/settings.js` — Settings page logic.
- `firestore.indexes.json` — Composite index definition for attendance queries.

**Modified:**
- `firestore.rules` — Added `isAdmin()`, `isParent()`, `isGuardianOf()` helpers; settings document rules; optional `gradeSection` in student create.
- `index.html` — Added optional "Grade and section" field.
- `js/app.js` — Validates and writes `gradeSection`.
- `parent.html` — Full portal with Today/History/Summary tabs, child switcher, month picker.
- `js/parent.js` — Complete portal logic using `school-calendar.js`.
- `css/styles.css` — Styles for settings page, parent portal tabs, history table, status chips, summary cards, child switcher.
- `README.md` — This file, updated with Phase 6A documentation.

## What I could NOT test

- **Firebase Console operations** — Creating the composite index, deploying rules, setting up staff documents, enabling Email link sign-in, Apps Script deployment.
- **End-to-end flows** — Full registration → approval → scan → email → parent portal view.
- **Cross-device parent login** — Opening the sign-in link on a different device.
- **Email delivery** — Actual Gmail sending (quota, spam folder, formatting).
- **Camera/scanner** — Requires physical camera and HTTPS/localhost.
- **Live Server with multiple users** — Concurrent staff and parent sessions.
- **Firestore Rules Playground tests** — Need the Firebase Console.
- **Index building** — Waiting for the composite index to become "Enabled".
- **Long-running listeners** — `onSnapshot` over hours/days.

All code is plain HTML/CSS/JS with pinned Firebase SDK `13.1.0`, no npm, no build step.

## Phase 6B — Staff pages (dashboard, reports, students)

Phase 6B adds three staff-only pages (guard: `js/auth-guard.js`, signed-in `staff/{uid}` document required):

- **`dashboard.html` + `js/dashboard.js`** — Today's dashboard: summary cards (Approved, Arrived, Late, Left, Not yet in / Absent, Pending approvals), a filterable student list (tabs All/Arrived/Late/Not yet in/Absent/Left, name search, grade/section filter), guardian contact for absent/not-yet-in students, and an email-problems panel (missing/failed/stuck notifications) with Retry buttons calling `requestEmail`.
- **`reports.html` + `js/reports.js`** — Attendance reports for a from/to date range (max 93 days, validated), grouped per student with school days, present, late, absent, missing time-out, and attendance rate. Sortable table, rates below 90% flagged "(Low)", per-student day detail, Export CSV and Print (A4, nav/filters hidden).
- **`students.html` + `js/students.js`** — Approved student list with search/grade filter, per-student "Show QR" dialog (QR value = document id, same pinned `qrcodejs@1.0.0`), multi-select with "Select all (filtered)" and "Print QR cards" (A4 grid with cut lines, school name from settings if present).

**Shared:** `js/email.js` already holds `requestEmail(attendanceId)` (imported by `scanner.js` and the new pages); `js/nav.js` renders the shared staff nav on every staff page; `js/csv.js` provides `toCsv(rows)` and `downloadCsv(filename, rows)` with field quoting, doubled inner quotes, formula-injection neutralisation, and a UTF-8 BOM.

### Report limits and quotas

- **Max date range: 93 days** (client validation). The attendance query is a single-field range filter on `logDay` (`>=` from, `<=` to), so no composite index is needed.
- **Document reads:** reports read every attendance document in range (a note shows the exact count); the dashboard reads up to 2,000 approved students; the students page reads all approved students. Budget against the Firebase Spark free quota (50,000 reads/day).
- **Pending approvals count** uses a `count()` aggregation (1 document read).

### Guardian emails

Guardian email/phone cannot be edited on any staff page. They are captured at registration and treated as read-only contact data; staff pages only display them (absent/not-yet-in rows, reports context) so guardians can be contacted.

### Manual test list

- Open `dashboard.html`, `reports.html`, `students.html` as staff → shared nav with all links, current page highlighted, mobile wrap works.
- Sign out / non-staff → redirected to `login.html`; teacher vs admin → Settings link hidden/shown.
- Dashboard: cards match today's logs; tabs/search/grade filter work; guardian contact shows for Absent/Not yet in; 2,000-student truncation warning shows when applicable.
- Email panel: green "All emails sent" when none; Retry shows "Retrying…" and calls `requestEmail`.
- Reports: > 93 days rejected; date change regenerates; headers sort; rate < 90% shows "(Low)"; student click opens day detail; Export CSV downloads with BOM (Excel-safe); Print preview hides nav/filters and fits A4.
- Students: search/filter work; Show QR dialog shows document id; Download PNG saves an image; Print prints one QR card; multi-select prints an A4 card grid with cut lines.
- `tests/calendar-tests.html` and `tests/csv-tests.html`: all PASS.

### Firebase rules

No rule changes are needed for Phase 6B: staff can already read `students`, `attendance`, and `notifications`.


## Known limitations

The following audit findings are acknowledged as deferred. They are not fixed in this version.

- **A11 (Cost/Performance)** — Staff pages load full result sets without pagination; dashboard uses unbounded listeners. Read costs scale with enrollment and daily activity. Deferred because implementing server-side pagination and listener lifecycle management requires significant refactoring of the data layer and UI components.

- **A12 (Privacy/Retention)** — No documented retention/deletion workflow exists; attendance and notifications are immutable in rules. Deferred because a retention policy requires legal/privacy review and an authorized administrative mechanism (e.g., Admin SDK scripts) that is outside the scope of the client application.

- **A13 (Browser Storage)** — Parent login email persists in `localStorage` until successful sign-in. On shared devices, another user may see the prior guardian email. Deferred as low-risk (email only, not a token); a proper fix would use `sessionStorage` or explicit clearing, which requires UX consideration for the cross-device login flow.

- **A18 (Third-Party Script Integrity)** — External scripts (QRCode.js, html5-qrcode) are version-pinned but lack Subresource Integrity (SRI) hashes. Deferred because SRI requires known-good hashes for each version and the scanner CDN URL (html5-qrcode) currently returns 404; self-hosting reviewed assets is the robust fix but adds maintenance overhead.

- **A19 (Hosting/Setup)** — No `firebase.json` exists in the workspace; Hosting configuration (headers, rewrites, public-file exclusions) is undefined. Deferred because deployment is not managed from this workspace; a proper `firebase.json` should be added and reviewed before any Hosting deployment.


## 9. Design System

This project uses a unified, accessible design system implemented in plain CSS (`css/styles.css`) and JavaScript modules without any npm packages, frameworks, or build steps.

### 9.1 Design Tokens

All visual tokens are defined as CSS variables on `:root` in `css/styles.css`:

#### Colors
- **Ink**: `#12263A` (`--ds-ink`) — Main brand dark color used for headers, primary headings, and high-contrast text.
- **Paper**: `#F4F6F8` (`--ds-paper`) — Page background color.
- **Card**: `#FFFFFF` (`--ds-card`) — Surface color for cards, dialogs, and elevated panels.
- **Border**: `#C3CEDA` (`--ds-border`) — Standard hairline borders and dividers.
- **Text**: `#12263A` (`--ds-text`) — Primary body text color.
- **Text Soft**: `#3A4E63` (`--ds-text-soft`) — Secondary body copy.
- **Text Muted**: `#55697E` (`--ds-text-muted`) — Subtitles, captions, and table metadata.
- **Primary Green**: `#0F7A61` (`--ds-primary`) — Primary action buttons, active navigation states, and positive badges (tested to exceed 4.5:1 text contrast with white text).
- **Mint**: `#7FD6BE` (`--ds-mint`) — Accent on dark surfaces (logo stroke, "Open scanner" pill button, camera corner brackets).
- **Scanner Background**: `#0B1722` (`--ds-scanner-bg`) — Dark background for the gate scanner interface.
- **Scanner Panel**: `#16283A` (`--ds-scanner-panel`) — Camera enclosure surface.
- **Scanner Panel 2**: `#13202D` (`--ds-scanner-panel-2`) — Segmented mode toggle surface.
- **Amber Accent**: `#F2B15C` (`--ds-amber`) — Time Out active state and warnings.
- **Danger**: `#9B1C1C` (`--ds-danger`) — Rejections, failed states, and destructive action outlines.

#### Status Chips (Text AND Color)
Status chips always display both clear text and distinct background/text colors (never color alone):
- **Present / Sent**: Background `#D8F2EA`, Text `#0B5C48` (`.chip--present`, `.chip--sent`)
- **Late / Out / Retry**: Background `#FBEBD3`, Text `#8A4A0B` (`.chip--late`, `.chip--out`, `.chip--retry`)
- **Absent / Failed**: Background `#FBE0E0`, Text `#9B1C1C` (`.chip--absent`, `.chip--failed`, `.chip--low`)
- **No class / Skipped**: Background `#E4EAF0`, Text `#3A4E63` (`.chip--no-class`, `.chip--skipped`)
- **Not yet in / Sending**: Background `#E3ECF8`, Text `#1F4E8C` (`.chip--not-yet-in`, `.chip--sending`)

#### Typography
- **Heading Font**: `"Bricolage Grotesque"`, 600/700 weight for page titles, section headers, numbers, and stat-card figures.
- **Body Font**: `"Figtree"`, 400–700 weight for labels, controls, body copy, and tables.
- **Fallbacks**: `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
- **Base Size**: 16px, Line Height: 1.45.

#### Shape & Sizing
- **Corner Radius**: 10px (`--ds-radius`) for inputs and buttons; 14–16px (`--ds-radius-card`) for cards.
- **Touch Targets**: Minimum 44px tall everywhere; minimum 48px tall on mobile screens (`max-width: 600px`).
- **Focus Rings**: High-contrast 2px solid primary green outline with 2px offset (`:focus-visible`).
- **Motion**: Animations and transitions respect `prefers-reduced-motion: reduce`.

### 9.2 Shared Components

- **`.site-header`**: Dark `#12263A` header band containing the mint logo mark, small caps letter-spaced school name, page title in Bricolage (28–30px), and subtitle (`#B9C7D6`).
- **`.nav-bar`**: Centralized staff navigation (`js/nav.js`) with role-filtered links, mint "Open scanner" button, and sign out button; collapses to a horizontal scroll row on mobile.
- **`.card`**: Clean white surface with 1px border (`#C3CEDA`), 16px radius, and subtle elevation shadow.
- **`.field`**: Standard form field with label above input, error text (`.field-error`), and helper hints (`.field-hint`).
- **`.btn-primary`**: Green button (`#0F7A61`) with white text.
- **`.btn-secondary`**: White button with dark ink border (`#12263A`) and text.
- **`.btn-danger-outline`**: Transparent button with `#9B1C1C` border and text.
- **`.btn--mint`**: Mint-accented button with dark ink text.
- **`.segmented`**: Accessible pill toggle container for scan modes and view switchers.
- **`.stat-card`**: Dashboard and summary widget with uppercase small label and 40px Bricolage number.
- **`.table-wrapper` & `table`**: Horizontally scrollable wrapper with sticky light header row (`#F4F6F8`) and hairline cell dividers.
- **`.empty-state`**: Centered text-muted status placeholder.
- **Logo Mark**: Inline SVG (`stroke="currentColor"`) matching the design system specifications.

### 9.3 Changing School Name and Colors in One Place

#### Changing School Name
1. Open `js/site-config.js`.
2. Update the `SCHOOL_NAME` export:
   ```javascript
   export const SCHOOL_NAME = "Your School Name Here";
   ```
   This automatically updates the header on every page using safe `textContent`.
3. In Google Apps Script, update the Script Property `SCHOOL_NAME` under **Project Settings → Script properties** (defaults to `"School"`).

#### Changing Colors
1. Open `css/styles.css`.
2. Update the CSS variables at the top under `:root`:
   ```css
   :root {
     --ds-primary: #0F7A61;  /* Change primary green accent */
     --ds-ink: #12263A;      /* Change dark header and text */
     --ds-mint: #7FD6BE;     /* Change dark-mode accent */
     /* ... */
   }
   ```
   All components, headers, buttons, cards, and chips inherit from these tokens.

### 9.4 Apps Script Deployment Reminder

> [!IMPORTANT]
> Whenever you change `apps-script/Code.gs`, you **must create a new deployment version** in the Google Apps Script editor:
> 1. In Apps Script, click **Deploy** → **Manage deployments**.
> 2. Click the **pencil icon (Edit)** next to the active deployment.
> 3. Under **Version**, select **New version**.
> 4. Click **Deploy**.
> If you omit this step, the Web App URL will continue executing the older version of the script.
