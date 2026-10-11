-- Phase 3: Attendance logging
-- Run AFTER sql/001_initial_schema.sql and sql/002_teacher_access.sql
--
-- Adds a stable per-day grouping column, a uniqueness guard to prevent
-- duplicate time_in / time_out per student per day, Phase-4 SMS columns, and
-- strict Row Level Security on attendance_logs.

-- log_date: the calendar day in Asia/Manila derived from created_at.
-- Using a generated column makes it tamper-proof on insert.
alter table public.attendance_logs
  add column if not exists log_date date generated always as (
    (created_at at time zone 'Asia/Manila')::date
  ) stored;

-- Phase 4 SMS columns (written by a server function later, never by clients).
alter table public.attendance_logs
  add column if not exists sms_status text not null default 'pending'
    check (sms_status in ('pending', 'sent', 'failed', 'skipped'));
alter table public.attendance_logs
  add column if not exists sms_sent_at timestamptz;
alter table public.attendance_logs
  add column if not exists sms_error text;

-- At most one time_in and one time_out per student per day.
create unique index if not exists attendance_logs_student_type_date_idx
  on public.attendance_logs (student_id, type, log_date);

-- Indexes to support today's teacher view.
create index if not exists attendance_logs_log_date_idx on public.attendance_logs (log_date);
create index if not exists attendance_logs_scanned_by_idx on public.attendance_logs (scanned_by);

-- -----------------------------------------------------------------------------
-- Row Level Security for attendance_logs
-- -----------------------------------------------------------------------------
alter table public.attendance_logs enable row level security;

-- Teachers may INSERT only their own scans (scanned_by = auth.uid()).
drop policy if exists attendance_logs_insert_teachers on public.attendance_logs;
create policy attendance_logs_insert_teachers
  on public.attendance_logs
  for insert
  to authenticated
  with check (
    exists (select 1 from public.teachers where teachers.id = auth.uid())
    and scanned_by = auth.uid()
  );

-- Teachers may SELECT all logs.
drop policy if exists attendance_logs_select_teachers on public.attendance_logs;
create policy attendance_logs_select_teachers
  on public.attendance_logs
  for select
  to authenticated
  using (
    exists (select 1 from public.teachers where teachers.id = auth.uid())
  );

-- Nobody may UPDATE attendance_logs from the client (SMS status is set by a
-- server function later). RLS UPDATE policies are therefore not granted — a
-- default-deny applies for update/delete on tables with RLS enabled when no
-- explicit policy matches. We still declare explicit deny-safe policies.
drop policy if exists attendance_logs_no_update on public.attendance_logs;
create policy attendance_logs_no_update
  on public.attendance_logs
  for all
  to authenticated
  using (false);

drop policy if exists attendance_logs_no_delete on public.attendance_logs;
create policy attendance_logs_no_delete
  on public.attendance_logs
  for delete
  to authenticated
  using (false);

-- Revoke any direct table privileges that could bypass RLS.
revoke all on public.attendance_logs from public;
grant usage on schema public to authenticated;
grant select, insert (student_id, type, scanned_by, created_at) on public.attendance_logs to authenticated;
-- NOTE: log_date, sms_status, sms_sent_at, sms_error are intentionally NOT
-- granted to authenticated, so clients cannot set them; they are derived or
-- reserved for the server function.