-- Tests for personal preferences (appearance + accent colour). Fresh database each run.
-- Saved per person; only the person themselves can read or change them; bad values are refused.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','off@x.test','DisabledStaff',false,false,false);
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'FAILED (should have been blocked): %', label; end $$;
create or replace function pg_temp.expect_error(sql text, pattern text, label text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then return; end if;
    raise exception 'FAILED (wrong refusal): % -- got: %', label, sqlerrm;
  end;
  raise exception 'FAILED (should have been blocked): %', label;
end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.ok(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise exception 'FAILED (should have worked): % -- %', label, sqlerrm; end; end $$;
grant execute on all functions in schema pg_temp to public;

set role authenticated;
-- ===== saved per person
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from employee_preferences$$, 0, 'a new person has no saved row (the app uses the defaults)');
select pg_temp.ok($$select set_preferences('dark', 'teal')$$, 'save dark + teal');
select pg_temp.expect_count($$select 1 from employee_preferences where theme = 'dark' and accent = 'teal'$$, 1, 'saved and restored');
select pg_temp.ok($$select set_preferences('light', 'orange')$$, 'change it');
select pg_temp.expect_count($$select 1 from employee_preferences$$, 1, 'changing keeps a single row');
select pg_temp.expect_count($$select 1 from employee_preferences where theme = 'light' and accent = 'orange'$$, 1, 'the new choice is what comes back');
select pg_temp.ok($$select set_preferences('system', 'purple')$$, 'back to the defaults');
select pg_temp.ok($$select set_preferences('system', 'blue')$$, 'blue');
select pg_temp.ok($$select set_preferences('system', 'green')$$, 'green');
select pg_temp.ok($$select set_preferences('system', 'graphite')$$, 'graphite');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.ok($$select set_preferences('dark', 'blue')$$, 'a second person saves theirs');

-- ===== private to the person: not colleagues, not even managers
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from employee_preferences$$, 1, 'a person sees only their own row');
select pg_temp.expect_count($$select 1 from employee_preferences where employee_id = '00000000-0000-0000-0000-0000000000a3'$$, 0, 'cannot read a colleague''s');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from employee_preferences$$, 0, 'a manager cannot read other people''s preferences');
-- the function has no "who" argument, so it can only change the caller's own row; prove that nobody else's moved
select pg_temp.ok($$select set_preferences('light', 'purple')$$, 'manager saves their own');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from employee_preferences where theme = 'system' and accent = 'graphite'$$, 1, 'a colleague''s save did not change mine');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from employee_preferences where theme = 'dark' and accent = 'blue'$$, 1, 'nor theirs');

-- ===== direct writes are closed
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_error($$update employee_preferences set theme = 'dark'$$, 'permission denied', 'direct update');
select pg_temp.expect_error($$insert into employee_preferences (employee_id, theme, accent) values ('00000000-0000-0000-0000-0000000000a4', 'dark', 'blue')$$, 'permission denied', 'direct insert (for someone else)');
select pg_temp.expect_error($$delete from employee_preferences$$, 'permission denied', 'direct delete');

-- ===== bad values are refused (and change nothing)
select pg_temp.expect_error($$select set_preferences('neon', 'blue')$$, 'unknown appearance', 'unknown theme');
select pg_temp.expect_error($$select set_preferences(null, 'blue')$$, 'unknown appearance', 'no theme');
select pg_temp.expect_error($$select set_preferences('dark', '#ff0000')$$, 'unknown accent', 'free-form colour');
select pg_temp.expect_error($$select set_preferences('dark', 'red')$$, 'unknown accent', 'colour not in the list');
select pg_temp.expect_error($$select set_preferences('dark', null)$$, 'unknown accent', 'no accent');
select pg_temp.expect_error($$select set_preferences('dark; drop table x', 'blue')$$, 'unknown appearance', 'junk theme');
select pg_temp.expect_count($$select 1 from employee_preferences where theme = 'system' and accent = 'graphite'$$, 1, 'refused saves changed nothing');

-- ===== signed out (the anonymous role)
-- These must be refused by the database's PERMISSION system itself ("permission denied"), not merely by the function noticing
-- nobody is signed in, so a missing REVOKE cannot hide behind "it raised some error". Supabase gives anon USAGE on every schema
-- it exposes through its API, so give it here too (undone below); otherwise the function would simply not be found. A
-- signed-out request also carries no user id (earlier tests left one set).
reset role;
grant usage on schema pressgo to anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_count($$select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'pressgo.set_preferences(text,text)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'$$, 0, 'PUBLIC holds no execute right on set_preferences');
select pg_temp.expect_count($$select 1 where has_function_privilege('anon', 'pressgo.set_preferences(text,text)', 'execute')$$, 0, 'anon holds no execute right on set_preferences');
select pg_temp.expect_count($$select 1 where has_function_privilege('authenticated', 'pressgo.set_preferences(text,text)', 'execute')$$, 1, 'positive control: signed-in users do hold it');
select pg_temp.expect_count($$select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.oid = 'pressgo.employee_preferences'::regclass and a.grantee = 0$$, 0, 'PUBLIC holds no right on the preferences table');
select pg_temp.expect_count($$select 1 where has_table_privilege('anon', 'pressgo.employee_preferences', 'select')
    or has_table_privilege('anon', 'pressgo.employee_preferences', 'insert')
    or has_table_privilege('anon', 'pressgo.employee_preferences', 'update')
    or has_table_privilege('anon', 'pressgo.employee_preferences', 'delete')$$, 0, 'anon holds no right on the preferences table');
select pg_temp.expect_count($$select 1 where has_table_privilege('authenticated', 'pressgo.employee_preferences', 'select')
    and not has_table_privilege('authenticated', 'pressgo.employee_preferences', 'insert')
    and not has_table_privilege('authenticated', 'pressgo.employee_preferences', 'update')
    and not has_table_privilege('authenticated', 'pressgo.employee_preferences', 'delete')$$, 1, 'positive control: signed-in users can read the table but not write to it');
set role anon;
select pg_temp.expect_error($$select set_preferences('dark', 'blue')$$, 'permission denied', 'anonymous cannot save a look (a valid one)');
select pg_temp.expect_error($$select 1 from employee_preferences$$, 'permission denied', 'anonymous cannot read saved looks');
select pg_temp.expect_error($$insert into employee_preferences (employee_id, theme, accent) values ('00000000-0000-0000-0000-0000000000a4', 'dark', 'blue')$$, 'permission denied', 'anonymous direct insert');
select pg_temp.expect_error($$update employee_preferences set theme = 'dark'$$, 'permission denied', 'anonymous direct update');
select pg_temp.expect_error($$delete from employee_preferences$$, 'permission denied', 'anonymous direct delete');
reset role;
revoke usage on schema pressgo from anon;
-- ===== disabled and non-staff accounts
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_error($$select set_preferences('dark', 'blue')$$, 'not signed in', 'disabled person');
select pg_temp.expect_count($$select 1 from employee_preferences$$, 0, 'disabled person reads nothing');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000ff');
select pg_temp.expect_error($$select set_preferences('dark', 'blue')$$, 'not signed in', 'login with no employee record');
reset role;
select 'PASSED: preferences' as result;
