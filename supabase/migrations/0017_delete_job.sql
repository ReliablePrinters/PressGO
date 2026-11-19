-- PressGO: deleting a job.
--
-- WHY THIS IS A "SOFT" DELETE (the job is hidden and locked, not erased):
-- Everything that hangs off a job is a permanent record by design: the audit history, uploaded files, problems, handoffs and
-- chat messages all point at the job and cannot be changed or removed (see 0001, 0003, 0010), and files also live in private
-- storage under the job's id. Erasing the job row would either fail on those links or leave them pointing at nothing.
-- So "delete" works the same way deleting a chat message does (0010): the job disappears for everybody and can no longer be
-- changed, and nothing is lost. The owner of the database can still see it and restore it (see FEATURE-UPDATE-NOTES.md).
--
-- WHO MAY DELETE (decided in the database, whatever the app shows):
--   * a manager (the app's administrator role): any job, any status;
--   * the person who created the job: only while it has not started production (New, Queued or Cancelled).
--   A reason is always required and is written to the audit history (trimmed; blanks of any kind do not count as a reason).
alter table pressgo.jobs
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references pressgo.employees(id),
  add column if not exists delete_reason text;
alter table pressgo.jobs drop constraint if exists jobs_deleted_consistent;
alter table pressgo.jobs add constraint jobs_deleted_consistent
  check ((deleted_at is null) = (deleted_by is null) and (deleted_at is null) = (delete_reason is null));

-- A deleted job is invisible to everyone. The job's files, problems, handoffs, history rows, tasks and chat are all shown
-- through can_view_job(), so they disappear with it (the files stay in storage but nobody can read them).
create or replace function pressgo.can_view_job(p_job uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select pressgo.current_employee_id() is not null and exists (
    select 1 from jobs j where j.id = p_job and j.deleted_at is null and (
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

-- A deleted job is frozen: none of the other job functions (edit, assign, move, approve artwork, accept a handoff...) can
-- touch it, even if someone calls them directly with the job's id. The job row itself can never be removed.
create or replace function pressgo.jobs_frozen_when_deleted() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'jobs cannot be erased; use delete_job() to remove one from view';
  end if;
  if old.deleted_at is not null then
    raise exception 'this job was deleted and can no longer be changed';
  end if;
  return new;
end $$;
drop trigger if exists jobs_frozen on pressgo.jobs;
create trigger jobs_frozen before update or delete on pressgo.jobs
  for each row execute function pressgo.jobs_frozen_when_deleted();

-- Same check as before, except a job being deleted may still have an owner who has since been disabled.
create or replace function pressgo.check_job_assignee() returns trigger
language plpgsql security definer set search_path = pressgo as $$
begin
  if new.deleted_at is not null then return new; end if;
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

create or replace function pressgo.delete_job(p_job uuid, p_version integer, p_reason text)
returns void
language plpgsql security definer set search_path = pressgo as $$
declare me uuid := current_employee_id(); o jobs;
  -- the reason with blanks trimmed from both ends: ordinary spaces, tabs, line breaks, and characters that look like nothing
  -- (160 no-break space, 8203-8205 zero-width space/non-joiner/joiner, 8288 word joiner, 65279 byte-order mark; listed by code
  -- number so this file holds no invisible characters). A reason made only of such characters is empty, and is refused below.
  v_reason text := regexp_replace(coalesce(p_reason, ''),
    '^[[:space:]' || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']+|[[:space:]'
      || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']+$', '', 'g');
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from jobs where id = p_job;
  -- someone who cannot see the job is told it does not exist, so job ids cannot be probed
  if not found or not can_view_job(p_job) then raise exception 'job not found'; end if;
  if not (is_manager() or o.created_by = me) then
    raise exception 'only the person who created this job, or a manager, can delete it';
  end if;
  if not is_manager() and o.lifecycle_status not in ('New', 'Queued', 'Cancelled') then
    raise exception 'only a manager can delete a job that has started production';
  end if;
  if v_reason = '' then raise exception 'a reason is required to delete a job'; end if;
  if length(v_reason) > 500 then raise exception 'that reason is too long (500 characters at most)'; end if;
  perform _note('job.deleted', v_reason);
  update jobs set deleted_at = now(), deleted_by = me, delete_reason = v_reason
   where id = p_job and version = p_version;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  -- do not let work vanish silently: tell the owner (the alert has no link, the job is gone from view)
  perform _notify(o.current_assignee_id, 'job_deleted',
    'Job #' || o.job_number || ' (' || o.customer_name || ') was deleted: ' || v_reason, null);
end $$;

do $$ begin
  revoke execute on function pressgo.delete_job(uuid, integer, text) from public, anon;
  grant execute on function pressgo.delete_job(uuid, integer, text) to authenticated;
  revoke execute on function pressgo.jobs_frozen_when_deleted() from public, anon;
end $$;
