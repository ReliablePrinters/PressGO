-- PressGO Phase 1: Foundation (accounts, roles, departments, access rules)
-- Target: Supabase (Postgres + Auth). Every permission rule is enforced here with
-- Row Level Security so it holds no matter what the front-end does.

-- PressGO lives in its own schema ("pressgo") so it can share a Supabase project
-- with other apps without any table-name clashes.
create schema if not exists pressgo;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table pressgo.employees (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique,                       -- set when the invitation is accepted
  email            text not null unique,
  display_name     text not null,
  active           boolean not null default true,
  manager_role     boolean not null default false,
  front_desk       boolean not null default false,    -- capability granted by a manager
  invite_expires_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table pressgo.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index departments_active_name_uq on pressgo.departments (lower(name)) where active;

create table pressgo.department_memberships (
  employee_id   uuid not null references pressgo.employees(id),
  department_id uuid not null references pressgo.departments(id),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  primary key (employee_id, department_id)
);

create sequence pressgo.job_number_seq start 1001;   -- never reused

create table pressgo.jobs (
  id                    uuid primary key default gen_random_uuid(),
  job_number            bigint not null unique default nextval('pressgo.job_number_seq'),
  client_request_id     uuid unique,                -- makes a retried create produce one job
  customer_name         text not null,
  customer_phone        text,
  description           text not null,
  product               text,
  quantity              integer not null check (quantity > 0),
  size                  text,
  material              text,
  finishing             text,
  due_at                timestamptz not null,
  priority              text not null default 'Normal' check (priority in ('Low','Normal','Rush')),
  lifecycle_status      text not null default 'New'
      check (lifecycle_status in ('New','Queued','In Production','Finishing','Ready for Collection','Collected','Cancelled')),
  current_department_id uuid references pressgo.departments(id),
  current_assignee_id   uuid references pressgo.employees(id),
  artwork_required      boolean not null default true,
  version               integer not null default 1,  -- stale-screen protection
  created_by            uuid references pressgo.employees(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index jobs_status_idx on pressgo.jobs (lifecycle_status);
create index jobs_dept_idx   on pressgo.jobs (current_department_id);
create index jobs_assignee_idx on pressgo.jobs (current_assignee_id);
create index jobs_due_idx    on pressgo.jobs (due_at);

-- explicit extra access to a job (e.g. a department that handed it on)
create table pressgo.job_access (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references pressgo.jobs(id),
  employee_id   uuid references pressgo.employees(id),
  department_id uuid references pressgo.departments(id),
  level         text not null default 'read' check (level in ('read','write')),
  reason        text,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  check ((employee_id is null) <> (department_id is null))
);

create table pressgo.conversations (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('general','urgent','department','direct','job')),
  name          text,
  department_id uuid references pressgo.departments(id),
  job_id        uuid references pressgo.jobs(id),
  manager_only  boolean not null default false,     -- e.g. the Managers channel
  created_at    timestamptz not null default now(),
  check (type <> 'department' or department_id is not null),
  check (type <> 'job' or job_id is not null)
);

create table pressgo.conversation_members (
  conversation_id uuid not null references pressgo.conversations(id),
  employee_id     uuid not null references pressgo.employees(id),
  primary key (conversation_id, employee_id)
);

create table pressgo.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references pressgo.conversations(id),
  author_id       uuid not null references pressgo.employees(id),
  body            text not null check (length(btrim(body)) > 0),
  reply_to_id     uuid references pressgo.messages(id),
  sent_at         timestamptz not null default now(),
  hidden_at       timestamptz,                       -- manager moderation (later phase), original kept
  hidden_reason   text
);
create index messages_conv_idx on pressgo.messages (conversation_id, sent_at);

create table pressgo.audit_events (
  id         bigint generated always as identity primary key,
  job_id     uuid references pressgo.jobs(id),
  actor_id   uuid references pressgo.employees(id),
  action     text not null,
  before     jsonb,
  after      jsonb,
  reason     text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helper functions
-- All run as the table owner so they can look at the tables the policies protect.
create or replace function pressgo.current_employee_id() returns uuid
language sql stable security definer set search_path = pressgo as $$
  select id from employees where auth_user_id = auth.uid() and active
$$;

create or replace function pressgo.is_manager() returns boolean
language sql stable security definer set search_path = pressgo as $$
  select coalesce((select manager_role from employees where auth_user_id = auth.uid() and active), false)
$$;

create or replace function pressgo.is_front_desk() returns boolean
language sql stable security definer set search_path = pressgo as $$
  select coalesce((select front_desk from employees where auth_user_id = auth.uid() and active), false)
$$;

create or replace function pressgo.in_department(dept uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select exists (
    select 1 from department_memberships m
    where m.department_id = dept and m.ended_at is null and m.employee_id = pressgo.current_employee_id())
$$;

create or replace function pressgo.can_view_job(p_job uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select pressgo.current_employee_id() is not null and exists (
    select 1 from jobs j where j.id = p_job and (
         pressgo.is_manager() or pressgo.is_front_desk()
      or pressgo.in_department(j.current_department_id)
      or j.current_assignee_id = pressgo.current_employee_id()
      or exists (select 1 from job_access a where a.job_id = j.id and a.revoked_at is null
                 and (a.employee_id = pressgo.current_employee_id() or pressgo.in_department(a.department_id)))
    ))
$$;

create or replace function pressgo.can_read_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select pressgo.current_employee_id() is not null and exists (
    select 1 from conversations c where c.id = p_conv and (
      case c.type
        when 'general'    then true
        when 'urgent'     then true
        when 'department' then (pressgo.is_manager() or (not c.manager_only and pressgo.in_department(c.department_id)))
        when 'direct'     then exists (select 1 from conversation_members m
                                       where m.conversation_id = c.id and m.employee_id = pressgo.current_employee_id())
        when 'job'        then pressgo.can_view_job(c.job_id)
      end))
$$;

-- ---------------------------------------------------------------- invitations
-- Managers create the employee row (no public sign-up). On first sign-in the person
-- calls accept_invitation() to attach their login to that row.
create or replace function pressgo.accept_invitation() returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_email text := lower(auth.jwt() ->> 'email'); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update employees set auth_user_id = auth.uid(), invite_expires_at = null, updated_at = now()
   where lower(email) = v_email and auth_user_id is null and active
     and (invite_expires_at is null or invite_expires_at > now())
  returning id into v_id;
  if v_id is null then raise exception 'no valid invitation for this account'; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- guard rails (triggers)
create or replace function pressgo.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger employees_touch   before update on pressgo.employees   for each row execute function pressgo.touch_updated_at();
create trigger departments_touch before update on pressgo.departments for each row execute function pressgo.touch_updated_at();

-- never lock the printery out of administration
create or replace function pressgo.protect_last_manager() returns trigger
language plpgsql security definer set search_path = pressgo as $$
begin
  if old.manager_role and old.active and (not new.manager_role or not new.active) then
    if not exists (select 1 from employees where manager_role and active and id <> old.id) then
      raise exception 'cannot remove or disable the last active manager';
    end if;
  end if;
  return new;
end $$;
create trigger employees_last_manager before update on pressgo.employees
  for each row execute function pressgo.protect_last_manager();

-- a department with active jobs cannot be deactivated
create or replace function pressgo.protect_department_deactivation() returns trigger
language plpgsql security definer set search_path = pressgo as $$
begin
  if old.active and not new.active and exists (
      select 1 from jobs where current_department_id = old.id
        and lifecycle_status not in ('Collected','Cancelled')) then
    raise exception 'reassign this department''s active jobs before deactivating it';
  end if;
  return new;
end $$;
create trigger departments_protect before update on pressgo.departments
  for each row execute function pressgo.protect_department_deactivation();

-- a job's assignee must be active and in the job's department
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
create trigger jobs_assignee_check before insert or update on pressgo.jobs
  for each row execute function pressgo.check_job_assignee();

-- stale-screen protection: an update must carry the version it was based on
create or replace function pressgo.bump_job_version() returns trigger language plpgsql as $$
begin
  if new.version <> old.version then
    raise exception 'job was changed by someone else (version conflict)' using errcode = '40001';
  end if;
  new.version = old.version + 1; new.updated_at = now(); return new;
end $$;
create trigger jobs_version before update on pressgo.jobs for each row execute function pressgo.bump_job_version();

-- audit trail: written automatically, never editable
create or replace function pressgo.audit_row_change() returns trigger
language plpgsql security definer set search_path = pressgo as $$
begin
  insert into audit_events (job_id, actor_id, action, before, after)
  values (case when tg_table_name = 'jobs' then coalesce(new.id, old.id) end,
          pressgo.current_employee_id(), tg_table_name || '.' || lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger audit_employees   after insert or update on pressgo.employees   for each row execute function pressgo.audit_row_change();
create trigger audit_departments after insert or update on pressgo.departments for each row execute function pressgo.audit_row_change();
create trigger audit_jobs        after insert or update on pressgo.jobs        for each row execute function pressgo.audit_row_change();

create or replace function pressgo.audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit events cannot be changed'; end $$;
create trigger audit_no_update before update or delete on pressgo.audit_events
  for each row execute function pressgo.audit_immutable();

-- messages are not editable in V1
create or replace function pressgo.messages_immutable() returns trigger language plpgsql as $$
begin raise exception 'messages cannot be edited or deleted'; end $$;
create trigger messages_no_edit before update or delete on pressgo.messages
  for each row execute function pressgo.messages_immutable();

-- ---------------------------------------------------------------- row level security
alter table pressgo.employees               enable row level security;
alter table pressgo.departments             enable row level security;
alter table pressgo.department_memberships  enable row level security;
alter table pressgo.jobs                    enable row level security;
alter table pressgo.job_access              enable row level security;
alter table pressgo.conversations           enable row level security;
alter table pressgo.conversation_members    enable row level security;
alter table pressgo.messages                enable row level security;
alter table pressgo.audit_events            enable row level security;

-- employees: signed-in active staff can see colleagues; managers manage
create policy emp_select on pressgo.employees for select to authenticated
  using (pressgo.current_employee_id() is not null or auth_user_id = auth.uid());
create policy emp_insert on pressgo.employees for insert to authenticated with check (pressgo.is_manager());
create policy emp_update on pressgo.employees for update to authenticated using (pressgo.is_manager()) with check (pressgo.is_manager());

create policy dept_select on pressgo.departments for select to authenticated using (pressgo.current_employee_id() is not null);
create policy dept_insert on pressgo.departments for insert to authenticated with check (pressgo.is_manager());
create policy dept_update on pressgo.departments for update to authenticated using (pressgo.is_manager()) with check (pressgo.is_manager());

create policy mem_select on pressgo.department_memberships for select to authenticated
  using (pressgo.is_manager() or employee_id = pressgo.current_employee_id());
create policy mem_insert on pressgo.department_memberships for insert to authenticated with check (pressgo.is_manager());
create policy mem_update on pressgo.department_memberships for update to authenticated using (pressgo.is_manager()) with check (pressgo.is_manager());

-- jobs
create policy jobs_select on pressgo.jobs for select to authenticated using (pressgo.can_view_job(id));
create policy jobs_insert on pressgo.jobs for insert to authenticated with check (pressgo.is_manager() or pressgo.is_front_desk());
create policy jobs_update on pressgo.jobs for update to authenticated
  using (pressgo.is_manager() or pressgo.is_front_desk()) with check (pressgo.is_manager() or pressgo.is_front_desk());
-- (staff start/complete/accept actions arrive in Phase 2 as controlled functions)

create policy acc_select on pressgo.job_access for select to authenticated using (pressgo.can_view_job(job_id));
create policy acc_insert on pressgo.job_access for insert to authenticated with check (pressgo.is_manager());
create policy acc_update on pressgo.job_access for update to authenticated using (pressgo.is_manager()) with check (pressgo.is_manager());

-- chat: managers get department channels but never other people's DMs
create policy conv_select on pressgo.conversations for select to authenticated using (pressgo.can_read_conversation(id));
create policy conv_insert on pressgo.conversations for insert to authenticated with check (pressgo.is_manager());
create policy cmem_select on pressgo.conversation_members for select to authenticated
  using (employee_id = pressgo.current_employee_id() or pressgo.can_read_conversation(conversation_id));
create policy cmem_insert on pressgo.conversation_members for insert to authenticated with check (pressgo.is_manager());

create policy msg_select on pressgo.messages for select to authenticated using (pressgo.can_read_conversation(conversation_id));
create policy msg_insert on pressgo.messages for insert to authenticated
  with check (author_id = pressgo.current_employee_id() and pressgo.can_read_conversation(conversation_id));

create policy audit_select on pressgo.audit_events for select to authenticated
  using (pressgo.is_manager() or (job_id is not null and pressgo.can_view_job(job_id)));
-- no insert/update/delete policies: only the triggers above write audit rows

-- ---------------------------------------------------------------- starter data
insert into pressgo.departments (name) values ('Front Desk'), ('Novelty'), ('Bindery'), ('Managers');
insert into pressgo.conversations (type, name) values ('general', 'General'), ('urgent', 'Urgent Jobs');
insert into pressgo.conversations (type, name, department_id, manager_only)
  select 'department', lower(replace(name,' ','-')), id, (name = 'Managers') from pressgo.departments;

-- ---------------------------------------------------------------- API access
-- (Row Level Security above still decides what each signed-in person can actually see.)
grant usage on schema pressgo to authenticated;
grant select, insert, update on all tables in schema pressgo to authenticated;
grant usage on all sequences in schema pressgo to authenticated;
grant execute on all functions in schema pressgo to authenticated;
revoke all on all tables in schema pressgo from anon;
