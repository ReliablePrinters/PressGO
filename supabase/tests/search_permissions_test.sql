-- Global search (Stage 5) uses no database functions of its own: it asks for jobs, people, messages and the conversation list
-- exactly like every other screen, with the signed-in person's own login. So the only thing to prove is that those same
-- questions never return anything a person may not open. This test runs the search's exact questions as five different people
-- (a manager, front desk, two production staff in different departments), a disabled employee, and a signed-in login that is
-- not an employee at all. Fresh database each run, all migrations applied.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','old@x.test','FormerStaff',false,false,false);
insert into department_memberships (employee_id, department_id)
 select v.id, d.id from (values ('00000000-0000-0000-0000-0000000000a2'::uuid,'Front Desk'),('00000000-0000-0000-0000-0000000000a3','Novelty'),('00000000-0000-0000-0000-0000000000a4','Bindery'),('00000000-0000-0000-0000-0000000000a1','Managers')) v(id, dn)
 join departments d on d.name = v.dn;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.conv(n text) returns uuid language sql as $$ select id from conversations where name = n $$;
grant execute on all functions in schema pg_temp to public;

set role authenticated;
-- ===== data: four jobs and a spread of messages, all containing the word "zenith"
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select (create_job(gen_random_uuid(), 'Zenith Cafe',  '555-0101', 'menus',   'Menus', 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), null, false)).id as j1 \gset
select (create_job(gen_random_uuid(), 'Zenith Books', '555-0102', 'booklets','Books', 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Bindery'), '00000000-0000-0000-0000-0000000000a4', false)).id as j2 \gset
select (create_job(gen_random_uuid(), 'Zenith Gifts', '555-0103', 'gift cards','Gifts', 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), '00000000-0000-0000-0000-0000000000a3', false)).id as j3 \gset
select (create_job(gen_random_uuid(), 'Zenith Gone',  '555-0104', 'removed', 'Gone', 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Bindery'), null, false)).id as j4 \gset
select job_number as n1 from jobs where id = :'j1' \gset
reset role;
update jobs set lifecycle_status = 'In Production' where id = :'j2';
update jobs set lifecycle_status = 'Ready for Collection' where id = :'j3';
select id as c2 from conversations where job_id = :'j2' \gset
select id as c4 from conversations where job_id = :'j4' \gset
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select send_message(:'c4', 'zenith note in the job that will be deleted') \gset
select send_message(pg_temp.conv('managers'), 'zenith managers only talk') \gset
select send_message(:'c2', 'zenith note on the books job') \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select send_message(pg_temp.conv('General'), 'zenith proof is ready') \gset
select send_message(pg_temp.conv('novelty'), 'zenith novelty department plan') \gset
select send_message(pg_temp.conv('General'), 'zenith this one will be removed') as gone \gset
select delete_message(:'gone'::uuid);
select start_chat(array['00000000-0000-0000-0000-0000000000a4'::uuid]) as dm \gset
select send_message(:'dm', 'zenith private lunch plan') \gset
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select delete_job(:'j4', (select version from jobs where id = :'j4'), 'search permission test: removed job') \gset

-- The exact questions search.js asks (jobs by words in customer, description, product or phone; job by number; people; messages; conversations).
create or replace function pg_temp.jobs_for(who text, word text) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who);
  select count(*) into n from jobs where (customer_name ilike '%'||word||'%' or description ilike '%'||word||'%' or product ilike '%'||word||'%' or customer_phone ilike '%'||word||'%'); return n; end $$;
create or replace function pg_temp.msgs_for(who text, word text) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who);
  select count(*) into n from messages where hidden_at is null and body ilike '%'||word||'%'; return n; end $$;
create or replace function pg_temp.people_for(who text, word text) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who);
  select count(*) into n from employees where active and display_name ilike '%'||word||'%'; return n; end $$;
create or replace function pg_temp.convs_for(who text, word text) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who);
  select count(*) into n from my_conversations() where name ilike '%'||word||'%'; return n; end $$;
create or replace function pg_temp.convs_named(who text, nm text) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who);
  select count(*) into n from my_conversations() where name = nm; return n; end $$;
create or replace function pg_temp.jobno_for(who text, num bigint) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who);
  select count(*) into n from jobs where job_number = num; return n; end $$;
grant execute on all functions in schema pg_temp to public;
\set mgr '10000000-0000-0000-0000-0000000000a1'
\set fd  '10000000-0000-0000-0000-0000000000a2'
\set nov '10000000-0000-0000-0000-0000000000a3'
\set bin '10000000-0000-0000-0000-0000000000a4'
\set old '10000000-0000-0000-0000-0000000000a5'
\set out '10000000-0000-0000-0000-0000000000b0'

-- ===== JOBS: each person finds exactly the jobs they could already open
select 1 / case when pg_temp.jobs_for(:'mgr','zenith') = 3 then 1 else 0 end;   -- manager: cafe, books, gifts (the removed job is gone for everyone)
select 1 / case when pg_temp.jobs_for(:'fd','zenith')  = 2 then 1 else 0 end;    -- front desk: New (cafe) and Ready (gifts), not the one in production
select 1 / case when pg_temp.jobs_for(:'nov','zenith') = 2 then 1 else 0 end;    -- Novelty: the unassigned Novelty job and their own
select 1 / case when pg_temp.jobs_for(:'bin','zenith') = 1 then 1 else 0 end;    -- Bindery: only the books job
select 1 / case when pg_temp.jobs_for(:'old','zenith') = 0 then 1 else 0 end;    -- a disabled employee finds nothing
select 1 / case when pg_temp.jobs_for(:'out','zenith') = 0 then 1 else 0 end;    -- a login that is not an employee finds nothing
-- searching by phone or by product follows the same rules
select 1 / case when pg_temp.jobs_for(:'bin','555-0101') = 0 and pg_temp.jobs_for(:'nov','555-0101') = 1 and pg_temp.jobs_for(:'bin','Books') = 1 and pg_temp.jobs_for(:'nov','Books') = 0 then 1 else 0 end;
-- the removed job cannot be found by anyone, even a manager, by words or by number
select 1 / case when pg_temp.jobs_for(:'mgr','Gone') = 0 and pg_temp.jobno_for(:'mgr', (select job_number from jobs where id = :'j4')) = 0 then 1 else 0 end;
-- a job number only resolves for people who can open that job
select 1 / case when pg_temp.jobno_for(:'mgr', :n1) = 1 and pg_temp.jobno_for(:'nov', :n1) = 1 and pg_temp.jobno_for(:'bin', :n1) = 0 and pg_temp.jobno_for(:'out', :n1) = 0 then 1 else 0 end;

-- ===== MESSAGES: only chats the person can read, and never removed messages
select 1 / case when pg_temp.msgs_for(:'mgr','zenith') = 4 then 1 else 0 end;    -- General, Novelty, Managers channel, the books job chat (not the private chat, not the removed message, not the deleted job)
select 1 / case when pg_temp.msgs_for(:'fd','zenith')  = 1 then 1 else 0 end;    -- General only
select 1 / case when pg_temp.msgs_for(:'nov','zenith') = 3 then 1 else 0 end;    -- General, Novelty, and the private chat they are in
select 1 / case when pg_temp.msgs_for(:'bin','zenith') = 3 then 1 else 0 end;    -- General, the private chat, the books job chat
select 1 / case when pg_temp.msgs_for(:'old','zenith') = 0 then 1 else 0 end;
select 1 / case when pg_temp.msgs_for(:'out','zenith') = 0 then 1 else 0 end;
-- nobody else can read the private chat between two people, not even a manager
select 1 / case when pg_temp.msgs_for(:'mgr','private lunch') = 0 and pg_temp.msgs_for(:'fd','private lunch') = 0 and pg_temp.msgs_for(:'nov','private lunch') = 1 and pg_temp.msgs_for(:'bin','private lunch') = 1 then 1 else 0 end;
-- the managers-only channel stays managers-only
select 1 / case when pg_temp.msgs_for(:'mgr','managers only') = 1 and pg_temp.msgs_for(:'nov','managers only') = 0 and pg_temp.msgs_for(:'bin','managers only') = 0 and pg_temp.msgs_for(:'fd','managers only') = 0 then 1 else 0 end;
-- a removed message is not found, and a message in a deleted job's chat is not found by anyone
select 1 / case when pg_temp.msgs_for(:'mgr','will be removed') = 0 and pg_temp.msgs_for(:'nov','will be removed') = 0 and pg_temp.msgs_for(:'mgr','will be deleted') = 0 then 1 else 0 end;
-- a message in a job chat is found only by people who can open that job
select 1 / case when pg_temp.msgs_for(:'bin','books job') = 1 and pg_temp.msgs_for(:'mgr','books job') = 1 and pg_temp.msgs_for(:'nov','books job') = 0 and pg_temp.msgs_for(:'fd','books job') = 0 then 1 else 0 end;

-- ===== CONVERSATIONS (the list the app already shows each person)
select 1 / case when pg_temp.convs_for(:'mgr','managers') = 1 and pg_temp.convs_for(:'nov','managers') = 0 and pg_temp.convs_for(:'bin','managers') = 0 and pg_temp.convs_for(:'fd','managers') = 0 then 1 else 0 end;
select 1 / case when pg_temp.convs_named(:'nov','novelty') = 1 and pg_temp.convs_named(:'bin','novelty') = 0 and pg_temp.convs_named(:'fd','novelty') = 0 and pg_temp.convs_named(:'mgr','novelty') = 1 then 1 else 0 end;   -- the Novelty department channel
select 1 / case when pg_temp.convs_for(:'nov','BinderyStaff') = 1 and pg_temp.convs_for(:'bin','NoveltyStaff') = 1 and pg_temp.convs_for(:'mgr','Staff') = 0 and pg_temp.convs_for(:'fd','Staff') = 0 then 1 else 0 end;   -- the private chat is named after the other person, and only its two members see it
select 1 / case when pg_temp.convs_for(:'bin','Zenith Books') = 1 and pg_temp.convs_for(:'mgr','Zenith Books') = 1 and pg_temp.convs_for(:'nov','Zenith Books') = 0 and pg_temp.convs_for(:'mgr','Zenith Gone') = 0 then 1 else 0 end;

-- ===== PEOPLE: colleagues are visible to active staff (as on the existing screens); not to outsiders or disabled accounts, and disabled accounts are not offered
select 1 / case when pg_temp.people_for(:'fd','Bindery') = 1 and pg_temp.people_for(:'bin','NoveltyStaff') = 1 then 1 else 0 end;
select 1 / case when pg_temp.people_for(:'mgr','FormerStaff') = 0 then 1 else 0 end;
select 1 / case when pg_temp.people_for(:'out','Staff') = 0 and pg_temp.people_for(:'old','NoveltyStaff') = 0 then 1 else 0 end;

-- ===== the search adds no database objects: nothing new is callable by the public
reset role;
select 1 / case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and p.proname ilike '%search%') then 1 else 0 end;
select 'PASSED: search finds only what each person may already open (5 roles, a disabled account and a non-employee login)' as result;
