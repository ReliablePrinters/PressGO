-- Tests for Phase 4 (chat). Fresh database each run.
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
-- General chat
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select send_message(pg_temp.conv('General'), '  hello everyone  ')$$, 'post in General');
select pg_temp.expect_fail($$select send_message(pg_temp.conv('General'), '   ')$$, 'empty message');
select pg_temp.expect_fail($$select send_message(pg_temp.conv('managers'), 'hi')$$, 'staff cannot post in Managers channel');
select pg_temp.expect_fail($$select send_message(pg_temp.conv('bindery'), 'hi')$$, 'novelty cannot post in Bindery channel');
select pg_temp.ok($$select send_message(pg_temp.conv('novelty'), 'novelty chat')$$, 'post in own department');
select pg_temp.expect_fail($$update messages set body = 'x'$$, 'messages cannot be edited');
select pg_temp.expect_count($$select 1 from messages where body = 'x'$$, 0, 'messages cannot be edited');
select pg_temp.expect_fail($$insert into messages (conversation_id, author_id, body) values (pg_temp.conv('General'), '00000000-0000-0000-0000-0000000000a4', 'spoof')$$, 'cannot post as someone else');
select pg_temp.expect_count($$select 1 from my_conversations() where name = 'managers'$$, 0, 'staff do not see Managers channel');
select pg_temp.expect_count($$select 1 from my_conversations() where name = 'bindery'$$, 0, 'staff do not see other departments');
select pg_temp.expect_count($$select 1 from my_conversations() where name = 'General' and unread = 0$$, 1, 'own post is not unread');

-- unread + mark read
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from my_conversations() where name = 'General' and unread = 1 and last_body = 'hello everyone' and last_author = 'NoveltyStaff'$$, 1, 'bindery sees 1 unread, trimmed body');
select mark_read(pg_temp.conv('General'));
select pg_temp.expect_count($$select 1 from my_conversations() where name = 'General' and unread = 0$$, 1, 'read clears unread');

-- direct messages
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
create temp table d as select start_direct('00000000-0000-0000-0000-0000000000a4') as id;
grant select on d to authenticated;
select pg_temp.ok($$select send_message((select id from d), 'psst')$$, 'send DM');
select pg_temp.expect_count($$select 1 from (select start_direct('00000000-0000-0000-0000-0000000000a4') id) q where id = (select id from d)$$, 1, 'same DM reused');
select pg_temp.expect_fail($$select start_direct('00000000-0000-0000-0000-0000000000a3')$$, 'cannot DM myself');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from my_conversations() where type = 'direct' and name = 'NoveltyStaff' and unread = 1$$, 1, 'recipient sees DM named after sender');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from messages where conversation_id = (select id from d)$$, 0, 'outsider cannot read DM');
select pg_temp.expect_fail($$select send_message((select id from d), 'snoop')$$, 'outsider cannot post in DM');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from messages where conversation_id = (select id from d)$$, 0, 'even managers cannot read DMs');

-- job chat
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_job('60000000-0000-0000-0000-000000000001','Acme',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',(select id from departments where name='Novelty'),null,true);
create temp table jc as select c.id from conversations c join jobs j on j.id = c.job_id where j.customer_name = 'Acme';
grant select on jc to authenticated;
select pg_temp.expect_count($$select 1 from my_conversations() where type = 'job'$$, 0, 'empty job chat hidden');
select pg_temp.ok($$select send_message((select id from jc), 'customer called')$$, 'front desk posts in job chat');
select pg_temp.expect_count($$select 1 from my_conversations() where type = 'job' and name like 'Job #%Acme'$$, 1, 'job chat listed once used');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail($$select send_message((select id from jc), 'hi')$$, 'bindery staff cannot post in a novelty job chat');
reset role;
select 'CHAT TESTS PASSED';
-- group messages (one person, or a whole department)
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
create temp table g as select start_chat(array['00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4']::uuid[]) as id;
grant select on g to authenticated;
select pg_temp.expect_count($$select 1 from (select start_chat(array['00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a3']::uuid[]) id) q where id = (select id from g)$$, 1, 'same group reused');
select pg_temp.expect_count($$select 1 from (select start_chat(array['00000000-0000-0000-0000-0000000000a4']::uuid[]) id) q where id <> (select id from g)$$, 1, 'one-person chat is separate');
select pg_temp.expect_fail($$select start_chat('{}'::uuid[])$$, 'needs someone');
select pg_temp.expect_fail($$select start_chat(array['00000000-0000-0000-0000-0000000000a2']::uuid[])$$, 'only me');
select pg_temp.ok($$select send_message((select id from g), 'to both of you')$$, 'post in group');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from my_conversations() where unread = 1 and name = 'BinderyStaff, FrontDesk'$$, 1, 'member sees group named after the others');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from messages where conversation_id = (select id from g)$$, 0, 'non-members (even managers) cannot read the group');
reset role;
select 'GROUP TESTS PASSED';

