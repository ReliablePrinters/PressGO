-- Tests for deleting a job. Fresh database each run.
-- Allowed: a manager (any job), or the person who created the job while it has not started production.
-- Everyone else must be refused by the database. A deleted job is hidden, frozen, and loses nothing.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDeskCreator',false,true,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyOwner',false,false,true),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','fd2@x.test','OtherFrontDesk',false,true,true),
 ('00000000-0000-0000-0000-0000000000a6','10000000-0000-0000-0000-0000000000a6','gone@x.test','LeaverOwner',false,false,true),
 ('00000000-0000-0000-0000-0000000000a7','10000000-0000-0000-0000-0000000000a7','off@x.test','DisabledLogin',false,false,false),
 ('00000000-0000-0000-0000-0000000000a8','10000000-0000-0000-0000-0000000000a8','mgr2@x.test','SecondManager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a9','10000000-0000-0000-0000-0000000000a9','nov2@x.test','NoveltyColleague',false,false,true);
insert into department_memberships (employee_id, department_id)
 select e.id, d.id from (values ('00000000-0000-0000-0000-0000000000a3'::uuid,'Novelty'),('00000000-0000-0000-0000-0000000000a6','Novelty'),('00000000-0000-0000-0000-0000000000a9','Novelty'),
   ('00000000-0000-0000-0000-0000000000a4','Bindery'),('00000000-0000-0000-0000-0000000000a2','Front Desk'),('00000000-0000-0000-0000-0000000000a5','Front Desk')) v(id,dn)
 join employees e on e.id = v.id join departments d on d.name = v.dn;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'FAILED (should have been blocked): %', label; end $$;
create or replace function pg_temp.expect_error(sql text, pattern text, label text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then return; end if;
    raise exception 'FAILED (wrong refusal): % -- got: %', label, sqlerrm;
  end;
  raise exception 'FAILED (should have been blocked): %', label;
end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.ok(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise exception 'FAILED (should have worked): % -- %', label, sqlerrm; end; end $$;
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;
create or replace function pg_temp.jid(cust text) returns uuid language sql as $$ select id from jobs where customer_name = cust $$;
create or replace function pg_temp.jv(cust text) returns integer language sql as $$ select version from jobs where customer_name = cust $$;
-- delete job $1 (by customer name) as the current user, with reason $2
create or replace function pg_temp.del(cust text, why text) returns void language plpgsql as $$
begin perform delete_job(pg_temp.jid(cust), pg_temp.jv(cust), why); end $$;
grant execute on all functions in schema pg_temp to public;

-- ===== set up: seven jobs
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');   -- Front Desk creator
select create_job('70000000-0000-0000-0000-000000000001','Acme',null,'500 flyers',null,500,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
select create_job('70000000-0000-0000-0000-000000000003','Gamma',null,'banner',null,1,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a3',true);
select create_job('70000000-0000-0000-0000-000000000005','Queued Co',null,'cards',null,100,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select create_job('70000000-0000-0000-0000-000000000006','Cancelled Co',null,'cards',null,100,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select create_job('70000000-0000-0000-0000-000000000007','Leaver Co',null,'cards',null,100,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a6',true);
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');   -- the OTHER front desk person
select create_job('70000000-0000-0000-0000-000000000002','Beta',null,'posters',null,10,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');   -- a manager
select create_job('70000000-0000-0000-0000-000000000004','Delta',null,'books',null,10,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Bindery'),null,true);
-- Queued / Cancelled / In Production / Collected states
select transition_job(pg_temp.jid('Queued Co'), pg_temp.jv('Queued Co'), 'Queued');
select transition_job(pg_temp.jid('Cancelled Co'), pg_temp.jv('Cancelled Co'), 'Cancelled', 'customer changed their mind');
reset role;
update jobs set lifecycle_status = 'In Production' where customer_name = 'Gamma';
update jobs set lifecycle_status = 'Collected' where customer_name = 'Delta';
-- related records on Acme: a file, a problem, a pending handoff, a task, a job-chat message
select id as acme from jobs where customer_name = 'Acme' \gset
insert into storage.objects (bucket_id, name) values ('job-files', :'acme' || '/proof.pdf');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select register_file(:'acme', 'Customer Original', 'proof.pdf', 'application/pdf', 1000, :'acme' || '/proof.pdf');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select raise_hold(:'acme', 'Other', 'waiting for the customer');
select handoff_job(:'acme', pg_temp.dept('Bindery'), 'ready for binding');
select send_message((select id from conversations where job_id = :'acme'), 'job chat hello');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_task('check the proof', null, '00000000-0000-0000-0000-0000000000a3', now() + interval '1 day', :'acme');
reset role;
-- the Leaver's account is switched off while they still own a job
update employees set active = false where id = '00000000-0000-0000-0000-0000000000a6';
select version as acmev0 from jobs where customer_name = 'Acme' \gset
select id as gamma, version as gammav from jobs where customer_name = 'Gamma' \gset
select id as acmefile from job_files where job_id = :'acme' \gset
select id as acmehand from job_handoffs where job_id = :'acme' \gset
select id as acmeconv from conversations where job_id = :'acme' \gset

-- ===== 1. people who must NOT be able to delete (every refusal checked for the right reason)
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a9');    -- a Novelty colleague: cannot even see Acme (it is owned by someone else)
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 0, 'this colleague really cannot see the job');
select pg_temp.expect_error(format($$select delete_job(%L, %s, 'no')$$, :'acme', :'acmev0'), 'job not found', 'staff who cannot see the job (real id and version given)');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');    -- Bindery: can see it (a handoff to them is waiting) but did not create it
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 1, 'the receiving department can see the job');
select pg_temp.expect_error($$select pg_temp.del('Acme', 'no')$$, 'only the person who created', 'a department that can see the job still cannot delete it');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');    -- the job's owner, but not its creator
select pg_temp.expect_error($$select pg_temp.del('Acme', 'no')$$, 'only the person who created', 'the assigned owner is not the creator');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');    -- another Front Desk person (can see New jobs)
select pg_temp.expect_error($$select pg_temp.del('Acme', 'no')$$, 'only the person who created', 'a different Front Desk user');
select pg_temp.expect_error(format($$select delete_job(%L, %s, 'no')$$, :'gamma', :'gammav'), 'job not found', 'a different Front Desk user cannot even see a started job (real id and version given)');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');    -- the creator, but the job has started
select pg_temp.expect_error($$select pg_temp.del('Gamma', 'no')$$, 'started production', 'creator cannot delete a job already in production');
select pg_temp.expect_error($$select pg_temp.del('Acme', '')$$, 'reason is required', 'empty reason');
select pg_temp.expect_error($$select pg_temp.del('Acme', '   ')$$, 'reason is required', 'blank reason');
select pg_temp.expect_error($$select pg_temp.del('Acme', null)$$, 'reason is required', 'no reason');
-- blanks of every kind are not a reason (built from character codes: 9 tab, 10 line feed, 13 carriage return, 160 no-break space,
-- 8203 zero-width space, 8205 zero-width joiner, 8288 word joiner, 65279 byte-order mark)
select pg_temp.expect_error($$select pg_temp.del('Acme', chr(9) || chr(10))$$, 'reason is required', 'only a tab and a line break');
select pg_temp.expect_error($$select pg_temp.del('Acme', chr(13) || chr(10) || ' ' || chr(9))$$, 'reason is required', 'only carriage return, line feed, space and tab');
select pg_temp.expect_error($$select pg_temp.del('Acme', chr(160) || chr(160))$$, 'reason is required', 'only no-break spaces');
select pg_temp.expect_error($$select pg_temp.del('Acme', chr(8203) || chr(8205) || chr(8288) || chr(65279))$$, 'reason is required', 'only zero-width characters');
select pg_temp.expect_error($$select pg_temp.del('Acme', ' ' || chr(9) || chr(160) || chr(8203) || chr(10) || ' ')$$, 'reason is required', 'a mix of every kind of blank');
select pg_temp.expect_error($$select pg_temp.del('Acme', chr(9) || repeat('x', 501) || chr(10))$$, 'too long', 'too long even after trimming');
select pg_temp.expect_error($$select pg_temp.del('Acme', repeat('x', 501))$$, 'too long', 'reason too long');
select pg_temp.expect_error($$select delete_job(pg_temp.jid('Acme'), pg_temp.jv('Acme') - 1, 'stale screen')$$, 'version conflict', 'stale screen');
select pg_temp.expect_error($$select delete_job('00000000-0000-0000-0000-00000000dead', 1, 'x')$$, 'job not found', 'unknown job');
-- direct table access is closed even for a manager
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$delete from jobs where customer_name = 'Acme'$$, 'manager direct delete');
select pg_temp.expect_fail($$update jobs set deleted_at = now(), deleted_by = '00000000-0000-0000-0000-0000000000a1', delete_reason = 'x' where customer_name = 'Acme'$$, 'manager direct soft-delete');
-- signed out / disabled / not staff
reset role;
set role anon;
select pg_temp.expect_fail($$select delete_job('00000000-0000-0000-0000-00000000dead', 1, 'x')$$, 'anonymous');
reset role;
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_error($$select pg_temp.del('Acme', 'x')$$, 'not signed in', 'disabled login');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000ff');
select pg_temp.expect_error($$select pg_temp.del('Acme', 'x')$$, 'not signed in', 'login without an employee record');
-- after all those attempts nothing was deleted
reset role;
do $$ begin
  if exists (select 1 from jobs where deleted_at is not null) then raise exception 'FAILED: a refused attempt still deleted something'; end if;
end $$;
-- the database itself refuses to erase a job (even for the owner of the tables) and the delete marks must be complete
select pg_temp.expect_error($$delete from jobs where customer_name = 'Beta'$$, 'cannot be erased', 'hard delete is blocked at the table');
select pg_temp.expect_fail($$update jobs set deleted_at = now() where customer_name = 'Beta'$$, 'half-filled delete marks are refused');

-- ===== 2. the creator deletes their own job (New)
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 1, 'creator sees the job before');
select pg_temp.ok($$select pg_temp.del('Acme', 'created by mistake')$$, 'creator deletes their own New job');
-- hidden from everyone, managers included
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 0, 'hidden from the creator');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 0, 'hidden from managers');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 0, 'hidden from the assigned owner');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Acme'$$, 0, 'hidden from other Front Desk');
-- the other jobs are untouched and still visible
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from jobs$$, 5, 'the other jobs are untouched (Gamma, Queued Co, Cancelled Co, Leaver Co by creator; Beta as a New job for Front Desk)');
-- its records vanish from view with it
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from job_files$$, 0, 'files hidden');
select pg_temp.expect_count($$select 1 from job_holds$$, 0, 'problems hidden');
select pg_temp.expect_count($$select 1 from job_handoffs$$, 0, 'handoffs hidden');
select pg_temp.expect_count($$select 1 from conversations where type = 'job' and name = 'Job 1001'$$, 0, 'job chat hidden');
select pg_temp.expect_count($$select 1 from messages where body = 'job chat hello'$$, 0, 'job chat messages hidden');
select pg_temp.expect_count($$select 1 from my_conversations() where type = 'job' and last_body = 'job chat hello'$$, 0, 'job chat not in the chat list');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'job-files' and name like '%/proof.pdf'$$, 0, 'the stored file can no longer be opened by staff');
select pg_temp.expect_count($$select 1 from audit_events where action = 'job.deleted'$$, 0, 'staff do not see the deletion record');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from audit_events where action = 'job.deleted' and reason = 'created by mistake' and actor_id = '00000000-0000-0000-0000-0000000000a2'$$, 1, 'managers keep the audit record: who, when, why');
-- the owner was told (no dead link), the person who did it was not
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from notifications where kind = 'job_deleted' and job_id is null and title like '%Acme%'$$, 1, 'the assigned owner was told');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count($$select 1 from notifications where kind = 'job_deleted'$$, 0, 'the person deleting is not alerted about their own action');

-- ===== 3. nothing was lost (checked as the table owner)
reset role;
select version as acmev from jobs where customer_name = 'Acme' \gset
do $$ declare j jobs; begin
  select * into j from jobs where customer_name = 'Acme';
  if j.id is null or j.deleted_at is null or j.deleted_by <> '00000000-0000-0000-0000-0000000000a2' or j.delete_reason <> 'created by mistake' then raise exception 'FAILED: job row / delete marks'; end if;
  if (select count(*) from job_files where job_id = j.id) <> 1 then raise exception 'FAILED: file record lost'; end if;
  if (select count(*) from job_holds where job_id = j.id) <> 1 then raise exception 'FAILED: problem record lost'; end if;
  if (select count(*) from job_handoffs where job_id = j.id and status = 'Pending') <> 1 then raise exception 'FAILED: handoff record lost'; end if;
  if (select count(*) from tasks where job_id = j.id) <> 1 then raise exception 'FAILED: task lost'; end if;
  if (select count(*) from messages m join conversations c on c.id = m.conversation_id where c.job_id = j.id) <> 1 then raise exception 'FAILED: chat messages lost'; end if;
  if (select count(*) from storage.objects where bucket_id = 'job-files' and name = j.id::text || '/proof.pdf') <> 1 then raise exception 'FAILED: stored file lost'; end if;
  if (select count(*) from audit_events where job_id = j.id and action = 'job.created') <> 1 then raise exception 'FAILED: creation history lost'; end if;
  if (select count(*) from audit_events where job_id = j.id and action = 'job.deleted') <> 1 then raise exception 'FAILED: deletion not recorded'; end if;
end $$;

-- ===== 4. a deleted job is frozen: nothing else can change it, even by calling the functions directly
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
-- (the job's real version and ids are passed in, so a refusal is about the job being deleted and not about a stale version)
select pg_temp.expect_error(format($$select update_job_details(%L, %s, 'Acme', null, 'changed', null, 5, null, null, null, now() + interval '3 days', 'Normal', 'new deadline')$$, :'acme', :'acmev'), 'deleted', 'cannot edit details');
select pg_temp.expect_error(format($$select assign_job(%L, %s, null)$$, :'acme', :'acmev'), 'job not found', 'cannot assign');
select pg_temp.expect_error(format($$select transition_job(%L, %s, 'Queued')$$, :'acme', :'acmev'), 'job not found', 'cannot move');
select pg_temp.expect_error(format($$select approve_artwork(%L, %s, %L)$$, :'acme', :'acmev', :'acmefile'), 'deleted', 'cannot approve artwork');
select pg_temp.expect_error(format($$select raise_hold(%L, 'Other', 'x')$$, :'acme'), 'job not found', 'cannot add a problem');
select pg_temp.expect_error(format($$select register_file(%L, 'Customer Original', 'x.pdf', 'application/pdf', 10, %L)$$, :'acme', :'acme' || '/x.pdf'), 'job not found', 'cannot add a file');
select pg_temp.expect_error(format($$select create_task('x', null, '00000000-0000-0000-0000-0000000000a3', null, %L)$$, :'acme'), 'cannot see that job', 'cannot add a task');
select pg_temp.expect_error(format($$select send_message(%L, 'hi')$$, :'acmeconv'), 'cannot post', 'cannot chat on it');
select pg_temp.expect_error(format($$select accept_handoff(%L, %s)$$, :'acmehand', :'acmev'), 'deleted', 'cannot accept its handoff');
select pg_temp.expect_error($$select pg_temp.del('Acme', 'again')$$, 'job not found', 'deleting twice');
reset role;
-- even the table owner cannot quietly edit a deleted job through a normal update
select pg_temp.expect_error($$update jobs set description = 'sneaky' where customer_name = 'Acme'$$, 'can no longer be changed', 'frozen at the table');
do $$ begin
  if (select status from job_handoffs h join jobs j on j.id = h.job_id where j.customer_name = 'Acme') <> 'Pending' then raise exception 'FAILED: handoff changed on a deleted job'; end if;
end $$;

-- ===== 5. the other allowed deletions
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select pg_temp.del('Queued Co', '  duplicate order' || chr(9) || chr(160) || chr(10))$$, 'creator deletes a Queued job (reason padded with blanks of several kinds)');
select pg_temp.ok($$select pg_temp.del('Cancelled Co', 'tidy up')$$, 'creator deletes a Cancelled job');
select pg_temp.ok($$select pg_temp.del('Leaver Co', 'wrong customer')$$, 'a job whose owner has since been disabled can still be deleted');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok($$select pg_temp.del('Gamma', 'customer withdrew the order')$$, 'a manager deletes a job in production that someone else created');
select pg_temp.ok($$select pg_temp.del('Delta', 'entered twice')$$, 'a manager deletes a Collected job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.ok($$select pg_temp.del('Beta', 'mine, mistake')$$, 'the other Front Desk user deletes the job THEY created');
select pg_temp.expect_count($$select 1 from jobs$$, 0, 'every job is now hidden');
reset role;
select pg_temp.expect_count($$select 1 from jobs$$, 7, 'but all seven rows are still in the database');
select pg_temp.expect_count($$select 1 from jobs where deleted_at is not null and deleted_by is not null and delete_reason is not null$$, 7, 'each carries who / when / why');
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'Queued Co' and delete_reason = 'duplicate order'$$, 1, 'the reason is stored trimmed, not as typed');
select pg_temp.expect_count($$select 1 from audit_events where action = 'job.deleted' and reason = 'duplicate order'$$, 1, 'and so is the reason in the audit record');
select pg_temp.expect_count($$select 1 from jobs where delete_reason <> btrim(delete_reason) or delete_reason ~ '^[[:space:]]' or delete_reason ~ '[[:space:]]$'$$, 0, 'no stored reason starts or ends with a blank');
-- the next job number is not reused
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_job('70000000-0000-0000-0000-000000000099','After',null,'cards',null,10,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'After' and job_number > 1007$$, 1, 'job numbers are never reused');
reset role;
select 'PASSED: delete job' as result;
