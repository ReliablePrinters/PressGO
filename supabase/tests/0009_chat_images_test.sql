-- Tests for photos in chat. Fresh database each run.
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
select start_chat(array['00000000-0000-0000-0000-0000000000a4'::uuid]) as dm \gset
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'dm' || '/1-a.jpg'), ('chat-files', :'dm' || '/2-b.png'), ('chat-files', :'dm' || '/3-x.pdf'), ('chat-files', :'dm' || '/4-big.jpg');
set role authenticated;
select pg_temp.ok(format($$select send_attachment(%L, 'look', %L, 'a.jpg', 'image/jpeg', 12345)$$, :'dm', :'dm' || '/1-a.jpg'), 'send a picture to a private chat');
select pg_temp.ok(format($$select send_attachment(%L, '', %L, 'b.png', 'image/png', 999)$$, :'dm', :'dm' || '/2-b.png'), 'picture without caption');
select pg_temp.expect_count(format($$select 1 from messages where conversation_id = %L and attachment_path is not null$$, :'dm'), 2, 'sender sees both pictures');
select pg_temp.expect_count(format($$select 1 from messages where conversation_id = %L and body = 'Photo'$$, :'dm'), 1, 'no caption becomes Photo');
select pg_temp.expect_fail(format($$select send_attachment(%L, '', %L, 'x.pdf', 'application/pdf', 100)$$, :'dm', :'dm' || '/3-x.pdf'), 'non-image refused');
select pg_temp.expect_fail(format($$select send_attachment(%L, '', %L, 'big.jpg', 'image/jpeg', 20000000)$$, :'dm', :'dm' || '/4-big.jpg'), 'oversize refused');
select pg_temp.expect_fail(format($$select send_attachment(%L, '', %L, 'c.jpg', 'image/jpeg', 100)$$, :'dm', gen_random_uuid()::text || '/5-c.jpg'), 'picture stored under another chat refused');
select pg_temp.expect_fail(format($$select send_attachment(%L, '', %L, 'd.jpg', 'image/jpeg', 100)$$, pg_temp.conv('managers'), pg_temp.conv('managers')::text || '/6-d.jpg'), 'cannot post picture where posting is not allowed');
select pg_temp.expect_fail($$update messages set attachment_path = 'x' where attachment_path is not null$$, 'pictures cannot be changed');

-- recipient sees them; others (incl. manager) do not
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count(format($$select 1 from messages where conversation_id = %L and attachment_path is not null$$, :'dm'), 2, 'recipient sees pictures');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count(format($$select 1 from messages where conversation_id = %L and attachment_path is not null$$, :'dm'), 0, 'manager cannot see private pictures');
select pg_temp.expect_fail(format($$select send_attachment(%L, '', %L, 'e.jpg', 'image/jpeg', 100)$$, :'dm', :'dm' || '/7-e.jpg'), 'outsider cannot add a picture to a private chat');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count(format($$select 1 from messages where conversation_id = %L and attachment_path is not null$$, :'dm'), 0, 'front desk cannot see private pictures');
select 'PASSED: chat pictures' as result;
