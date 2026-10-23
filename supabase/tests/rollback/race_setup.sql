-- Concurrency test for the 0017 rollback, step 1: a database with one live (not deleted) job, nothing deleted yet.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDeskCreator',false,true,true);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from employees e join departments d on d.name = 'Front Desk' where e.id = '00000000-0000-0000-0000-0000000000a2';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select create_job('70000000-0000-0000-0000-0000000000f1','Race',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',(select id from departments where name = 'Novelty'),null,true);
reset role;
do $$ begin
  if (select count(*) from pressgo.jobs where customer_name = 'Race' and deleted_at is null) <> 1 then raise exception 'FAILED: the race job was not created'; end if;
  if exists (select 1 from pressgo.jobs where deleted_at is not null) then raise exception 'FAILED: nothing should be deleted yet'; end if;
end $$;
select 'RACE SETUP DONE' as result;
