-- My Work (Stage 7) adds no database functions or tables. It asks for jobs, problems, handoffs, tasks, files, chat pictures, audit
-- records and the conversation list exactly like the existing screens, with the signed-in person's own login. This test runs the
-- page's exact questions as a manager, front desk, two production staff in different departments, a disabled employee and a
-- non-employee login, and proves nobody gets back anything they may not open. Fresh database each run, all migrations applied.
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
\set mgr '10000000-0000-0000-0000-0000000000a1'
\set fd  '10000000-0000-0000-0000-0000000000a2'
\set nov '10000000-0000-0000-0000-0000000000a3'
\set bin '10000000-0000-0000-0000-0000000000a4'
\set old '10000000-0000-0000-0000-0000000000a5'
\set out '10000000-0000-0000-0000-0000000000b0'

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.v(j uuid) returns integer language sql as $$ select version from jobs where id = j $$;
create or replace function pg_temp.eq(got anyelement, want anyelement, label text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.conv(n text) returns uuid language sql as $$ select id from conversations where name = n $$;
-- the page's exact questions
create or replace function pg_temp.q_jobs(who text) returns text language plpgsql as $$
declare r text; begin perform pg_temp.as_user(who);
  select coalesce(string_agg(customer_name, ',' order by customer_name), '') into r from jobs where lifecycle_status not in ('Collected','Cancelled'); return r; end $$;
create or replace function pg_temp.q_holds(who text) returns text language plpgsql as $$
declare r text; begin perform pg_temp.as_user(who);
  select coalesce(string_agg(j.customer_name, ',' order by j.customer_name), '') into r from job_holds h join jobs j on j.id = h.job_id where h.resolved_at is null; return r; end $$;
create or replace function pg_temp.q_handoffs(who text) returns bigint language plpgsql as $$
declare r bigint; begin perform pg_temp.as_user(who); select count(*) into r from job_handoffs where status = 'Pending'; return r; end $$;
create or replace function pg_temp.q_tasks(who text) returns text language plpgsql as $$
declare r text; me uuid; begin perform pg_temp.as_user(who); select current_employee_id() into me;
  select coalesce(string_agg(title, ',' order by title), '') into r from tasks where done_at is null and assigned_to = me; return r; end $$;
create or replace function pg_temp.q_alltasks(who text) returns text language plpgsql as $$
declare r text; begin perform pg_temp.as_user(who);
  select coalesce(string_agg(title, ',' order by title), '') into r from tasks where done_at is null; return r; end $$;
create or replace function pg_temp.q_files(who text) returns text language plpgsql as $$
declare r text; begin perform pg_temp.as_user(who);
  select coalesce(string_agg(file_name, ',' order by file_name), '') into r from job_files; return r; end $$;
create or replace function pg_temp.q_pictures(who text) returns text language plpgsql as $$
declare r text; me uuid; begin perform pg_temp.as_user(who); select current_employee_id() into me;
  select coalesce(string_agg(attachment_name, ',' order by attachment_name), '') into r from messages where attachment_path is not null and hidden_at is null and approved_at is null and author_id is distinct from me; return r; end $$;
create or replace function pg_temp.q_audit(who text, j uuid) returns bigint language plpgsql as $$
declare r bigint; begin perform pg_temp.as_user(who); select count(*) into r from audit_events where job_id = j; return r; end $$;
create or replace function pg_temp.q_convs(who text) returns text language plpgsql as $$
declare r text; begin perform pg_temp.as_user(who);
  select coalesce(string_agg(name, ',' order by name), '') into r from my_conversations() where unread > 0; return r; end $$;
grant execute on all functions in schema pg_temp to public;

set role authenticated;
-- ===== data
select pg_temp.as_user(:'mgr');
select (create_job(gen_random_uuid(), 'NovJob',  null, 'a', null, 5, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), '00000000-0000-0000-0000-0000000000a3', true)).id as jn \gset
select (create_job(gen_random_uuid(), 'BinJob',  null, 'b', null, 5, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Bindery'), '00000000-0000-0000-0000-0000000000a4', true)).id as jb \gset
select (create_job(gen_random_uuid(), 'MgrJob',  null, 'c', null, 5, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Managers'), null, false)).id as jm \gset
select pg_temp.as_user(:'fd');
select (create_job(gen_random_uuid(), 'NewJob',  null, 'd', null, 5, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), null, true)).id as jw \gset
select pg_temp.as_user(:'mgr');
select transition_job(:'jn', pg_temp.v(:'jn'), 'Queued') \gset
select transition_job(:'jb', pg_temp.v(:'jb'), 'Queued') \gset
select transition_job(:'jm', pg_temp.v(:'jm'), 'Queued') \gset
reset role;
update jobs set lifecycle_status = 'In Production' where id in (:'jn', :'jb');           -- (setup only: these two are being worked on)
insert into storage.objects (bucket_id, name) values ('job-files', :'jn' || '/nov.pdf'), ('job-files', :'jb' || '/bin.pdf'), ('job-files', :'jm' || '/mgr.pdf');
select id as cb from conversations where job_id = :'jb' \gset
select id as cn from conversations where job_id = :'jn' \gset
select id as cg from conversations where name = 'General' \gset
insert into storage.objects (bucket_id, name) values ('chat-files', :'cg' || '/g.jpg'), ('chat-files', :'cb' || '/jb.jpg'), ('chat-files', :'cn' || '/jn.jpg');
set role authenticated;
select pg_temp.as_user(:'nov');
select register_file(:'jn', 'Artwork Revision', 'nov.pdf', 'application/pdf', 100, :'jn' || '/nov.pdf') \gset
select send_attachment(:'cg', 'general pic', :'cg' || '/g.jpg', 'general.jpg', 'image/jpeg', 100) \gset
select send_attachment(:'cn', 'job pic', :'cn' || '/jn.jpg', 'novjob.jpg', 'image/jpeg', 100) \gset
select raise_hold(:'jn', 'Machine problem', 'press is jammed') \gset
select start_chat(array['00000000-0000-0000-0000-0000000000a4'::uuid]) as dm \gset
reset role;
insert into storage.objects (bucket_id, name) values ('chat-files', :'dm' || '/dm.jpg');
set role authenticated;
select send_attachment(:'dm', 'private pic', :'dm' || '/dm.jpg', 'private.jpg', 'image/jpeg', 100) \gset
select pg_temp.as_user(:'bin');
select register_file(:'jb', 'Artwork Revision', 'bin.pdf', 'application/pdf', 100, :'jb' || '/bin.pdf') \gset
select send_attachment(:'cb', 'bin pic', :'cb' || '/jb.jpg', 'binjob.jpg', 'image/jpeg', 100) \gset
select raise_hold(:'jb', 'Quality problem', 'colour is off') \gset
select pg_temp.as_user(:'mgr');
select register_file(:'jm', 'Artwork Revision', 'mgr.pdf', 'application/pdf', 100, :'jm' || '/mgr.pdf') \gset
select create_task('Nov task', null, '00000000-0000-0000-0000-0000000000a3', now() + interval '1 day', :'jn') \gset
select create_task('Bin task', null, '00000000-0000-0000-0000-0000000000a4', now() + interval '1 day', :'jb') \gset
select create_task('Manager task', null, '00000000-0000-0000-0000-0000000000a1', null, :'jm') \gset
select pg_temp.as_user(:'bin');
-- a pending handoff to Novelty
select handoff_job(:'jb', (select id from departments where name = 'Novelty'), 'needs foil') \gset
select pg_temp.as_user(:'nov');
select send_message(:'cg', 'hello everyone') \gset

-- ===== JOBS the page lists
select pg_temp.eq(pg_temp.q_jobs(:'mgr'), 'BinJob,MgrJob,NewJob,NovJob', 'manager sees every open job');
select pg_temp.eq(pg_temp.q_jobs(:'fd'),  'NewJob', 'front desk sees the job they created (it is New), not jobs being produced');
select pg_temp.eq(pg_temp.q_jobs(:'nov'), 'BinJob,NewJob,NovJob', 'Novelty staff: their own job, the unassigned Novelty job, and the Bindery job that was handed to Novelty');
select pg_temp.eq(pg_temp.q_jobs(:'bin'), 'BinJob', 'Bindery staff see only their own job (no Novelty job, no manager job)');
select pg_temp.eq(pg_temp.q_jobs(:'old'), '', 'a disabled employee sees no jobs');
select pg_temp.eq(pg_temp.q_jobs(:'out'), '', 'a login that is not an employee sees no jobs');
-- ===== PROBLEMS (needs attention)
select pg_temp.eq(pg_temp.q_holds(:'mgr'), 'BinJob,NovJob', 'manager sees both problems');
select pg_temp.eq(pg_temp.q_holds(:'nov'), 'BinJob,NovJob', 'Novelty staff see the problem on their own job and on the job handed to them');
select pg_temp.eq(pg_temp.q_holds(:'bin'), 'BinJob', 'Bindery staff see only their own problem');
select pg_temp.eq(pg_temp.q_holds(:'fd'), '', 'front desk sees no problems on jobs they cannot open');
select pg_temp.eq(pg_temp.q_holds(:'out'), '', 'non-employee sees none');
-- ===== HANDOFFS waiting
select pg_temp.eq(pg_temp.q_handoffs(:'mgr'), 1::bigint, 'manager sees the pending handoff');
select pg_temp.eq(pg_temp.q_handoffs(:'nov'), 1::bigint, 'the receiving department sees it');
select pg_temp.eq(pg_temp.q_handoffs(:'bin'), 1::bigint, 'the sender can see it');
select pg_temp.eq(pg_temp.q_handoffs(:'fd'), 0::bigint, 'front desk cannot');
select pg_temp.eq(pg_temp.q_handoffs(:'out'), 0::bigint, 'non-employee cannot');
-- ===== TASKS: your own list is yours; the wider table never leaks other departments'
select pg_temp.eq(pg_temp.q_tasks(:'nov'), 'Nov task', 'Novelty: own task only');
select pg_temp.eq(pg_temp.q_tasks(:'bin'), 'Bin task', 'Bindery: own task only');
select pg_temp.eq(pg_temp.q_tasks(:'mgr'), 'Manager task', 'manager: own task');
select pg_temp.eq(pg_temp.q_alltasks(:'bin'), 'Bin task', 'Bindery cannot see Novelty or manager tasks at all');
select pg_temp.eq(pg_temp.q_alltasks(:'nov'), 'Bin task,Nov task', 'Novelty sees the task on the job handed to them (they can open that job) but never the manager task');
select pg_temp.eq(pg_temp.q_alltasks(:'fd'), '', 'front desk sees no tasks that are not theirs or about jobs they can open');
select pg_temp.eq(pg_temp.q_alltasks(:'mgr'), 'Bin task,Manager task,Nov task', 'manager sees all tasks');
select pg_temp.eq(pg_temp.q_tasks(:'out'), '', 'non-employee has none');
-- ===== FILES (artwork waiting for approval): only for jobs the person can open
select pg_temp.eq(pg_temp.q_files(:'mgr'), 'bin.pdf,mgr.pdf,nov.pdf', 'manager sees all artwork files');
select pg_temp.eq(pg_temp.q_files(:'fd'), '', 'front desk cannot see artwork of jobs they cannot open');
select pg_temp.eq(pg_temp.q_files(:'bin'), 'bin.pdf', 'Bindery sees only their file');
-- ===== CHAT PICTURES awaiting approval (asked only by people who can approve)
select pg_temp.eq(pg_temp.q_pictures(:'mgr'), 'binjob.jpg,general.jpg,novjob.jpg', 'manager: General and the two job chats, not the private chat between two colleagues');
select pg_temp.eq(pg_temp.q_pictures(:'fd'), 'general.jpg', 'front desk: only the General picture (no job chats they cannot open, no private chats)');
select pg_temp.eq(pg_temp.q_pictures(:'out'), '', 'non-employee: none');
-- ===== AUDIT (recent activity) follows the job
select pg_temp.eq(pg_temp.q_audit(:'bin', :'jn') , 0::bigint, 'Bindery staff cannot read the history of a Novelty job');
select pg_temp.eq(pg_temp.q_audit(:'nov', :'jn') > 0, true, 'the Novelty owner can');
select pg_temp.eq(pg_temp.q_audit(:'fd', :'jm'), 0::bigint, 'front desk cannot read the history of the manager job');
-- ===== UNREAD conversations: the list the page shows is the person's own
select pg_temp.eq(pg_temp.q_convs(:'bin') like '%NoveltyStaff%', true, 'Bindery sees the unread private chat from Novelty');
select pg_temp.eq(pg_temp.q_convs(:'fd') like '%NoveltyStaff%', false, 'front desk does not see a private chat between two colleagues');
select pg_temp.eq(pg_temp.q_convs(:'mgr') like '%NoveltyStaff%', false, 'a manager does not see a private chat between two colleagues');
select pg_temp.eq(pg_temp.q_convs(:'nov') like '%managers%', false, 'production staff do not see the managers-only channel');
select pg_temp.eq(pg_temp.q_convs(:'out'), '', 'non-employee has no conversations');

-- ===== no new database objects for this page
reset role;
select pg_temp.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and (p.proname ilike '%my_work%' or p.proname ilike '%mywork%')), 0::bigint, 'no new database functions');
select 'PASSED: My work shows each role only what it may open (5 roles, a disabled account and a non-employee login)' as result;
