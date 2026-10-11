-- Phase 1: student self-registration with QR code
-- Run this once in the Supabase SQL editor (https://app.supabase.com).

-- Students: a student self-registers once. The `id` IS the QR payload.
create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  student_name text not null,
  guardian_name text not null,
  guardian_phone text not null,
  created_at   timestamptz not null default now()
);

-- Attendance logs: time-in / time-out records scanned by a teacher.
create table if not exists public.attendance_logs (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  type       text not null check (type in ('time_in', 'time_out')),
  scanned_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Teachers: one row per authenticated Supabase user allowed to scan.
create table if not exists public.teachers (
  id   uuid primary key references auth.users(id) on delete cascade,
  name text not null
);

-- Indexes
create index if not exists attendance_logs_student_id_idx on public.attendance_logs (student_id);
create index if not exists attendance_logs_created_at_idx on public.attendance_logs (created_at desc);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.students enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.teachers enable row level security;

-- students:
--   * anon may INSERT (self-registration) — only rows where approved = false
--   * nobody may SELECT / UPDATE / DELETE via RLS (teachers read students
--     through the teachers-policies below using authenticated role)
drop policy if exists students_insert_anon on public.students;
create policy students_insert_anon
  on public.students
  for insert
  to anon
  with check (approved = false);

-- Revoke anon column-level privileges so a client can only ever set
-- student_name, guardian_name, guardian_phone (and id, which is auto-generated).
-- The generated columns and reserved columns (approved, created_at) are not
-- granted to anon, so clients cannot set them.
revoke all on public.students from anon;
grant insert (student_name, guardian_name, guardian_phone) on public.students to anon;

drop policy if exists students_select_teachers on public.students;
create policy students_select_teachers
  on public.students
  for select
  to authenticated
  using (exists (
    select 1 from public.teachers where teachers.id = auth.uid()
  ));

-- teachers: a teacher may read their own row.
drop policy if exists teachers_select_self on public.teachers;
create policy teachers_select_self
  on public.teachers
  for select
  to authenticated
  using (id = auth.uid());

-- attendance_logs: teachers may read and insert.
drop policy if exists attendance_logs_select_teachers on public.attendance_logs;
create policy attendance_logs_select_teachers
  on public.attendance_logs
  for select
  to authenticated
  using (exists (
    select 1 from public.teachers where teachers.id = auth.uid()
  ));

drop policy if exists attendance_logs_insert_teachers on public.attendance_logs;
create policy attendance_logs_insert_teachers
  on public.attendance_logs
  for insert
  to authenticated
  with check (exists (
    select 1 from public.teachers where teachers.id = auth.uid()
  ));