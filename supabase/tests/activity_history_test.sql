-- Job activity history (Stage 6) reads the audit records the database already keeps (audit_events). This test proves what the
-- Activity section depends on: every important event of a job's life is recorded by the database itself, with the right person, time
-- and old/new values, exactly once; the records are tamper-proof; each role can read only the history of jobs it may open; and an older
-- job with no history is handled. Fresh database each run, all migrations applied. No database change is part of Stage 6.
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
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'FAILED (should have been blocked): %', label; end $$;
create or replace function pg_temp.audit_for(who text, j uuid) returns bigint language plpgsql as $$
declare n bigint; begin perform pg_temp.as_user(who); select count(*) into n from audit_events where job_id = j; return n; end $$;
grant execute on all functions in schema pg_temp to public;

set role authenticated;
-- ===== a whole job life, by different people
select pg_temp.as_user(:'fd');
select (create_job(gen_random_uuid(), 'Acme Ltd', '555-0100', 'Flyers', 'Flyers', 500, 'A5', '150gsm', null, now() + interval '5 days', 'Normal', (select id from departments where name = 'Novelty'), null, true)).id as j \gset
select assign_job(:'j', pg_temp.v(:'j'), '00000000-0000-0000-0000-0000000000a3') \gset
select assign_job(:'j', pg_temp.v(:'j'), null) \gset
select assign_job(:'j', pg_temp.v(:'j'), '00000000-0000-0000-0000-0000000000a3') \gset
select transition_job(:'j', pg_temp.v(:'j'), 'Queued') \gset
reset role;
insert into storage.objects (bucket_id, name) values ('job-files', :'j' || '/flyer.pdf');
select id as jc from conversations where job_id = :'j' \gset
insert into storage.objects (bucket_id, name) values ('chat-files', :'jc' || '/proof.jpg');
set role authenticated;
select pg_temp.as_user(:'nov');
select (register_file(:'j', 'Artwork Revision', 'flyer.pdf', 'application/pdf', 1000, :'j' || '/flyer.pdf')).id as f \gset
select pg_temp.as_user(:'mgr');
select approve_artwork(:'j', pg_temp.v(:'j'), :'f') \gset
select pg_temp.as_user(:'nov');
select send_attachment(:'jc', 'proof for approval', :'jc' || '/proof.jpg', 'proof.jpg', 'image/jpeg', 1000) as pm \gset
select pg_temp.as_user(:'mgr');
select approve_picture(:'pm') \gset
select pg_temp.as_user(:'nov');
select transition_job(:'j', pg_temp.v(:'j'), 'In Production') \gset
select pg_temp.as_user(:'mgr');
select update_job_details(:'j', pg_temp.v(:'j'), 'Acme Ltd', '555-0100', 'Flyers', 'Flyers', 600, 'A5', '150gsm', null, now() + interval '3 days', 'Rush', 'Customer needs them sooner') \gset
select pg_temp.as_user(:'nov');
select (raise_hold(:'j', 'Material shortage', 'Paper stock is short by 50 sheets')).id as h \gset
select pg_temp.as_user(:'fd');
select resolve_hold(:'h', 'More paper delivered') \gset
select pg_temp.as_user(:'nov');
select (handoff_job(:'j', (select id from departments where name = 'Bindery'), 'Please fold and trim')).id as ho \gset
select pg_temp.as_user(:'bin');
select accept_handoff(:'ho', pg_temp.v(:'j')) \gset
select transition_job(:'j', pg_temp.v(:'j'), 'Finishing') \gset
select transition_job(:'j', pg_temp.v(:'j'), 'Ready for Collection') \gset
select pg_temp.as_user(:'fd');
select transition_job(:'j', pg_temp.v(:'j'), 'Collected') \gset

-- ===== 1. every important event is recorded by the database, in order, once (the handoff is recorded twice: the screen shows it once)
select pg_temp.as_user(:'mgr');
select string_agg(action, ',' order by id) as actions from audit_events where job_id = :'j' \gset
select pg_temp.eq(:'actions'::text,
  'job.created,job.assigned,job.unassigned,job.assigned,job.status_queued,file.uploaded,job.artwork_approved,job.picture_approved,job.status_in_production,job.details_changed,job.problem_raised,job.problem_resolved,job.handoff_sent,job.handoff_accepted,job.handoff_accepted,job.status_finishing,job.status_ready_for_collection,job.status_collected',
  'the recorded events of the job, in order');

-- ===== 2. who did it (the person who really did it, not the person looking)
select string_agg(right(actor_id::text, 2), ',' order by id) as who from audit_events where job_id = :'j' \gset
select pg_temp.eq(:'who'::text, 'a2,a2,a2,a2,a2,a3,a1,a1,a3,a1,a3,a2,a3,a4,a4,a4,a4,a2', 'the actor of every event');

-- ===== 3. old and new values, and reasons
select pg_temp.eq((select (before->>'lifecycle_status') || '>' || (after->>'lifecycle_status') from audit_events where job_id = :'j' and action = 'job.status_in_production'), 'Queued>In Production', 'status change old and new');
select pg_temp.eq((select (before->>'priority') || '>' || (after->>'priority') || ' ' || (before->>'quantity') || '>' || (after->>'quantity') from audit_events where job_id = :'j' and action = 'job.details_changed'), 'Normal>Rush 500>600', 'detail change old and new');
select pg_temp.eq((select reason from audit_events where job_id = :'j' and action = 'job.details_changed'), 'Customer needs them sooner', 'the reason is kept');
select pg_temp.eq((select (before->>'due_at') <> (after->>'due_at') from audit_events where job_id = :'j' and action = 'job.details_changed'), true, 'the due date change is in the old and new copies');
select pg_temp.eq((select (before->>'current_assignee_id') is null and (after->>'current_assignee_id') = '00000000-0000-0000-0000-0000000000a3' from (select * from audit_events where job_id = :'j' and action = 'job.assigned' order by id limit 1) q), true, 'first assignment: nobody -> Novelty person');
select pg_temp.eq((select (before->>'current_assignee_id') = '00000000-0000-0000-0000-0000000000a3' and (after->>'current_assignee_id') is null from audit_events where job_id = :'j' and action = 'job.unassigned'), true, 'owner removed');
select pg_temp.eq((select (after->>'current_department_id') = (select id::text from departments where name = 'Bindery') and (after->>'current_assignee_id') = '00000000-0000-0000-0000-0000000000a4' and (before->>'current_department_id') = (select id::text from departments where name = 'Novelty')
                     from (select * from audit_events where job_id = :'j' and action = 'job.handoff_accepted' and after ? 'lifecycle_status') q), true, 'accepting a handoff: the job row shows the department and owner change');
select pg_temp.eq((select (after->>'kind') || '|' || (after->>'note') from audit_events where job_id = :'j' and action = 'job.problem_raised'), 'Material shortage|Paper stock is short by 50 sheets', 'problem raised');
select pg_temp.eq((select after->>'resolution_note' from audit_events where job_id = :'j' and action = 'job.problem_resolved'), 'More paper delivered', 'problem resolved');
select pg_temp.eq((select (after->>'file_name') || '|' || (after->>'category') || '|' || (after->>'version_no') from audit_events where job_id = :'j' and action = 'file.uploaded'), 'flyer.pdf|Artwork Revision|1', 'file uploaded');
select pg_temp.eq((select reason from audit_events where job_id = :'j' and action = 'job.artwork_approved'), 'Approved for Print: flyer.pdf (v1)', 'artwork approval names the file');
select pg_temp.eq((select after->>'file_name' from audit_events where job_id = :'j' and action = 'job.picture_approved'), 'proof.jpg', 'picture approval names the picture');
select pg_temp.eq((select (after->>'note') || '|' || (after->>'to_department_id' = (select id::text from departments where name = 'Bindery'))::text from audit_events where job_id = :'j' and action = 'job.handoff_sent'), 'Please fold and trim|true', 'handoff sent');

-- ===== 4. the saved copies chain together (this is how the screen detects missing history): each change adds one to the job's version
select pg_temp.eq((select count(*) from (select (before->>'version')::int as bv, lag((after->>'version')::int) over (order by id) as pv
                                            from audit_events where job_id = :'j' and after ? 'lifecycle_status' and before is not null) q where bv <> pv), 0::bigint, 'no gaps in the version chain');
select pg_temp.eq((select max((after->>'version')::int) from audit_events where job_id = :'j' and after ? 'lifecycle_status'), pg_temp.v(:'j'), 'the last saved copy is the job as it is now');
select pg_temp.eq((select (after->>'version')::int from audit_events where job_id = :'j' and action = 'job.created'), 1, 'the job started at version 1');
-- timestamps are real and in order
select pg_temp.eq((select count(*) from (select created_at, lag(created_at) over (order by id) as p from audit_events where job_id = :'j') q where p > created_at), 0::bigint, 'timestamps never go backwards');
select pg_temp.eq((select count(*) from audit_events where job_id = :'j' and created_at > now() + interval '1 minute'), 0::bigint, 'no timestamps in the future');

-- ===== 5. recorded even when the change does not come from the app: a direct database edit still leaves a record
reset role;
select set_config('request.jwt.claim.sub', '', false);   -- no signed-in person: like an edit made in the database console
update jobs set priority = 'Low' where id = :'j';
select pg_temp.eq((select action || '|' || coalesce(actor_id::text, 'none') || '|' || (before->>'priority') || '>' || (after->>'priority') from audit_events where job_id = :'j' order by id desc limit 1), 'jobs.update|none|Rush>Low', 'a direct edit is recorded, with no person');
select pg_temp.eq((select ((after->>'version')::int - (before->>'version')::int) from audit_events where job_id = :'j' order by id desc limit 1), 1, 'and keeps the version chain');

-- ===== 6. the records cannot be changed or removed, by anyone
select pg_temp.expect_fail($$update audit_events set action = 'x' where job_id = '$$ || :'j' || $$'$$, 'edited an audit record');
select pg_temp.expect_fail($$delete from audit_events where job_id = '$$ || :'j' || $$'$$, 'deleted an audit record');
set role authenticated;
select pg_temp.as_user(:'mgr');
select pg_temp.expect_fail($$update pressgo.audit_events set action = 'x'$$, 'a manager edited the audit log');
select pg_temp.expect_fail($$insert into pressgo.audit_events (action) values ('forged')$$, 'a manager forged an audit record');
select pg_temp.as_user(:'fd');
select pg_temp.expect_fail($$update pressgo.jobs set priority = 'Rush'$$, 'front desk changed a job without going through the audited functions');

-- ===== 7. each role reads only the history of jobs it may open
select pg_temp.eq(pg_temp.audit_for(:'mgr', :'j'), 19::bigint, 'manager reads the whole history');
select pg_temp.eq(pg_temp.audit_for(:'fd',  :'j'), 19::bigint, 'front desk (who created the job) reads it');
select pg_temp.eq(pg_temp.audit_for(:'bin', :'j'), 19::bigint, 'production staff who own the job read it');
select pg_temp.eq(pg_temp.audit_for(:'nov', :'j'), 0::bigint, 'production staff of another department, after the job was handed on, read nothing');
select pg_temp.eq(pg_temp.audit_for(:'old', :'j'), 0::bigint, 'a disabled employee reads nothing');
select pg_temp.eq(pg_temp.audit_for(:'out', :'j'), 0::bigint, 'a login that is not an employee reads nothing');
-- records about people and departments (no job) are for managers only
select pg_temp.as_user(:'mgr');
select pg_temp.eq((select count(*) > 0 from audit_events where job_id is null), true, 'managers can read the people and department records');
select pg_temp.as_user(:'fd');
select pg_temp.eq((select count(*) from audit_events where job_id is null), 0::bigint, 'front desk cannot');
select pg_temp.as_user(:'bin');
select pg_temp.eq((select count(*) from audit_events where job_id is null), 0::bigint, 'production staff cannot');
-- a job someone else owns, in another department, is invisible to production staff, history included
select pg_temp.as_user(:'mgr');
select (create_job(gen_random_uuid(), 'Other Co', null, 'Cards', null, 10, null, null, null, now() + interval '2 days', 'Normal', (select id from departments where name = 'Novelty'), '00000000-0000-0000-0000-0000000000a3', false)).id as j2 \gset
select pg_temp.eq(pg_temp.audit_for(:'bin', :'j2'), 0::bigint, 'Bindery staff cannot read the history of a Novelty job');
select pg_temp.eq(pg_temp.audit_for(:'nov', :'j2'), 1::bigint, 'the Novelty owner can');
select pg_temp.eq(pg_temp.audit_for(:'fd', :'j2'), 1::bigint, 'front desk can see a New job');
-- a deleted job: its history disappears for everyone but managers
select pg_temp.as_user(:'mgr');
select delete_job(:'j2', pg_temp.v(:'j2'), 'duplicate entry') \gset
select pg_temp.eq(pg_temp.audit_for(:'nov', :'j2'), 0::bigint, 'the owner cannot read the history of a deleted job');
select pg_temp.as_user(:'mgr');
select pg_temp.eq((select count(*) from audit_events where job_id = :'j2' and action = 'job.deleted'), 1::bigint, 'a manager still can (the deletion is recorded)');

-- ===== 8. an older job with incomplete history
reset role;
alter table jobs disable trigger audit_jobs;
insert into jobs (id, customer_name, description, quantity, due_at, lifecycle_status, current_department_id, artwork_required, created_by, version, created_at)
 values ('99999999-0000-0000-0000-000000000001', 'Legacy Customer', 'Old job', 5, now() + interval '1 day', 'In Production', (select id from departments where name = 'Bindery'), false,
         '00000000-0000-0000-0000-0000000000a2', 4, now() - interval '90 days');
alter table jobs enable trigger audit_jobs;
set role authenticated;
select pg_temp.as_user(:'mgr');
select pg_temp.as_user(:'mgr');
select pg_temp.eq((select count(*) from audit_events where job_id = '99999999-0000-0000-0000-000000000001'), 0::bigint, 'the older job has no history rows');
select pg_temp.eq((select version from jobs where id = '99999999-0000-0000-0000-000000000001'), 4, 'but the job itself says it changed 3 times (this is what the screen uses to say so)');
select pg_temp.eq((select created_by from jobs where id = '99999999-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-0000000000a2'::uuid, 'and who created it');
-- the next real change on it is recorded from version 4, so the missing three show up as a gap instead of being invented
select assign_job('99999999-0000-0000-0000-000000000001', pg_temp.v('99999999-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-0000000000a4') \gset
select pg_temp.eq((select (before->>'version')::int || '>' || (after->>'version')::int from audit_events where job_id = '99999999-0000-0000-0000-000000000001'), '4>5', 'the first recorded change starts at version 4');

-- ===== 9. nothing new was added to the database for this feature
reset role;
select pg_temp.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and (p.proname ilike '%activity%' or p.proname ilike '%history%')), 0::bigint, 'no new database functions');
select 'PASSED: job activity history (recorded by the database, correct actors and values, tamper-proof, role-restricted, older jobs handled)' as result;
