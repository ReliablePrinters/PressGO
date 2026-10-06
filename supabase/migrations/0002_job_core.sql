-- PressGO Phase 2: Job core (create, assign, lifecycle, history)
-- Everything the screens do to a job goes through these functions, so the rules
-- (who may do what, in which order, with which reason) cannot be skipped.

alter table pressgo.jobs add column if not exists approved_file_id uuid;   -- filled in Phase 3 (artwork approval)

-- ---- security fix: only a CONFIRMED email may claim an invitation
create or replace function pressgo.accept_invitation() returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_email text := lower(auth.jwt() ->> 'email'); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'please confirm your email address first';
  end if;
  update employees set auth_user_id = auth.uid(), invite_expires_at = null, updated_at = now()
   where lower(email) = v_email and auth_user_id is null and active
     and (invite_expires_at is null or invite_expires_at > now())
  returning id into v_id;
  if v_id is null then raise exception 'no valid invitation for this account'; end if;
  return v_id;
end $$;

-- ---- audit rows can carry a reason and a readable action name
create or replace function pressgo.audit_row_change() returns trigger
language plpgsql security definer set search_path = pressgo as $$
begin
  insert into audit_events (job_id, actor_id, action, before, after, reason)
  values (case when tg_table_name = 'jobs' then coalesce(new.id, old.id) end,
          pressgo.current_employee_id(),
          coalesce(nullif(current_setting('pressgo.action', true), ''), tg_table_name || '.' || lower(tg_op)),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('pressgo.reason', true), ''));
  return coalesce(new, old);
end $$;

create or replace function pressgo._note(p_action text, p_reason text) returns void
language plpgsql as $$
begin
  perform set_config('pressgo.action', coalesce(p_action,''), true);
  perform set_config('pressgo.reason', coalesce(p_reason,''), true);
end $$;

-- ---- create (retry-safe)
create or replace function pressgo.create_job(
  p_request_id uuid, p_customer text, p_phone text, p_desc text, p_product text,
  p_qty integer, p_size text, p_material text, p_finishing text, p_due timestamptz,
  p_priority text, p_dept uuid, p_assignee uuid, p_artwork_required boolean
) returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs;
begin
  if not (is_manager() or is_front_desk()) then raise exception 'only Front Desk or a manager can create jobs'; end if;
  if p_request_id is null then raise exception 'missing request id'; end if;
  select * into j from jobs where client_request_id = p_request_id;
  if found then return j; end if;                                  -- a retry: return the job that already exists
  if btrim(coalesce(p_customer,'')) = '' then raise exception 'customer name is required'; end if;
  if btrim(coalesce(p_desc,'')) = '' then raise exception 'job description is required'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'quantity must be more than zero'; end if;
  if p_due is null then raise exception 'due date is required'; end if;
  if p_dept is null then raise exception 'choose a department'; end if;
  if not exists (select 1 from departments where id = p_dept and active) then raise exception 'department is not active'; end if;
  if not coalesce(p_artwork_required, true) and not is_manager() then
    raise exception 'only a manager can mark artwork as not required';
  end if;
  perform _note('job.created', null);
  insert into jobs (client_request_id, customer_name, customer_phone, description, product, quantity, size, material,
                    finishing, due_at, priority, current_department_id, current_assignee_id, artwork_required, created_by)
  values (p_request_id, btrim(p_customer), nullif(btrim(coalesce(p_phone,'')),''), btrim(p_desc), nullif(btrim(coalesce(p_product,'')),''),
          p_qty, nullif(btrim(coalesce(p_size,'')),''), nullif(btrim(coalesce(p_material,'')),''), nullif(btrim(coalesce(p_finishing,'')),''),
          p_due, coalesce(p_priority,'Normal'), p_dept, p_assignee, coalesce(p_artwork_required, true), current_employee_id())
  returning * into j;
  insert into conversations (type, name, job_id) values ('job', 'Job ' || j.job_number, j.id);
  return j;
end $$;

-- ---- edit details (priority / deadline changes need a reason)
create or replace function pressgo.update_job_details(
  p_job uuid, p_version integer, p_customer text, p_phone text, p_desc text, p_product text, p_qty integer,
  p_size text, p_material text, p_finishing text, p_due timestamptz, p_priority text, p_reason text
) returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs; o jobs;
begin
  if not (is_manager() or is_front_desk()) then raise exception 'only Front Desk or a manager can edit job details'; end if;
  select * into o from jobs where id = p_job;
  if not found then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  if (p_due is distinct from o.due_at or p_priority is distinct from o.priority) and btrim(coalesce(p_reason,'')) = '' then
    raise exception 'a reason is required when changing the deadline or priority';
  end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'quantity must be more than zero'; end if;
  perform _note('job.details_changed', p_reason);
  update jobs set customer_name = btrim(p_customer), customer_phone = nullif(btrim(coalesce(p_phone,'')),''),
         description = btrim(p_desc), product = nullif(btrim(coalesce(p_product,'')),''), quantity = p_qty,
         size = nullif(btrim(coalesce(p_size,'')),''), material = nullif(btrim(coalesce(p_material,'')),''),
         finishing = nullif(btrim(coalesce(p_finishing,'')),''), due_at = p_due, priority = p_priority
   where id = p_job and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

-- ---- assign (Front Desk / manager to anyone in the department; staff can take an unassigned job for themselves)
create or replace function pressgo.assign_job(p_job uuid, p_version integer, p_assignee uuid, p_dept uuid default null)
returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs; o jobs; me uuid := current_employee_id(); target_dept uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from jobs where id = p_job;
  if not found or not can_view_job(p_job) then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  if not (is_manager() or is_front_desk()) then
    if p_assignee is distinct from me then raise exception 'you can only accept a job for yourself'; end if;
    if o.current_assignee_id is not null then raise exception 'this job already has an owner'; end if;
    if not in_department(o.current_department_id) then raise exception 'this job belongs to another department'; end if;
  end if;
  target_dept := coalesce(p_dept, o.current_department_id);
  perform _note(case when p_assignee is null then 'job.unassigned' else 'job.assigned' end, null);
  update jobs set current_assignee_id = p_assignee, current_department_id = target_dept
   where id = p_job and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

-- ---- lifecycle
create or replace function pressgo.transition_job(p_job uuid, p_version integer, p_to text, p_reason text default null)
returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs; o jobs; me uuid := current_employee_id(); mgr boolean := is_manager(); fd boolean := is_front_desk();
        is_owner boolean; ok boolean := false; override boolean := false;
        order_ text[] := array['New','Queued','In Production','Finishing','Ready for Collection','Collected'];
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from jobs where id = p_job;
  if not found or not can_view_job(p_job) then raise exception 'job not found'; end if;
  if p_to not in ('New','Queued','In Production','Finishing','Ready for Collection','Collected','Cancelled') then raise exception 'unknown status'; end if;
  if o.lifecycle_status = p_to then raise exception 'job is already %', p_to; end if;
  is_owner := coalesce(o.current_assignee_id = me, false);

  if p_to = 'Cancelled' then
    if not mgr then raise exception 'only a manager can cancel a job'; end if;
    if o.lifecycle_status = 'Collected' then raise exception 'a collected job cannot be cancelled'; end if;
    if btrim(coalesce(p_reason,'')) = '' then raise exception 'a reason is required to cancel'; end if;
    ok := true;
  elsif o.lifecycle_status = 'Cancelled' or o.lifecycle_status = 'Collected' then
    if not mgr or btrim(coalesce(p_reason,'')) = '' then raise exception 'only a manager, with a reason, can reopen a closed job'; end if;
    if o.lifecycle_status = 'Cancelled' and p_to not in ('New','Queued') then
      raise exception 'a cancelled job can only be reopened to New or Queued';
    end if;
    ok := true; override := true;
  elsif array_position(order_, p_to) < array_position(order_, o.lifecycle_status) then
    if not mgr or btrim(coalesce(p_reason,'')) = '' then raise exception 'only a manager, with a reason, can move a job backwards'; end if;
    ok := true; override := true;
  else
    case p_to
      when 'Queued' then
        ok := (mgr or fd) and o.lifecycle_status = 'New';
        if ok and o.current_department_id is null then raise exception 'choose a department before releasing the job'; end if;
      when 'In Production' then
        ok := o.lifecycle_status = 'Queued' and (is_owner or mgr);
        if ok and o.current_assignee_id is null then raise exception 'assign the job to someone before starting'; end if;
        if ok and o.artwork_required and o.approved_file_id is null then raise exception 'Upload and approve artwork before starting'; end if;
        override := ok and not is_owner;
      when 'Finishing' then
        ok := o.lifecycle_status = 'In Production' and (is_owner or mgr);
        override := ok and not is_owner;
      when 'Ready for Collection' then
        ok := o.lifecycle_status in ('In Production','Finishing') and (is_owner or mgr);
        override := ok and not is_owner;
      when 'Collected' then
        ok := o.lifecycle_status = 'Ready for Collection' and (mgr or fd);
      else ok := false;
    end case;
    if not coalesce(ok,false) then raise exception 'you cannot move this job from % to %', o.lifecycle_status, p_to; end if;
    if override and btrim(coalesce(p_reason,'')) = '' then raise exception 'a manager override needs a reason'; end if;
  end if;

  perform _note('job.status_' || replace(lower(p_to),' ','_'), p_reason);
  update jobs set lifecycle_status = p_to where id = p_job and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

-- who can I assign to? (active members of a department; managers/front desk only)
create or replace function pressgo.department_staff(p_dept uuid)
returns table (employee_id uuid, display_name text)
language sql stable security definer set search_path = pressgo as $$
  select e.id, e.display_name from employees e
  join department_memberships m on m.employee_id = e.id and m.ended_at is null
  where m.department_id = p_dept and e.active and current_employee_id() is not null
  order by e.display_name
$$;

-- ---- lock the functions down to signed-in people
do $$ declare f text; begin
  foreach f in array array[
    'create_job(uuid,text,text,text,text,integer,text,text,text,timestamptz,text,uuid,uuid,boolean)',
    'update_job_details(uuid,integer,text,text,text,text,integer,text,text,text,timestamptz,text,text)',
    'assign_job(uuid,integer,uuid,uuid)', 'transition_job(uuid,integer,text,text)',
    'department_staff(uuid)', 'accept_invitation()'] loop
    execute format('revoke execute on function pressgo.%s from public, anon', f);
    execute format('grant execute on function pressgo.%s to authenticated', f);
  end loop;
end $$;
