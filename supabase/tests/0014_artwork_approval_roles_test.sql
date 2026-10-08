-- Tests for who may approve artwork ("Approved for Print"). Fresh database each run.
-- Allowed: Front Desk, Manager (the admin role). Everyone else must be refused by the server.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyOwner',false,false,true),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','fdmember@x.test','FrontDeskDeptNoFlag',false,false,true),
 ('00000000-0000-0000-0000-0000000000a6','10000000-0000-0000-0000-0000000000a6','fdoff@x.test','FrontDeskDisabled',false,true,false),
 ('00000000-0000-0000-0000-0000000000a7','10000000-0000-0000-0000-0000000000a7','mgroff@x.test','ManagerDisabled',true,false,false),
 ('00000000-0000-0000-0000-0000000000a8','10000000-0000-0000-0000-0000000000a8','nov2@x.test','Novelty2',false,false,true);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),('00000000-0000-0000-0000-0000000000a8','Novelty'),
   ('00000000-0000-0000-0000-0000000000a4','Bindery'),('00000000-0000-0000-0000-0000000000a2','Front Desk'),('00000000-0000-0000-0000-0000000000a5','Front Desk')) v(id,dn)
 join employees e on e.id = v.id join departments d on d.name = v.dn;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'FAILED (should have been blocked): %', label; end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.ok(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise exception 'FAILED (should have worked): % -- %', label, sqlerrm; end; end $$;
create or replace function pg_temp.v(j uuid) returns integer language sql as $$ select version from jobs where id = j $$;
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;
-- try to approve file named $1 on the Acme job as the current user
create or replace function pg_temp.try_approve(fname text) returns void language plpgsql as $$
declare jid uuid := (select id from jobs where customer_name = 'Acme'); fid uuid := (select id from job_files where file_name = fname);
begin perform approve_artwork(jid, pg_temp.v(jid), fid); end $$;
create or replace function pg_temp.approved_is(fname text) returns boolean language sql as $$
  select coalesce((select f.file_name = fname from jobs j join job_files f on f.id = j.approved_file_id where j.customer_name = 'Acme'), false) $$;
create or replace function pg_temp.clear_approval() returns void language sql as $$ update jobs set approved_file_id = null where customer_name = 'Acme' $$;
grant execute on all functions in schema pg_temp to public;

-- an Acme job (artwork required) owned by Novelty staff, with three files
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_job('60000000-0000-0000-0000-000000000001','Acme',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
reset role;
select id as jid from jobs where customer_name = 'Acme' \gset
insert into storage.objects (bucket_id, name) values ('job-files', :'jid' || '/art1.pdf'), ('job-files', :'jid' || '/art2.pdf'), ('job-files', :'jid' || '/art3.pdf'), ('job-files', :'jid' || '/notes.txt');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select register_file(:'jid', 'Artwork Revision', 'art1.pdf', 'application/pdf', 1000, :'jid' || '/art1.pdf');
select register_file(:'jid', 'Artwork Revision', 'art2.pdf', 'application/pdf', 1000, :'jid' || '/art2.pdf');
select register_file(:'jid', 'Artwork Revision', 'art3.pdf', 'application/pdf', 1000, :'jid' || '/art3.pdf');
select register_file(:'jid', 'Supporting Document', 'notes.txt', 'text/plain', 10, :'jid' || '/notes.txt');

-- ===== roles that MAY approve
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select pg_temp.try_approve('art1.pdf')$$, 'Front Desk approves artwork');
reset role; select 1 / (case when pg_temp.approved_is('art1.pdf') then 1 else 0 end); select pg_temp.clear_approval(); set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok($$select pg_temp.try_approve('art2.pdf')$$, 'Manager (admin) approves artwork');
reset role; select 1 / (case when pg_temp.approved_is('art2.pdf') then 1 else 0 end); select pg_temp.clear_approval(); set role authenticated;

-- ===== roles that must NOT approve (each attempt is refused and changes nothing)
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'job owner (plain staff) approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a8');
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'other Novelty staff approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'Bindery staff approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'member of the Front Desk department WITHOUT the Front Desk capability approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a6');
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'disabled Front Desk account approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'disabled manager account approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000ff');   -- signed in but not a PressGO employee
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'signed-in non-employee approved artwork');
select pg_temp.as_user('');                                       -- signed out
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'signed-out visitor approved artwork');
reset role;
select 1 / (case when pg_temp.approved_is('art3.pdf') or exists (select 1 from jobs where customer_name = 'Acme' and approved_file_id is not null) then 0 else 1 end);

-- ===== no side door: nobody can write the approval straight into the table
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail(format($$update jobs set approved_file_id = (select id from job_files where file_name = 'art3.pdf') where id = %L$$, :'jid'), 'plain staff set approved_file_id directly');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail(format($$update jobs set approved_file_id = (select id from job_files where file_name = 'art3.pdf') where id = %L$$, :'jid'), 'Front Desk set approved_file_id directly');
-- anon cannot call it either
reset role; set role anon;
select pg_temp.expect_fail($$select pg_temp.try_approve('art3.pdf')$$, 'anon role called approve_artwork');
reset role;

-- ===== unchanged rules still hold for the allowed roles
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail($$select pg_temp.try_approve('notes.txt')$$, 'a supporting document was approved as artwork');
select pg_temp.ok($$select pg_temp.try_approve('art1.pdf')$$, 'Front Desk approves again');
select pg_temp.expect_fail($$select withdraw_artwork_approval((select id from jobs where customer_name='Acme'), pg_temp.v((select id from jobs where customer_name='Acme')), 'oops')$$, 'Front Desk withdrew approval (withdrawal is still manager-only)');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok($$select withdraw_artwork_approval((select id from jobs where customer_name='Acme'), pg_temp.v((select id from jobs where customer_name='Acme')), 'wrong file')$$, 'manager withdraws approval');
select 'PASSED: artwork approval roles' as result;
