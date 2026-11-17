-- Tests for message links on alerts, replies (text and pictures), reply and "approval taken back" alerts, and mark-unread. Fresh database each run.
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
grant execute on all functions in schema pg_temp to public;

set role authenticated;
-- ===== a text reply alerts the person replied to, with the chat and the exact message
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.conv('General') as g \gset
select send_message(:'g', 'who has the red ink?') as q \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select send_message(:'g', 'I do', :'q') as r1 \gset
select pg_temp.expect_count(format($$select 1 from messages where id = %L and reply_to_id = %L$$, :'r1', :'q'), 1, 'the reply is stored as a reply to the original');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'reply' and conversation_id = %L and message_id = %L and title like '%%BinderyStaff replied to your message%%'$$, :'g', :'r1'), 1, 'the original author is alerted, and the alert points at the reply');
-- replying to yourself alerts nobody
select send_message(:'g', 'found it myself', :'q') as r2 \gset
select pg_temp.expect_count(format($$select 1 from notifications where message_id = %L$$, :'r2'), 0, 'no alert when you reply to your own message');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count(format($$select 1 from notifications where message_id = %L$$, :'r2'), 0, 'nobody else is alerted either');

-- ===== replies must stay inside their own chat
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select start_chat(array['00000000-0000-0000-0000-0000000000a4'::uuid]) as dm \gset
select pg_temp.expect_fail(format($$select send_message(%L, 'wrong chat', %L)$$, :'dm', :'q'), 'cannot reply to a message from another chat');
select pg_temp.expect_fail(format($$select send_message(%L, 'nothing there', gen_random_uuid())$$, :'dm'), 'cannot reply to a message that does not exist');

-- ===== pictures can be replies too (and the old six-argument call still works)
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'g' || '/r1.jpg'), ('chat-files', :'g' || '/r2.jpg'), ('chat-files', :'dm' || '/r3.jpg');
set role authenticated;
select send_attachment(:'g', 'here it is', :'g' || '/r1.jpg', 'r1.jpg', 'image/jpeg', 1000, :'q') as pr \gset
select pg_temp.expect_count(format($$select 1 from messages where id = %L and reply_to_id = %L and attachment_path is not null$$, :'pr', :'q'), 1, 'a picture can be a reply');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'reply' and message_id = %L$$, :'pr'), 1, 'replying with a picture alerts the original author');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.ok(format($$select send_attachment(%L, 'plain', %L, 'r2.jpg', 'image/jpeg', 1000)$$, :'g', :'g' || '/r2.jpg'), 'six arguments still work (no reply)');
select pg_temp.expect_fail(format($$select send_attachment(%L, 'x', %L, 'r3.jpg', 'image/jpeg', 1000, %L)$$, :'dm', :'dm' || '/r3.jpg', :'q'), 'a picture cannot reply to a message from another chat');

-- ===== approving a picture: the alert carries the chat and the message; taking it back alerts the sender
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(format($$select approve_picture(%L)$$, :'pr'), 'front desk approves');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'approved' and conversation_id = %L and message_id = %L$$, :'g', :'pr'), 1, 'the approval alert points at the exact picture');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(format($$select approve_picture(%L, false)$$, :'pr'), 'manager takes the approval back');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'approval_withdrawn' and conversation_id = %L and message_id = %L$$, :'g', :'pr'), 1, 'taking the approval back alerts the sender with a link');
-- in a job chat the alert also carries the job
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select id as jid from create_job(gen_random_uuid(), 'Acme', null, 'cards', null, 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), '00000000-0000-0000-0000-0000000000a3', false) \gset
select id as jc from conversations where job_id = :'jid' \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'jc' || '/p9.jpg');
set role authenticated;
select send_attachment(:'jc', 'artwork', :'jc' || '/p9.jpg', 'p9.jpg', 'image/jpeg', 1000) as p9 \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(format($$select approve_picture(%L)$$, :'p9'), 'manager approves a picture in a job chat');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'approved' and job_id = %L and conversation_id = %L and message_id = %L and title like '%%go ahead%%'$$, :'jid', :'jc', :'p9'), 1, 'the job owner gets a link to the picture and the job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'approved' and job_id = %L and conversation_id = %L and message_id = %L$$, :'jid', :'jc', :'p9'), 1, 'the sender gets a link to the picture and the job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(format($$select approve_picture(%L, false)$$, :'p9'), 'manager takes the job-chat approval back');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count(format($$select 1 from notifications where kind = 'approval_withdrawn' and job_id = %L and message_id = %L$$, :'jid', :'p9'), 1, 'job-chat sender is told the approval was taken back');

-- ===== old alerts keep working: no chat or message link is fine
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from notifications where kind = 'assigned' and conversation_id is null and message_id is null$$, 1, 'assignment alerts have no message link and still arrive');

-- ===== mark as unread
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok(format($$select mark_read(%L)$$, :'g'), 'read the General chat');
select pg_temp.expect_count(format($$select 1 from my_conversations() where id = %L and unread = 0$$, :'g'), 1, 'General shows no unread after reading');
select pg_temp.ok(format($$select mark_unread(%L)$$, :'g'), 'mark the chat unread');
select pg_temp.expect_count(format($$select 1 from my_conversations() where id = %L and unread >= 1$$, :'g'), 1, 'General is unread again');
select pg_temp.ok(format($$select mark_read(%L)$$, :'g'), 'read it again');
select pg_temp.ok(format($$select mark_unread(%L, %L)$$, :'g', :'r1'), 'mark unread from one message');
select pg_temp.expect_count(format($$select 1 from my_conversations() where id = %L and unread >= 1$$, :'g'), 1, 'unread from that message on');
-- marking unread in a chat you cannot read does nothing
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok(format($$select mark_unread(%L)$$, :'dm'), 'asking to mark a private chat you are not in is silently ignored');
select pg_temp.expect_count(format($$select 1 from conversation_reads where conversation_id = %L$$, :'dm'), 0, 'and leaves no trace');

-- ===== who may run what
reset role;
select 1 / case when not has_function_privilege('anon', 'pressgo.mark_unread(uuid,uuid)', 'execute')
              and has_function_privilege('authenticated', 'pressgo.mark_unread(uuid,uuid)', 'execute') then 1 else 0 end;
select 1 / case when not has_function_privilege('anon', 'pressgo.send_attachment(uuid,text,text,text,text,bigint,uuid)', 'execute')
              and has_function_privilege('authenticated', 'pressgo.send_attachment(uuid,text,text,text,text,bigint,uuid)', 'execute') then 1 else 0 end;
select 1 / case when not has_function_privilege('authenticated', 'pressgo._notify(uuid,text,text,uuid,uuid,uuid,uuid)', 'execute')
              and not has_function_privilege('anon', 'pressgo._notify(uuid,text,text,uuid,uuid,uuid,uuid)', 'execute') then 1 else 0 end;
select 1 / case when to_regprocedure('pressgo._notify(uuid,text,text,uuid,uuid)') is null
              and to_regprocedure('pressgo.send_attachment(uuid,text,text,text,text,bigint)') is null then 1 else 0 end;
select 'PASSED: message links, replies and mark-unread' as result;
