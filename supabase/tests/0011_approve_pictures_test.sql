-- Tests for approving pictures. Fresh database each run.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),('00000000-0000-0000-0000-0000000000a4','Bindery'),('00000000-0000-0000-0000-0000000000a2','Front Desk')) v(id,dn)
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
create or replace function pg_temp.conv(n text) returns uuid language sql as $$ select id from conversations where name = n $$;


set role authenticated;
-- a staff member sends a picture to General
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.conv('General') as nov \gset
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'nov' || '/p1.jpg'), ('chat-files', :'nov' || '/p2.jpg');
set role authenticated;
select send_attachment(:'nov', 'proof v1', :'nov' || '/p1.jpg', 'p1.jpg', 'image/jpeg', 1000) as p1 \gset
select pg_temp.expect_fail(format($$select approve_picture(%L)$$, :'p1'), 'sender (plain staff) cannot approve');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail(format($$select approve_picture(%L)$$, :'p1'), 'other plain staff cannot approve');
-- front desk approves
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(format($$select approve_picture(%L)$$, :'p1'), 'front desk approves');
select pg_temp.ok(format($$select approve_picture(%L)$$, :'p1'), 'approving twice is fine');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count(format($$select 1 from messages where id = %L and approved_by = '00000000-0000-0000-0000-0000000000a2' and approved_at is not null$$, :'p1'), 1, 'everyone sees who approved');
select pg_temp.expect_count($$select 1 from notifications where kind = 'approved'$$, 1, 'sender was told');
-- manager can take it back; plain staff cannot
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail(format($$select approve_picture(%L, false)$$, :'p1'), 'plain staff cannot withdraw');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(format($$select approve_picture(%L, false)$$, :'p1'), 'manager withdraws approval');
select pg_temp.expect_count(format($$select 1 from messages where id = %L and approved_at is null$$, :'p1'), 1, 'approval removed');
-- a manager cannot approve their own picture
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'nov' || '/p3.jpg');
set role authenticated;
select send_attachment(:'nov', 'mine', :'nov' || '/p3.jpg', 'p3.jpg', 'image/jpeg', 1000) as p3 \gset
select pg_temp.expect_fail(format($$select approve_picture(%L)$$, :'p3'), 'cannot approve own picture');
-- front desk can approve a manager's picture
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(format($$select approve_picture(%L)$$, :'p3'), 'front desk approves manager picture');
-- text messages cannot be approved
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select send_message(:'nov', 'just words') as t1 \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail(format($$select approve_picture(%L)$$, :'t1'), 'only pictures can be approved');
-- private chats: a front desk person who is not in it cannot approve
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select start_chat(array['00000000-0000-0000-0000-0000000000a4'::uuid]) as dm \gset
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'dm' || '/p4.jpg');
set role authenticated;
select send_attachment(:'dm', '', :'dm' || '/p4.jpg', 'p4.jpg', 'image/jpeg', 1000) as p4 \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail(format($$select approve_picture(%L)$$, :'p4'), 'outsider front desk cannot approve a private picture');
-- a job chat: approval alerts the job owner and is written into the job history
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select id as jid from create_job(gen_random_uuid(), 'Acme', null, 'cards', null, 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), '00000000-0000-0000-0000-0000000000a3', false) \gset
select id as jc from conversations where job_id = :'jid' \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'jc' || '/p5.jpg');
set role authenticated;
select send_attachment(:'jc', 'artwork', :'jc' || '/p5.jpg', 'p5.jpg', 'image/jpeg', 1000) as p5 \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(format($$select approve_picture(%L)$$, :'p5'), 'manager approves picture in job chat');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from notifications where kind = 'approved' and title like '%go ahead%'$$, 1, 'job owner told to go ahead');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from notifications where kind = 'approved' and title like '%approved your picture%'$$, 1, 'sender told');
reset role;
select 1 / (select count(*) from audit_events where action = 'job.picture_approved' and job_id = :'jid');
select 'PASSED: approving pictures' as result;
