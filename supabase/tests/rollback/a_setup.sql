-- Rollback test, step 3 (after 0015-0017 are applied): put real data into everything the three migrations added,
-- including one deleted job, so that the rollbacks are tried on a database that is in use, not an empty one.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDeskCreator',false,true,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyOwner',false,false,true);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),('00000000-0000-0000-0000-0000000000a2','Front Desk')) v(id,dn)
 join employees e on e.id = v.id join departments d on d.name = v.dn;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;
grant execute on all functions in schema pg_temp to public;

-- a stored picture (the app uploads first, then calls set_avatar)
insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a3/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', 'image/jpeg', 1000);
select set_preferences('dark', 'blue');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_job('70000000-0000-0000-0000-000000000001','Acme',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
select create_job('70000000-0000-0000-0000-000000000002','Keeper',null,'cards',null,100,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select delete_job((select id from jobs where customer_name = 'Acme'), (select version from jobs where customer_name = 'Acme'), 'rollback test');
reset role;
select pg_temp.expect_count($$select 1 from employee_avatars$$, 1, 'a picture is saved');
select pg_temp.expect_count($$select 1 from employee_preferences$$, 1, 'a look is saved');
select pg_temp.expect_count($$select 1 from jobs where deleted_at is not null$$, 1, 'one job is deleted');
select 'SETUP DONE' as result;
