-- Phase 2: Teacher access and student approval
-- Run this after sql/001_initial_schema.sql
--
-- Adds an `approved` column to students and restricts student management to
-- authenticated teachers (users that have a row in the teachers table).

-- Add the approval column
alter table public.students
  add column if not exists approved boolean not null default false;

-- Column-level restriction: authenticated users may only update the approved
-- column (student_name, guardian_name, guardian_phone are never writable
-- by teachers via the client). The SELECT student_name etc. read still works
-- because teachers have a row in the teachers table (see policies below).
grant update (approved) on public.students to authenticated;

-- Teachers may delete students (used by the Reject button in approvals.html).
grant delete on public.students to authenticated;

-- Remove the old policy if it exists (from an earlier attempt), then define the
-- teacher-only update policy. Eligibility is checked against the teachers
-- table; the column-level GRANT above is the additional safeguard.
drop policy if exists teachers_update_students_approved on public.students;
create policy teachers_update_students_approved
  on public.students
  for update
  to authenticated
  using (
    exists (select 1 from public.teachers where teachers.id = auth.uid())
  )
  with check (
    exists (select 1 from public.teachers where teachers.id = auth.uid())
  );

-- Teachers may delete students (the Reject action).
drop policy if exists teachers_delete_students on public.students;
create policy teachers_delete_students
  on public.students
  for delete
  to authenticated
  using (
    exists (select 1 from public.teachers where teachers.id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- How to add a teacher (do NOT enable public signup of teachers)
-- ----------------------------------------------------------------------------
-- 1. In the Supabase dashboard, go to Authentication > Users.
-- 2. Create the teacher user (invite them by email with a magic link, or add
--    them manually and set a password).
-- 3. Copy that user's id (UUID).
-- 4. Insert a row into the teachers table:
--
--      insert into public.teachers (id, name)
--      values ('<teacher-user-id>', 'Teacher Name');
--
-- Once the row exists, that authenticated user is recognized as a teacher and
-- will gain access to scanner.html and approvals.html.