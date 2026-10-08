-- Tests for Phase 5 (tasks and alerts). Fresh database each run.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','bin2@x.test','Bindery2',false,false);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),('00000000-0000-0000-0000-0000000000a4','Bindery'),('00000000-0000-0000-0000-0000000000a5','Bindery'),('00000000-0000-0000-0000-0000000000a2','Front Desk')) v(id,dn)
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
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
-- job created and assigned to NoveltyStaff -> alert to them, none to the creator
select create_job('60000000-0000-0000-0000-000000000001','Acme',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from notifications where kind = 'assigned' and title like 'Job #%Acme%'$$, 1, 'assignee is alerted');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from notifications$$, 0, 'creator is not alerted about their own action');
select pg_temp.expect_count($$select 1 from notifications where employee_id <> pressgo.current_employee_id()$$, 0, 'cannot read others alerts');

-- tasks
select pg_temp.ok($$select create_task('Call customer', 'about proof', '00000000-0000-0000-0000-0000000000a3', now()+interval '1 day', (select id from jobs limit 1))$$, 'create job task');
select pg_temp.expect_fail($$select create_task('   ', null, '00000000-0000-0000-0000-0000000000a3', null)$$, 'empty title');
select pg_temp.expect_fail($$select create_task('x', null, '00000000-0000-0000-0000-000000000099', null)$$, 'unknown assignee');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from notifications where kind = 'task' and title = 'New task for you: Call customer'$$, 1, 'task alert');
select pg_temp.expect_count($$select 1 from tasks where title = 'Call customer'$$, 1, 'assignee sees task');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from tasks$$, 0, 'unrelated staff do not see it');
select pg_temp.expect_fail($$select set_task_done((select id from tasks limit 1), true)$$, 'unrelated staff cannot complete');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select set_task_done((select id from tasks limit 1), true)$$, 'assignee completes');
select pg_temp.expect_count($$select 1 from tasks where done_by is not null$$, 1, 'marked done');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from notifications where title = 'Task done: Call customer'$$, 1, 'creator alerted when done');
select pg_temp.ok($$select set_task_done((select id from tasks limit 1), false)$$, 'creator can reopen');
select pg_temp.ok($$select mark_alerts_read()$$, 'mark read');
select pg_temp.expect_count($$select 1 from notifications where read_at is null$$, 0, 'all read');
select pg_temp.expect_fail($$update notifications set title = 'x'$$ || '; select 1/0', 'cannot edit alerts (and the check itself fails)');

-- handoff alerts the whole receiving department; problems alert assignee + managers
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select handoff_job((select id from jobs limit 1), pg_temp.dept('Bindery'), 'ready to fold')$$, 'handoff');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from notifications where kind = 'handoff'$$, 1, 'bindery member 1 alerted');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_count($$select 1 from notifications where kind = 'handoff'$$, 1, 'bindery member 2 alerted');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok($$select raise_hold((select id from jobs limit 1), 'Machine problem', 'press jammed')$$, 'manager raises problem');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from notifications where kind = 'problem'$$, 1, 'assignee alerted of problem');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from notifications where kind = 'problem'$$, 0, 'raiser (a manager) not alerted of own problem');
reset role;
select 'PHASE 5 TESTS PASSED';
