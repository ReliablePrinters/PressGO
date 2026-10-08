-- Tests for deleting messages. Fresh database each run.
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
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select send_message(pg_temp.conv('novelty'), 'oops wrong channel') as m1 \gset
select send_message(pg_temp.conv('novelty'), 'keep this one') as m2 \gset
select start_chat(array['00000000-0000-0000-0000-0000000000a4'::uuid]) as dm \gset
select send_message(:'dm', 'private words') as m3 \gset
-- the author deletes their own message
select pg_temp.ok(format($$select delete_message(%L)$$, :'m1'), 'author deletes own message');
select pg_temp.expect_count(format($$select 1 from messages where id = %L and body = 'This message was deleted' and hidden_at is not null$$, :'m1'), 1, 'message shows as deleted');
select pg_temp.expect_count(format($$select 1 from messages where id = %L and body like '%%wrong channel%%'$$, :'m1'), 0, 'original text is gone from the message');
select pg_temp.ok(format($$select delete_message(%L)$$, :'m1'), 'deleting twice does nothing');
select pg_temp.expect_fail('select 1 from deleted_messages', 'staff cannot read the saved originals');
-- someone else cannot delete it
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail(format($$select delete_message(%L)$$, :'m2'), 'a colleague cannot delete another person''s message') ;
-- the department colleague in a different department cannot even reach it
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail(format($$select delete_message(%L)$$, :'m2'), 'front desk cannot delete a colleague''s message');
-- manager can delete in a channel, but not in a private chat they are not in
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(format($$select delete_message(%L)$$, :'m2'), 'manager deletes a channel message');
select pg_temp.expect_fail(format($$select delete_message(%L)$$, :'m3'), 'manager cannot touch a private chat they are not in');
-- the private chat recipient cannot delete the sender's private message, the sender can
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail(format($$select delete_message(%L)$$, :'m3'), 'recipient cannot delete the sender''s message');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok(format($$select delete_message(%L)$$, :'m3'), 'sender deletes private message');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count(format($$select 1 from messages where id = %L and body = 'This message was deleted'$$, :'m3'), 1, 'recipient sees it as deleted');
select 'PASSED: deleting messages' as result;
