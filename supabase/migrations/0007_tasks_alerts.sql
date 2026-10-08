-- PressGO Phase 5: tasks (to-dos for a person, optionally tied to a job) and alerts (notifications).
-- Home screen and manager dashboard read the existing tables, so they need nothing new here.

create table pressgo.tasks (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references pressgo.jobs(id),
  title       text not null check (length(btrim(title)) between 1 and 200),
  note        text,
  assigned_to uuid not null references pressgo.employees(id),
  created_by  uuid not null references pressgo.employees(id),
  due_at      timestamptz,
  done_at     timestamptz,
  done_by     uuid references pressgo.employees(id),
  created_at  timestamptz not null default now(),
  check ((done_at is null) = (done_by is null))
);
create index tasks_assigned_idx on pressgo.tasks (assigned_to) where done_at is null;
create index tasks_job_idx on pressgo.tasks (job_id);
alter table pressgo.tasks enable row level security;
create policy tasks_select on pressgo.tasks for select to authenticated using (
  assigned_to = pressgo.current_employee_id() or created_by = pressgo.current_employee_id()
  or pressgo.is_manager() or (job_id is not null and pressgo.can_view_job(job_id)));
grant select on pressgo.tasks to authenticated;
grant select, insert, update, delete on pressgo.tasks to service_role;

create table pressgo.notifications (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references pressgo.employees(id),
  kind        text not null,
  title       text not null,
  job_id      uuid references pressgo.jobs(id),
  task_id     uuid references pressgo.tasks(id),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_emp_idx on pressgo.notifications (employee_id, created_at desc);
alter table pressgo.notifications enable row level security;
create policy notif_select on pressgo.notifications for select to authenticated using (employee_id = pressgo.current_employee_id());
grant select on pressgo.notifications to authenticated;
grant select, insert, update, delete on pressgo.notifications to service_role;

create or replace function pressgo._notify(p_emp uuid, p_kind text, p_title text, p_job uuid, p_task uuid default null) returns void
language plpgsql security definer set search_path = pressgo as $$
begin
  if p_emp is null or p_emp = pressgo.current_employee_id() then return; end if;   -- never alert people about their own actions
  if not exists (select 1 from employees where id = p_emp and active) then return; end if;
  insert into notifications (employee_id, kind, title, job_id, task_id) values (p_emp, p_kind, p_title, p_job, p_task);
end $$;
revoke all on function pressgo._notify(uuid, text, text, uuid, uuid) from public, authenticated, anon;

-- ---------------------------------------------------------------- tasks
create or replace function pressgo.create_task(p_title text, p_note text, p_assigned_to uuid, p_due timestamptz, p_job uuid default null) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Give the task a title'; end if;
  if p_job is not null and not pressgo.can_view_job(p_job) then raise exception 'You cannot see that job'; end if;
  if not exists (select 1 from employees where id = p_assigned_to and active) then raise exception 'Pick someone to do the task'; end if;
  insert into tasks (job_id, title, note, assigned_to, created_by, due_at)
    values (p_job, btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''), p_assigned_to, v_me, p_due) returning id into v_id;
  perform pressgo._notify(p_assigned_to, 'task', 'New task for you: ' || btrim(p_title), p_job, v_id);
  return v_id;
end $$;

create or replace function pressgo.set_task_done(p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); t tasks;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or v_me is null then raise exception 'Task not found'; end if;
  if v_me not in (t.assigned_to, t.created_by) and not pressgo.is_manager() then raise exception 'Only the person it is for, the person who set it, or a manager can change this task'; end if;
  if p_done then
    update tasks set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, v_me) where id = p_task;
    perform pressgo._notify(t.created_by, 'task', 'Task done: ' || t.title, t.job_id, t.id);
  else
    update tasks set done_at = null, done_by = null where id = p_task;
  end if;
end $$;

-- ---------------------------------------------------------------- alerts
create or replace function pressgo.mark_alerts_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = pressgo as $$
begin
  update notifications set read_at = now()
   where employee_id = pressgo.current_employee_id() and read_at is null and (p_ids is null or id = any(p_ids));
end $$;

create or replace function pressgo._alert_job_assigned() returns trigger language plpgsql security definer set search_path = pressgo as $$
begin
  if new.current_assignee_id is not null and (tg_op = 'INSERT' or new.current_assignee_id is distinct from old.current_assignee_id) then
    perform pressgo._notify(new.current_assignee_id, 'assigned', 'Job #' || new.job_number || ' (' || new.customer_name || ') was assigned to you', new.id);
  end if;
  return null;
end $$;
create trigger alert_job_assigned after insert or update of current_assignee_id on pressgo.jobs
  for each row execute function pressgo._alert_job_assigned();

create or replace function pressgo._alert_handoff() returns trigger language plpgsql security definer set search_path = pressgo as $$
declare j jobs; r record;
begin
  if new.status <> 'Pending' then return null; end if;
  select * into j from jobs where id = new.job_id;
  for r in select m.employee_id from department_memberships m where m.department_id = new.to_department_id and m.ended_at is null loop
    perform pressgo._notify(r.employee_id, 'handoff', 'Job #' || j.job_number || ' (' || j.customer_name || ') was handed to your department. Please accept it.', j.id);
  end loop;
  return null;
end $$;
create trigger alert_handoff after insert on pressgo.job_handoffs for each row execute function pressgo._alert_handoff();

create or replace function pressgo._alert_problem() returns trigger language plpgsql security definer set search_path = pressgo as $$
declare j jobs; r record;
begin
  select * into j from jobs where id = new.job_id;
  for r in select distinct x.id from (
      select j.current_assignee_id as id
      union all select e.id from employees e where e.manager_role and e.active) x where x.id is not null loop
    perform pressgo._notify(r.id, 'problem', 'Problem on Job #' || j.job_number || ' (' || j.customer_name || '): ' || new.kind, j.id);
  end loop;
  return null;
end $$;
create trigger alert_problem after insert on pressgo.job_holds for each row execute function pressgo._alert_problem();

grant execute on function pressgo.create_task(text, text, uuid, timestamptz, uuid), pressgo.set_task_done(uuid, boolean),
  pressgo.mark_alerts_read(uuid[]) to authenticated, service_role;
