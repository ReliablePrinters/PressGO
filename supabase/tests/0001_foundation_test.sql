-- Permission tests for the foundation. Run after local_stub.sql + the migration.
-- Each check raises an exception if a rule is broken; "ALL TESTS PASSED" means every rule held.
\set ON_ERROR_STOP on
set search_path = pressgo, public;

-- people (inserted as the owner, like a first-time setup)
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','off@x.test','Disabled',false,false);
update employees set active=false where email='off@x.test';
insert into employees (id,email,display_name) values ('00000000-0000-0000-0000-0000000000a6','new@x.test','Invitee');

insert into department_memberships (employee_id, department_id)
 select '00000000-0000-0000-0000-0000000000a2', id from departments where name='Front Desk';
insert into department_memberships (employee_id, department_id)
 select '00000000-0000-0000-0000-0000000000a3', id from departments where name='Novelty';
insert into department_memberships (employee_id, department_id)
 select '00000000-0000-0000-0000-0000000000a4', id from departments where name='Bindery';
insert into department_memberships (employee_id, department_id)
 select '00000000-0000-0000-0000-0000000000a5', id from departments where name='Novelty';

insert into jobs (id, customer_name, description, quantity, due_at, current_department_id)
 select '20000000-0000-0000-0000-000000000001','Cust A','500 flyers',500, now()+interval '2 days', id from departments where name='Novelty';
insert into jobs (id, customer_name, description, quantity, due_at, current_department_id)
 select '20000000-0000-0000-0000-000000000002','Cust B','Books',20, now()+interval '3 days', id from departments where name='Bindery';

-- a direct message between Novelty and Bindery staff
insert into conversations (id,type) values ('30000000-0000-0000-0000-000000000001','direct');
insert into conversation_members values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3'),
                                         ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a4');
insert into messages (conversation_id, author_id, body) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','private hello');

create or replace function pg_temp.as_user(u text, e text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  perform set_config('request.jwt.claim.email', e, false);
end $$;
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'FAILED (should have been blocked): %', label;
end $$;
create or replace function pg_temp.expect_blocked(sql text, label text) returns void language plpgsql as $$
declare n bigint;
begin
  begin execute sql; get diagnostics n = row_count; exception when others then return; end;
  if n > 0 then raise exception 'FAILED (changed % rows): %', n, label; end if;
end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint;
begin
  execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if;
end $$;

set role authenticated;

-- 1. unauthenticated visitor sees nothing
select pg_temp.as_user('');
select pg_temp.expect_count('select 1 from jobs', 0, 'visitor sees jobs');
select pg_temp.expect_count('select 1 from employees', 0, 'visitor sees employees');
select pg_temp.expect_count('select 1 from messages', 0, 'visitor sees messages');

-- 2. disabled employee sees nothing even with a valid login
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_count('select 1 from jobs', 0, 'disabled employee sees jobs');
select pg_temp.expect_count('select 1 from messages', 0, 'disabled employee sees messages');

-- 3. cross-department isolation
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');   -- Novelty
select pg_temp.expect_count($$select 1 from jobs where id='20000000-0000-0000-0000-000000000001'$$, 1, 'novelty sees own job');
select pg_temp.expect_count($$select 1 from jobs where id='20000000-0000-0000-0000-000000000002'$$, 0, 'novelty must not see bindery job');
select pg_temp.expect_count($$select 1 from audit_events where job_id='20000000-0000-0000-0000-000000000002'$$, 0, 'novelty must not see bindery audit');

-- 4. staff cannot create jobs, change roles, or edit departments
select pg_temp.expect_fail($$insert into jobs (customer_name,description,quantity,due_at) values ('x','y',1,now())$$, 'staff created job');
select pg_temp.expect_blocked($$update employees set manager_role=true where email='nov@x.test'$$, 'staff promoted self');
select pg_temp.expect_fail($$insert into departments (name) values ('Sneaky')$$, 'staff created department');

-- 5. managers must not read other people's DMs, but do read department channels
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');   -- Manager
select pg_temp.expect_count('select 1 from messages', 0, 'manager read someone else''s DM');
select pg_temp.expect_count($$select 1 from conversations where type='department'$$, 4, 'manager sees all dept channels');
select pg_temp.expect_count('select 1 from jobs', 2, 'manager sees all jobs');

-- 6. DM participants see the DM; other staff do not
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count('select 1 from messages', 1, 'DM recipient reads DM');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');   -- Front Desk (not in DM)
select pg_temp.expect_count('select 1 from messages', 0, 'non-participant read DM');
select pg_temp.expect_fail($$insert into messages (conversation_id,author_id,body) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','sneak')$$, 'non-participant posted in DM');
select pg_temp.expect_fail($$insert into messages (conversation_id,author_id,body) select id,'00000000-0000-0000-0000-0000000000a3','spoof' from conversations where type='general'$$, 'posted as someone else');

-- 7. Managers channel is closed to ordinary staff; staff see their own department channel
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from conversations where manager_only$$, 0, 'staff sees managers channel');
select pg_temp.expect_count($$select 1 from conversations where type='department'$$, 1, 'staff sees only own dept channel');

-- 8. front desk creates jobs; invalid input and bad assignment are rejected; retry makes one job
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
-- direct writes are closed (0013): front desk must use the function
select pg_temp.expect_fail($$insert into jobs (client_request_id, customer_name, description, quantity, due_at) values ('40000000-0000-0000-0000-0000000000ff','C','D',5, now()+interval '1 day')$$, 'front desk direct insert is blocked');
select create_job('40000000-0000-0000-0000-000000000001','C',null,'D',null,5,null,null,null, now()+interval '1 day','Normal',(select id from departments where name='Novelty'),null,true);
select create_job('40000000-0000-0000-0000-000000000001','C',null,'D',null,5,null,null,null, now()+interval '1 day','Normal',(select id from departments where name='Novelty'),null,true);   -- retry
select pg_temp.expect_count($$select 1 from jobs where client_request_id='40000000-0000-0000-0000-000000000001'$$, 1, 'retry makes one job');
select pg_temp.expect_fail($$select create_job(gen_random_uuid(),'C',null,'D',null,0,null,null,null, now(),'Normal',(select id from departments where name='Novelty'),null,true)$$, 'zero quantity');
select pg_temp.expect_fail($$select create_job(gen_random_uuid(),'C',null,'D',null,1,null,null,null, now(),'Normal',(select id from departments where name='Bindery'),'00000000-0000-0000-0000-0000000000a3',true)$$, 'assignee without matching department');
select pg_temp.expect_fail($$select create_job(gen_random_uuid(),'C',null,'D',null,1,null,null,null, now(),'Normal',(select id from departments where name='Novelty'),'00000000-0000-0000-0000-0000000000a5',true)$$, 'disabled assignee');

-- 9. stale edits are rejected
select update_job_details('20000000-0000-0000-0000-000000000001', 1, 'Cust A', null, '500 flyers', null, 500, null, null, null, now()+interval '2 days', 'Rush', 'test');
select pg_temp.expect_fail($$select update_job_details('20000000-0000-0000-0000-000000000001', 1, 'Cust A', null, '500 flyers', null, 500, null, null, null, now()+interval '2 days', 'Low', 'test')$$, 'stale version overwrite');

-- 10. audit trail exists and cannot be altered; messages cannot be edited
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_blocked($$update audit_events set action='x'$$, 'audit edited');
select pg_temp.expect_blocked($$delete from audit_events$$, 'audit deleted');
select pg_temp.expect_blocked($$update messages set body='x'$$, 'message edited');

-- 11. last manager is protected; department with active jobs cannot be deactivated (guards hold for the table owner / service role too)
reset role;
select pg_temp.expect_fail($$update employees set active=false where email='mgr@x.test'$$, 'disabled last manager');
select pg_temp.expect_fail($$update departments set active=false where name='Novelty'$$, 'deactivated dept with jobs');
update departments set active=false where name='Managers';   -- no jobs: allowed

-- 12. invitations: only a matching, unexpired, CONFIRMED-email invite attaches to an account
reset role;
insert into auth.users values ('10000000-0000-0000-0000-0000000000b1','nobody@x.test', now()),
                              ('10000000-0000-0000-0000-0000000000b2','new@x.test', now()),
                              ('10000000-0000-0000-0000-0000000000b3','late@x.test', null);
insert into employees (email, display_name) values ('late@x.test','Unconfirmed');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000b3','late@x.test');
select pg_temp.expect_fail('select accept_invitation()', 'unconfirmed email claimed an invitation');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000b1','nobody@x.test');
select pg_temp.expect_fail('select accept_invitation()', 'accepted with no invite');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000b2','new@x.test');
select accept_invitation();
select pg_temp.expect_fail('select accept_invitation()', 'invitation reused');

reset role;
select 'ALL TESTS PASSED' as result;
