-- Direct writes are closed for everyone except the table owner and the service role.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','staff@x.test','Staff',false,false);
insert into department_memberships (employee_id, department_id)
 select '00000000-0000-0000-0000-0000000000a3', id from departments where name = 'Novelty';

-- every write kind on every table must be refused with "permission denied" (42501)
create temp table tcols as
  select distinct on (c2.relname) c2.relname::text as tbl, a.attname::text as col
  from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace join pg_attribute a on a.attrelid = c2.oid and a.attnum > 0 and not a.attisdropped and a.attidentity = '' and a.attgenerated = ''
  where n.nspname = 'pressgo' and c2.relkind in ('r','p') order by c2.relname, a.attnum;
grant select on tcols to public;
create or replace function pg_temp.try_all(who text) returns void language plpgsql as $$
declare t record; c text; stmt text; kind text;
begin
  for t in select c2.relname from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
           where n.nspname = 'pressgo' and c2.relkind in ('r','p') loop
    select col into c from pg_temp.tcols where tbl = t.relname;
    foreach kind in array array['insert','update','delete','truncate'] loop
      stmt := case kind
        when 'insert'   then format('insert into pressgo.%I default values', t.relname)
        when 'update'   then format('update pressgo.%I set %I = %I where false', t.relname, c, c)
        when 'delete'   then format('delete from pressgo.%I where false', t.relname)
        else format('truncate pressgo.%I', t.relname) end;
      begin
        execute stmt;
        raise exception 'FAILED: % could % on %', who, kind, t.relname;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
end $$;
grant execute on function pg_temp.try_all(text) to public;

set role anon;
select pg_temp.try_all('anonymous');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a3', false);
select pg_temp.try_all('staff');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select pg_temp.try_all('front desk');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
select pg_temp.try_all('manager');

-- reading still works, with the same row-security rules
do $$ begin
  if (select count(*) from departments) < 4 then raise exception 'FAILED: manager cannot read departments'; end if;
  if (select count(*) from employees) <> 3 then raise exception 'FAILED: manager cannot read employees'; end if;
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a3', false);
do $$ begin
  if (select count(*) from jobs) <> 0 then raise exception 'FAILED: staff sees jobs they should not'; end if;
end $$;

-- the legitimate path still works for each role, end to end
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select create_job(gen_random_uuid(), 'Acme', null, 'cards', null, 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), null, true) \gset j_
select send_message((select id from conversations where name = 'General'), 'hello');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
select create_task('t', null, '00000000-0000-0000-0000-0000000000a3', null, null);
reset role;

-- final permissions: no write privileges for the signed-in or anonymous roles; service role keeps its own
do $$ begin
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'pressgo'
             and grantee in ('authenticated','anon','PUBLIC') and privilege_type <> 'SELECT') then
    raise exception 'FAILED: a non-read privilege remains';
  end if;
  if not has_table_privilege('service_role', 'pressgo.employees', 'insert') then raise exception 'FAILED: service role lost access'; end if;
end $$;
\echo PASSED: direct writes closed
