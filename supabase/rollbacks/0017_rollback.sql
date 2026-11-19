-- PressGO: undo 0017 (deleting a job). Run as the database owner, in the Supabase SQL editor.
-- If the new web app is already published, put the OLD web app back first (revert the merge), otherwise the Delete button errors.
-- The old web app works fine with 0017 still applied, so if the only problem is in the web app you do not need this file at all.
--
-- It refuses to run while any job is still marked deleted: without 0017's rules a deleted job would suddenly reappear for everybody.
-- Restore those jobs first (the "restore" SQL in FEATURE-UPDATE-NOTES.md), or leave 0017 in place.
-- The audit rows "job.deleted" and the alerts "job_deleted" that already exist are permanent records and stay.
begin;
-- Take the lock on pressgo.jobs BEFORE looking for deleted jobs, and keep it until the end of this transaction. Without it,
-- someone could delete a job between the check below and the columns being dropped, and that job would silently reappear
-- for everybody. Waiting for the lock also waits for a delete that is still in progress, so the check below sees it.
-- Reading is still allowed while waiting; writing waits. If the lock cannot be had in 15 seconds the script stops with an
-- error and changes nothing (just run it again).
set local lock_timeout = '15s';
lock table pressgo.jobs in share row exclusive mode;
do $$ begin
  if exists (select 1 from pressgo.jobs where deleted_at is not null) then
    raise exception 'some jobs are still marked deleted: restore them first (see FEATURE-UPDATE-NOTES.md) or leave 0017 in place';
  end if;
end $$;

drop trigger if exists jobs_frozen on pressgo.jobs;
drop function if exists pressgo.jobs_frozen_when_deleted();
drop function if exists pressgo.delete_job(uuid, integer, text);

-- can_view_job() exactly as 0008_assigned_jobs_only.sql made it
create or replace function pressgo.can_view_job(p_job uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select pressgo.current_employee_id() is not null and exists (
    select 1 from jobs j where j.id = p_job and (
         pressgo.is_manager()
      or j.current_assignee_id = pressgo.current_employee_id()
      or j.created_by = pressgo.current_employee_id()
      or (pressgo.is_front_desk() and j.lifecycle_status in ('New', 'Ready for Collection'))
      or (j.current_assignee_id is null and pressgo.in_department(j.current_department_id))
      or exists (select 1 from job_access a where a.job_id = j.id and a.revoked_at is null
                 and (a.employee_id = pressgo.current_employee_id() or pressgo.in_department(a.department_id)))
      or exists (select 1 from job_handoffs h where h.job_id = j.id and h.status = 'Pending'
                 and pressgo.in_department(h.to_department_id))
    ))
$$;

-- check_job_assignee() exactly as 0001_foundation.sql made it
create or replace function pressgo.check_job_assignee() returns trigger
language plpgsql security definer set search_path = pressgo as $$
begin
  if new.current_assignee_id is not null then
    if not exists (select 1 from employees where id = new.current_assignee_id and active) then
      raise exception 'assignee must be an active employee';
    end if;
    if new.current_department_id is null or not exists (
        select 1 from department_memberships
         where employee_id = new.current_assignee_id and department_id = new.current_department_id and ended_at is null) then
      raise exception 'assignee must belong to the job''s department';
    end if;
  end if;
  return new;
end $$;

alter table pressgo.jobs drop constraint if exists jobs_deleted_consistent;
alter table pressgo.jobs drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
commit;
