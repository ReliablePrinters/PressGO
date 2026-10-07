-- PressGO Phase 3: job files, artwork approval, problems (holds), department handoffs.
-- Already applied to the live database. Tested by supabase/tests/0003_files_holds_handoffs_test.sql.
create or replace function pressgo.audit_row_change() returns trigger
language plpgsql security definer set search_path = pressgo as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_events (job_id, actor_id, action, before, after, reason)
  values (case when tg_table_name = 'jobs' then (r->>'id')::uuid else (r->>'job_id')::uuid end,
          pressgo.current_employee_id(),
          coalesce(nullif(current_setting('pressgo.action', true), ''), tg_table_name || '.' || lower(tg_op)),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('pressgo.reason', true), ''));
  return coalesce(new, old);
end $$;

create table pressgo.job_files (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references pressgo.jobs(id),
  category     text not null check (category in ('Customer Original','Artwork Revision','Production Approved','Supporting Document')),
  file_name    text not null check (length(btrim(file_name)) > 0),
  mime_type    text,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  storage_path text not null unique,
  version_no   integer not null,
  uploaded_by  uuid not null references pressgo.employees(id),
  uploaded_at  timestamptz not null default now(),
  unique (job_id, category, file_name, version_no)
);
create index job_files_job_idx on pressgo.job_files (job_id, uploaded_at);

alter table pressgo.jobs add constraint jobs_approved_file_fk
  foreign key (approved_file_id) references pressgo.job_files(id);

create table pressgo.job_holds (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references pressgo.jobs(id),
  kind            text not null check (kind in ('Missing artwork','Waiting on customer','Material shortage','Machine problem','Quality problem','Other')),
  note            text not null check (length(btrim(note)) > 0),
  raised_by       uuid not null references pressgo.employees(id),
  raised_at       timestamptz not null default now(),
  resolved_by     uuid references pressgo.employees(id),
  resolved_at     timestamptz,
  resolution_note text,
  check ((resolved_at is null) = (resolved_by is null))
);
create index job_holds_job_idx on pressgo.job_holds (job_id) ;
create index job_holds_open_idx on pressgo.job_holds (job_id) where resolved_at is null;

create table pressgo.job_handoffs (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references pressgo.jobs(id),
  from_department_id uuid not null references pressgo.departments(id),
  to_department_id   uuid not null references pressgo.departments(id),
  from_employee_id   uuid not null references pressgo.employees(id),
  note               text not null check (length(btrim(note)) > 0),
  status             text not null default 'Pending' check (status in ('Pending','Accepted','Cancelled')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references pressgo.employees(id),
  check (from_department_id <> to_department_id)
);
create unique index job_handoffs_one_pending on pressgo.job_handoffs (job_id) where status = 'Pending';

create or replace function pressgo.no_change() returns trigger language plpgsql as $$
begin raise exception 'this record cannot be changed or removed'; end $$;
create trigger job_files_no_update before update or delete on pressgo.job_files for each row execute function pressgo.no_change();
create trigger job_holds_no_delete before delete on pressgo.job_holds for each row execute function pressgo.no_change();
create trigger job_handoffs_no_delete before delete on pressgo.job_handoffs for each row execute function pressgo.no_change();

create trigger audit_job_files    after insert on pressgo.job_files            for each row execute function pressgo.audit_row_change();
create trigger audit_job_holds    after insert or update on pressgo.job_holds    for each row execute function pressgo.audit_row_change();
create trigger audit_job_handoffs after insert or update on pressgo.job_handoffs for each row execute function pressgo.audit_row_change();

create or replace function pressgo.can_view_job(p_job uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select pressgo.current_employee_id() is not null and exists (
    select 1 from jobs j where j.id = p_job and (
         pressgo.is_manager() or pressgo.is_front_desk()
      or pressgo.in_department(j.current_department_id)
      or j.current_assignee_id = pressgo.current_employee_id()
      or exists (select 1 from job_access a where a.job_id = j.id and a.revoked_at is null
                 and (a.employee_id = pressgo.current_employee_id() or pressgo.in_department(a.department_id)))
      or exists (select 1 from job_handoffs h where h.job_id = j.id and h.status = 'Pending'
                 and pressgo.in_department(h.to_department_id))
    ))
$$;

alter table pressgo.job_files    enable row level security;
alter table pressgo.job_holds    enable row level security;
alter table pressgo.job_handoffs enable row level security;
create policy files_select    on pressgo.job_files    for select to authenticated using (pressgo.can_view_job(job_id));
create policy holds_select    on pressgo.job_holds    for select to authenticated using (pressgo.can_view_job(job_id));
create policy handoffs_select on pressgo.job_handoffs for select to authenticated using (pressgo.can_view_job(job_id));
revoke all on pressgo.job_files, pressgo.job_holds, pressgo.job_handoffs from anon, authenticated, public;
grant select on pressgo.job_files, pressgo.job_holds, pressgo.job_handoffs to authenticated;

create or replace function pressgo._job_from_path(p_name text) returns uuid
language plpgsql immutable set search_path = pressgo as $$
begin return split_part(p_name, '/', 1)::uuid;
exception when others then return null; end $$;

create or replace function pressgo.register_file(
  p_job uuid, p_category text, p_name text, p_mime text, p_size bigint, p_path text
) returns pressgo.job_files
language plpgsql security definer set search_path = pressgo as $$
declare f job_files; o jobs; me uuid := current_employee_id(); n integer; present boolean := true; ext text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from jobs where id = p_job;
  if not found or not can_view_job(p_job) then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  if p_category not in ('Customer Original','Artwork Revision','Production Approved','Supporting Document') then
    raise exception 'unknown file category';
  end if;
  if p_category = 'Production Approved' and not (is_manager() or is_front_desk()) then
    raise exception 'only a manager or Front Desk can add a Production Approved file';
  end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'file name is required'; end if;
  if coalesce(p_size,0) <= 0 then raise exception 'the file is empty'; end if;
  if p_size > 104857600 then raise exception 'files can be at most 100 MB'; end if;
  ext := lower(substring(p_name from '\.([^.]+)$'));
  if ext in ('exe','bat','cmd','com','msi','scr','vbs','js','jar','ps1','sh','dll') then
    raise exception 'this kind of file is not allowed';
  end if;
  if p_path is null or position((p_job::text || '/') in p_path) <> 1 then raise exception 'file is stored in the wrong place'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = ''job-files'' and name = $1)' into present using p_path;
    if not present then raise exception 'the upload did not finish; please try again'; end if;
  end if;
  select coalesce(max(version_no), 0) + 1 into n from job_files
   where job_id = p_job and category = p_category and file_name = btrim(p_name);
  perform _note('file.uploaded', null);
  insert into job_files (job_id, category, file_name, mime_type, size_bytes, storage_path, version_no, uploaded_by)
  values (p_job, p_category, btrim(p_name), nullif(p_mime,''), p_size, p_path, n, me) returning * into f;
  return f;
end $$;

create or replace function pressgo.approve_artwork(p_job uuid, p_version integer, p_file uuid)
returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs; o jobs; f job_files;
begin
  if not is_manager() then raise exception 'only a manager can approve artwork'; end if;
  select * into o from jobs where id = p_job;
  if not found then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  select * into f from job_files where id = p_file and job_id = p_job;
  if not found then raise exception 'file not found on this job'; end if;
  if f.category = 'Supporting Document' then raise exception 'a supporting document cannot be approved as artwork'; end if;
  perform _note('job.artwork_approved', 'Approved for Print: ' || f.file_name || ' (v' || f.version_no || ')');
  update jobs set approved_file_id = p_file where id = p_job and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

create or replace function pressgo.withdraw_artwork_approval(p_job uuid, p_version integer, p_reason text)
returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs;
begin
  if not is_manager() then raise exception 'only a manager can withdraw artwork approval'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'a reason is required'; end if;
  perform _note('job.artwork_approval_withdrawn', p_reason);
  update jobs set approved_file_id = null
   where id = p_job and version = p_version and approved_file_id is not null and lifecycle_status not in ('Collected','Cancelled')
   returning * into j;
  if not found then raise exception 'nothing to withdraw, or the job was changed by someone else' using errcode = '40001'; end if;
  return j;
end $$;

create or replace function pressgo.raise_hold(p_job uuid, p_kind text, p_note text)
returns pressgo.job_holds
language plpgsql security definer set search_path = pressgo as $$
declare h job_holds; o jobs; me uuid := current_employee_id();
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from jobs where id = p_job;
  if not found or not can_view_job(p_job) then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  if btrim(coalesce(p_note,'')) = '' then raise exception 'describe the problem'; end if;
  perform _note('job.problem_raised', p_kind);
  insert into job_holds (job_id, kind, note, raised_by) values (p_job, p_kind, btrim(p_note), me) returning * into h;
  return h;
end $$;

create or replace function pressgo.resolve_hold(p_hold uuid, p_note text)
returns pressgo.job_holds
language plpgsql security definer set search_path = pressgo as $$
declare h job_holds; o jobs; me uuid := current_employee_id();
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into h from job_holds where id = p_hold;
  if not found or not can_view_job(h.job_id) then raise exception 'problem not found'; end if;
  if h.resolved_at is not null then raise exception 'this problem is already resolved'; end if;
  select * into o from jobs where id = h.job_id;
  if not (is_manager() or is_front_desk() or h.raised_by = me or o.current_assignee_id = me) then
    raise exception 'only the person who raised it, the job owner, Front Desk or a manager can resolve a problem';
  end if;
  if btrim(coalesce(p_note,'')) = '' then raise exception 'say how it was resolved'; end if;
  perform _note('job.problem_resolved', p_note);
  update job_holds set resolved_at = now(), resolved_by = me, resolution_note = btrim(p_note)
   where id = p_hold returning * into h;
  return h;
end $$;

create or replace function pressgo.handoff_job(p_job uuid, p_to_dept uuid, p_note text)
returns pressgo.job_handoffs
language plpgsql security definer set search_path = pressgo as $$
declare h job_handoffs; o jobs; me uuid := current_employee_id();
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from jobs where id = p_job;
  if not found or not can_view_job(p_job) then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  if not (is_manager() or is_front_desk() or o.current_assignee_id = me) then
    raise exception 'only the job owner, Front Desk or a manager can hand a job off';
  end if;
  if o.current_department_id is null then raise exception 'the job has no department yet'; end if;
  if p_to_dept is null or p_to_dept = o.current_department_id then raise exception 'choose a different department'; end if;
  if not exists (select 1 from departments where id = p_to_dept and active) then raise exception 'department is not active'; end if;
  if btrim(coalesce(p_note,'')) = '' then raise exception 'add a handoff note (what is done, what comes next)'; end if;
  if exists (select 1 from job_handoffs where job_id = p_job and status = 'Pending') then
    raise exception 'this job already has a handoff waiting to be accepted';
  end if;
  perform _note('job.handoff_sent', null);
  insert into job_handoffs (job_id, from_department_id, to_department_id, from_employee_id, note)
  values (p_job, o.current_department_id, p_to_dept, me, btrim(p_note)) returning * into h;
  return h;
end $$;

create or replace function pressgo.accept_handoff(p_handoff uuid, p_version integer)
returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare h job_handoffs; j jobs; o jobs; me uuid := current_employee_id(); member boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into h from job_handoffs where id = p_handoff;
  if not found then raise exception 'handoff not found'; end if;
  if h.status <> 'Pending' then raise exception 'this handoff is no longer waiting'; end if;
  member := in_department(h.to_department_id);
  if not (member or is_manager()) then raise exception 'only the receiving department or a manager can accept this job'; end if;
  select * into o from jobs where id = h.job_id;
  if o.current_department_id is distinct from h.from_department_id then
    raise exception 'the job moved since this handoff was sent; cancel it and send a new one';
  end if;
  perform _note('job.handoff_accepted', null);
  update job_handoffs set status = 'Accepted', resolved_at = now(), resolved_by = me where id = p_handoff;
  update jobs set current_department_id = h.to_department_id,
                  current_assignee_id = case when member then me else null end
   where id = h.job_id and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

create or replace function pressgo.cancel_handoff(p_handoff uuid)
returns pressgo.job_handoffs
language plpgsql security definer set search_path = pressgo as $$
declare h job_handoffs; me uuid := current_employee_id();
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into h from job_handoffs where id = p_handoff;
  if not found or not can_view_job(h.job_id) then raise exception 'handoff not found'; end if;
  if h.status <> 'Pending' then raise exception 'this handoff is no longer waiting'; end if;
  if not (is_manager() or is_front_desk() or h.from_employee_id = me) then
    raise exception 'only the sender, Front Desk or a manager can cancel a handoff';
  end if;
  perform _note('job.handoff_cancelled', null);
  update job_handoffs set status = 'Cancelled', resolved_at = now(), resolved_by = me where id = p_handoff returning * into h;
  return h;
end $$;

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
    if p_to in ('In Production','Finishing','Ready for Collection','Collected')
       and exists (select 1 from job_holds where job_id = p_job and resolved_at is null) then
      raise exception 'resolve the open problem on this job first';
    end if;
  end if;

  perform _note('job.status_' || replace(lower(p_to),' ','_'), p_reason);
  update jobs set lifecycle_status = p_to where id = p_job and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'register_file(uuid,text,text,text,bigint,text)', 'approve_artwork(uuid,integer,uuid)',
    'withdraw_artwork_approval(uuid,integer,text)', 'raise_hold(uuid,text,text)', 'resolve_hold(uuid,text)',
    'handoff_job(uuid,uuid,text)', 'accept_handoff(uuid,integer)', 'cancel_handoff(uuid)'] loop
    execute format('revoke execute on function pressgo.%s from public, anon', f);
    execute format('grant execute on function pressgo.%s to authenticated', f);
  end loop;
  revoke execute on function pressgo._job_from_path(text) from public, anon;
  grant execute on function pressgo._job_from_path(text) to authenticated;
  revoke execute on function pressgo.no_change() from public, anon;
end $$;

do $$ begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('job-files', 'job-files', false, 104857600)
    on conflict (id) do update set public = false, file_size_limit = 104857600;

    drop policy if exists "pressgo job files read" on storage.objects;
    create policy "pressgo job files read" on storage.objects for select to authenticated
      using (bucket_id = 'job-files' and pressgo.can_view_job(pressgo._job_from_path(name)));
    drop policy if exists "pressgo job files add" on storage.objects;
    create policy "pressgo job files add" on storage.objects for insert to authenticated
      with check (bucket_id = 'job-files' and pressgo.can_view_job(pressgo._job_from_path(name)));
  end if;
end $$;
