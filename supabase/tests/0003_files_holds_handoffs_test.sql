-- Tests for Phase 3 (files, artwork approval, problems, handoffs). Fresh database each run.
\set ON_ERROR_STOP on
set search_path = pressgo, public;

insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false),
 ('00000000-0000-0000-0000-0000000000a7','10000000-0000-0000-0000-0000000000a7','nov2@x.test','Novelty2',false,false);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),
   ('00000000-0000-0000-0000-0000000000a7','Novelty'),('00000000-0000-0000-0000-0000000000a4','Bindery'),
   ('00000000-0000-0000-0000-0000000000a2','Front Desk')) v(id,dn)
 join employees e on e.id = v.id join departments d on d.name = v.dn;

create or replace function pg_temp.as_user(u text, e text default '') returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', e, false); end $$;
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'FAILED (should have been blocked): %', label; end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.ok(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise exception 'FAILED (should have worked): % -- %', label, sqlerrm; end; end $$;
create or replace function pg_temp.v(j uuid) returns integer language sql as $$ select version from jobs where id = j $$;
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;

-- a job with artwork required, in Novelty, owned by NoveltyStaff, plus one in Bindery
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_job('60000000-0000-0000-0000-000000000001','Acme',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
select create_job('60000000-0000-0000-0000-000000000002','Beta',null,'Bindery job',null,5,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Bindery'),null,true);
reset role;
create temp table j as select (select id from jobs where customer_name='Acme') as a, (select id from jobs where customer_name='Beta') as b;
grant select on j to authenticated;
-- storage objects "uploaded by the browser" (the real storage rules are exercised below)
insert into storage.objects (bucket_id, name) select 'job-files', a::text || '/orig-1.pdf' from j;
insert into storage.objects (bucket_id, name) select 'job-files', a::text || '/orig-2.pdf' from j;
insert into storage.objects (bucket_id, name) select 'job-files', a::text || '/tool.exe' from j;
insert into storage.objects (bucket_id, name) select 'job-files', a::text || '/doc.txt' from j;
insert into storage.objects (bucket_id, name) select 'job-files', a::text || '/approved.pdf' from j;
insert into storage.objects (bucket_id, name) select 'job-files', b::text || '/b.pdf' from j;
set role authenticated;

-- ===== storage visibility (who can read / add files in the private bucket)
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');   -- Novelty staff
select pg_temp.expect_count($$select 1 from storage.objects where name like (select a::text from j) || '/%'$$, 5, 'novelty staff cannot see own job files');
select pg_temp.expect_count($$select 1 from storage.objects where name like (select b::text from j) || '/%'$$, 0, 'novelty staff sees bindery job files');
select pg_temp.expect_fail($$insert into storage.objects (bucket_id, name) select 'job-files', b::text || '/sneak.pdf' from j$$, 'staff added a file to a job they cannot see');
select pg_temp.ok($$insert into storage.objects (bucket_id, name) select 'job-files', a::text || '/new.pdf' from j$$, 'staff add file to own job');
select pg_temp.as_user('');
select pg_temp.expect_count($$select 1 from storage.objects$$, 0, 'signed-out visitor reads files');

-- ===== registering files
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select register_file((select a from j),'Customer Original','logo.pdf','application/pdf',1000,(select a::text from j)||'/orig-1.pdf')$$, 'staff register file');
select pg_temp.ok($$select register_file((select a from j),'Customer Original','logo.pdf','application/pdf',1000,(select a::text from j)||'/orig-2.pdf')$$, 'second version');
select pg_temp.expect_count($$select 1 from job_files where file_name='logo.pdf' and version_no=2$$, 1, 'version number did not count up');
select pg_temp.expect_fail($$select register_file((select a from j),'Customer Original','x.pdf','application/pdf',1000,(select a::text from j)||'/never-uploaded.pdf')$$, 'registered a file that was never uploaded');
select pg_temp.expect_fail($$select register_file((select a from j),'Customer Original','tool.exe','application/x-msdownload',1000,(select a::text from j)||'/tool.exe')$$, 'program file accepted');
select pg_temp.expect_fail($$select register_file((select a from j),'Customer Original','big.pdf','application/pdf',104857601,(select a::text from j)||'/orig-1.pdf')$$, 'file over 100 MB accepted');
select pg_temp.expect_fail($$select register_file((select a from j),'Customer Original','empty.pdf','application/pdf',0,(select a::text from j)||'/orig-1.pdf')$$, 'empty file accepted');
select pg_temp.expect_fail($$select register_file((select a from j),'Whatever','x.pdf','application/pdf',10,(select a::text from j)||'/orig-1.pdf')$$, 'unknown category');
select pg_temp.expect_fail($$select register_file((select a from j),'Production Approved','x.pdf','application/pdf',10,(select a::text from j)||'/approved.pdf')$$, 'staff added Production Approved file');
select pg_temp.expect_fail($$select register_file((select a from j),'Supporting Document','x.pdf','application/pdf',10,(select b from j)||'/b.pdf')$$, 'file path from another job');
select pg_temp.expect_fail($$select register_file((select b from j),'Supporting Document','b.pdf','application/pdf',10,(select b from j)||'/b.pdf')$$, 'staff added file to job they cannot see');
select pg_temp.expect_fail($$update job_files set file_name='hacked'$$, 'staff edited a file record');
select pg_temp.expect_fail($$delete from job_files$$, 'staff deleted a file record');
select pg_temp.expect_count($$select 1 from job_files$$, 2, 'file list wrong for own job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');   -- Bindery staff, other department
select pg_temp.expect_count($$select 1 from job_files$$, 0, 'bindery staff sees novelty file records');

-- ===== artwork approval gates the start
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select transition_job((select a from j), pg_temp.v((select a from j)), 'Queued')$$, 'release');
select pg_temp.ok($$select register_file((select a from j),'Production Approved','final.pdf','application/pdf',2000,(select a::text from j)||'/approved.pdf')$$, 'front desk adds production approved file');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail($$select transition_job((select a from j), pg_temp.v((select a from j)), 'In Production')$$, 'started without approved artwork');
select pg_temp.expect_fail($$select approve_artwork((select a from j), pg_temp.v((select a from j)), (select id from job_files where file_name='final.pdf'))$$, 'staff approved artwork');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select approve_artwork((select a from j), pg_temp.v((select a from j)), (select id from job_files where file_name='final.pdf'))$$, 'front desk approves artwork (0014)');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok($$select approve_artwork((select a from j), pg_temp.v((select a from j)), (select id from job_files where file_name='final.pdf'))$$, 'manager approves');
select pg_temp.expect_count($$select 1 from audit_events where action='job.artwork_approved' and reason like 'Approved for Print: final.pdf%'$$, 2, 'approvals not in history');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select transition_job((select a from j), pg_temp.v((select a from j)), 'In Production')$$, 'owner starts after approval');

-- ===== problems block progress
select pg_temp.ok($$select raise_hold((select a from j),'Material shortage','out of gloss stock')$$, 'owner raises problem');
select pg_temp.expect_fail($$select raise_hold((select a from j),'Other','  ')$$, 'blank problem');
select pg_temp.expect_fail($$select transition_job((select a from j), pg_temp.v((select a from j)), 'Finishing')$$, 'moved on with an open problem');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail($$select raise_hold((select a from j),'Other','x')$$, 'staff raised problem on job they cannot see');
select pg_temp.expect_count($$select 1 from job_holds$$, 0, 'bindery staff sees novelty problems');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');   -- other Novelty staff, not owner, not raiser
select pg_temp.expect_fail($$select resolve_hold((select id from job_holds limit 1),'fixed')$$, 'unrelated staff resolved problem');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail($$select resolve_hold((select id from job_holds limit 1),'')$$, 'resolved without note');
select pg_temp.ok($$select resolve_hold((select id from job_holds limit 1),'stock arrived')$$, 'raiser resolves');
select pg_temp.expect_fail($$select resolve_hold((select id from job_holds limit 1),'again')$$, 'resolved twice');
select pg_temp.ok($$select transition_job((select a from j), pg_temp.v((select a from j)), 'Finishing')$$, 'moves on after resolution');
select pg_temp.expect_count($$select 1 from audit_events where action in ('job.problem_raised','job.problem_resolved')$$, 2, 'problem history missing');

-- ===== withdrawing approval
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select withdraw_artwork_approval((select a from j), pg_temp.v((select a from j)), '')$$, 'withdrew without reason');
select pg_temp.ok($$select withdraw_artwork_approval((select a from j), pg_temp.v((select a from j)), 'customer sent new logo')$$, 'withdraw with reason');

-- ===== handoffs
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');   -- not the owner
select pg_temp.expect_fail($$select handoff_job((select a from j), pg_temp.dept('Bindery'), 'ready for folding')$$, 'non-owner handed off');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');   -- owner
select pg_temp.expect_fail($$select handoff_job((select a from j), pg_temp.dept('Novelty'), 'same dept')$$, 'handoff to same department');
select pg_temp.expect_fail($$select handoff_job((select a from j), pg_temp.dept('Bindery'), '')$$, 'handoff without note');
select pg_temp.ok($$select handoff_job((select a from j), pg_temp.dept('Bindery'), 'printed, needs folding')$$, 'owner hands off');
select pg_temp.expect_fail($$select handoff_job((select a from j), pg_temp.dept('Front Desk'), 'second')$$, 'two pending handoffs');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');   -- Bindery can now see the job
select pg_temp.expect_count($$select 1 from jobs where id = (select a from j)$$, 1, 'receiving department cannot see handed-off job');
select pg_temp.expect_count($$select 1 from job_handoffs$$, 1, 'receiving department cannot see handoff');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_fail($$select accept_handoff((select id from job_handoffs limit 1), pg_temp.v((select a from j)))$$, 'wrong department accepted');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_fail($$select accept_handoff((select id from job_handoffs limit 1), pg_temp.v((select a from j))-1)$$, 'accepted with stale version');
select pg_temp.ok($$select accept_handoff((select id from job_handoffs limit 1), pg_temp.v((select a from j)))$$, 'bindery accepts');
select pg_temp.expect_count($$select 1 from jobs where id=(select a from j) and current_assignee_id='00000000-0000-0000-0000-0000000000a4' and current_department_id=pg_temp.dept('Bindery')$$, 1, 'accepting did not move the job');
select pg_temp.expect_fail($$select accept_handoff((select id from job_handoffs limit 1), pg_temp.v((select a from j)))$$, 'accepted twice');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');   -- Novelty no longer sees it
select pg_temp.expect_count($$select 1 from jobs where id = (select a from j)$$, 0, 'old department still sees job');
-- cancel path
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select handoff_job((select b from j), pg_temp.dept('Novelty'), 'send to novelty')$$, 'front desk hands off');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_fail($$select cancel_handoff((select id from job_handoffs where status='Pending'))$$, 'unrelated staff cancelled handoff');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select cancel_handoff((select id from job_handoffs where status='Pending'))$$, 'sender cancels');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_count($$select 1 from jobs where id = (select b from j)$$, 0, 'cancelled handoff left job visible');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from audit_events where action like 'job.handoff%'$$, 5, 'handoff history count');

-- ===== functions closed to visitors
select pg_temp.as_user('');
select pg_temp.expect_fail($$select raise_hold((select a from j),'Other','x')$$, 'visitor raised problem');
select pg_temp.expect_fail($$select handoff_job((select a from j), pg_temp.dept('Bindery'), 'x')$$, 'visitor handed off');

reset role;
select 'ALL PHASE 3 TESTS PASSED' as result;
