-- Tests: people only see jobs meant for them. Fresh database each run.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true),
 ('00000000-0000-0000-0000-0000000000a6','10000000-0000-0000-0000-0000000000a6','fd2@x.test','FrontDesk2',false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','Nov1',false,false),
 ('00000000-0000-0000-0000-0000000000a7','10000000-0000-0000-0000-0000000000a7','nov2@x.test','Nov2',false,false),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','Bin1',false,false);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),('00000000-0000-0000-0000-0000000000a7','Novelty'),('00000000-0000-0000-0000-0000000000a4','Bindery'),('00000000-0000-0000-0000-0000000000a2','Front Desk'),('00000000-0000-0000-0000-0000000000a6','Front Desk')) v(id,dn)
 join employees e on e.id = v.id join departments d on d.name = v.dn;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
-- A: to the Novelty department (nobody taken it)   B: to one person in Novelty   C: to Bindery
select create_job('60000000-0000-0000-0000-00000000000a','A-dept',null,'x',null,1,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select create_job('60000000-0000-0000-0000-00000000000b','B-person',null,'x',null,1,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
select create_job('60000000-0000-0000-0000-00000000000c','C-bindery',null,'x',null,1,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Bindery'),null,true);
select pg_temp.expect_count($$select 1 from jobs$$, 3, 'creator sees all three they created');

select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select customer_name from jobs where customer_name in ('A-dept','B-person')$$, 2, 'Nov1 sees the department job and their own');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'C-bindery'$$, 0, 'Nov1 does not see Bindery job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'A-dept'$$, 1, 'Nov2 sees the unclaimed department job');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'B-person'$$, 0, 'Nov2 does NOT see the job given to Nov1');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from jobs where customer_name in ('A-dept','B-person')$$, 0, 'Bindery sees no Novelty jobs');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'C-bindery'$$, 1, 'Bindery sees its job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a6');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'A-dept'$$, 1, 'other front desk: not-yet-released jobs are visible');
reset role;
-- release them: a released job is no longer shown to other front desk staff
update jobs set lifecycle_status = 'Queued';
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a6');
select pg_temp.expect_count($$select 1 from jobs$$, 0, 'front desk 2 sees no released jobs they did not create');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from jobs$$, 3, 'manager sees everything');
reset role;
select 'ASSIGNED-ONLY TESTS PASSED';
