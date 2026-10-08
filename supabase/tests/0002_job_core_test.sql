-- Tests for Phase 2 (job core). Fresh database each run; see run_local.sh.
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

set role authenticated;
select pg_temp.as_user('');  -- (visitor) functions are closed
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000000','C',null,'D',null,1,null,null,null,now(),'Normal',pg_temp.dept('Novelty'),null,true)$$, 'visitor created job');

-- ===== creating
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');   -- Novelty staff
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000001','C',null,'D',null,1,null,null,null,now(),'Normal',pg_temp.dept('Novelty'),null,true)$$, 'staff created job');

select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');   -- Front Desk
select pg_temp.ok($$select create_job('50000000-0000-0000-0000-000000000001','Acme','555','500 flyers','Flyers',500,'A5','Gloss','Fold',now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true)$$, 'front desk create');
select pg_temp.ok($$select create_job('50000000-0000-0000-0000-000000000001','Acme','555','500 flyers','Flyers',500,'A5','Gloss','Fold',now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true)$$, 'retry create');
select pg_temp.expect_count($$select 1 from jobs$$, 1, 'retry made a second job');
select pg_temp.expect_count($$select 1 from audit_events where action='job.created'$$, 1, 'retry made a second creation event');
select pg_temp.expect_count($$select 1 from conversations where type='job'$$, 1, 'job chat not created');
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000002','C',null,'D',null,0,null,null,null,now(),'Normal',pg_temp.dept('Novelty'),null,true)$$, 'zero quantity');
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000003','',null,'D',null,1,null,null,null,now(),'Normal',pg_temp.dept('Novelty'),null,true)$$, 'blank customer');
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000004','C',null,'D',null,1,null,null,null,null,'Normal',pg_temp.dept('Novelty'),null,true)$$, 'missing due date');
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000005','C',null,'D',null,1,null,null,null,now(),'Normal',pg_temp.dept('Novelty'),'00000000-0000-0000-0000-0000000000a4',true)$$, 'assignee from another department');
select pg_temp.expect_fail($$select create_job('50000000-0000-0000-0000-000000000006','C',null,'D',null,1,null,null,null,now(),'Normal',pg_temp.dept('Novelty'),null,false)$$, 'front desk bypassed artwork gate');

select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');   -- Manager: artwork not required
select pg_temp.ok($$select create_job('50000000-0000-0000-0000-000000000007','NoArt Co',null,'Stamps',null,10,null,null,null,now()+interval '1 day','Rush',pg_temp.dept('Novelty'),null,false)$$, 'manager no-artwork job');

-- ids of the two jobs
reset role;
create temp table j as select (select id from jobs where customer_name='Acme') as art, (select id from jobs where customer_name='NoArt Co') as noart;
grant select on j to authenticated;
set role authenticated;

-- ===== release, assign, start
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Queued')$$, 'staff released a job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Queued')$$, 'front desk release');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'In Production')$$, 'started with nobody assigned (front desk not owner)');

select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');   -- Bindery staff cannot even see it
select pg_temp.expect_count($$select 1 from jobs$$, 0, 'bindery sees novelty job');
select pg_temp.expect_fail($$select assign_job((select noart from j), pg_temp.v((select noart from j)), '00000000-0000-0000-0000-0000000000a4')$$, 'other department accepted job');

select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');   -- Novelty staff accepts for self
select pg_temp.expect_fail($$select assign_job((select noart from j), pg_temp.v((select noart from j)), '00000000-0000-0000-0000-0000000000a7')$$, 'staff assigned someone else');
select pg_temp.ok($$select assign_job((select noart from j), pg_temp.v((select noart from j)), '00000000-0000-0000-0000-0000000000a3')$$, 'staff accepts job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a7');   -- colleague cannot take an owned job
select pg_temp.expect_fail($$select assign_job((select noart from j), pg_temp.v((select noart from j)), '00000000-0000-0000-0000-0000000000a7')$$, 'took an owned job');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'In Production')$$, 'non-owner started job');

select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail($$select transition_job((select noart from j), 1, 'In Production')$$, 'stale version accepted');   -- version has moved on
select pg_temp.ok($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'In Production')$$, 'owner starts');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Collected')$$, 'skipped to collected');
select pg_temp.ok($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Finishing')$$, 'to finishing');
select pg_temp.ok($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Ready for Collection')$$, 'to ready');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Collected')$$, 'staff marked collected');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.ok($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Collected')$$, 'front desk collects');

-- ===== artwork gate (approval arrives in Phase 3)
select pg_temp.ok($$select transition_job((select art from j), pg_temp.v((select art from j)), 'Queued')$$, 'release art job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select assign_job((select art from j), pg_temp.v((select art from j)), '00000000-0000-0000-0000-0000000000a3')$$, 'accept art job');
select pg_temp.expect_fail($$select transition_job((select art from j), pg_temp.v((select art from j)), 'In Production')$$, 'started without approved artwork');

-- ===== manager override, backwards moves, cancel, reopen
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Ready for Collection', 'x')$$, 'front desk reopened job');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Ready for Collection')$$, 'reopen without reason');
select pg_temp.ok($$select transition_job((select noart from j), pg_temp.v((select noart from j)), 'Ready for Collection', 'collected by mistake')$$, 'manager reopen with reason');
select pg_temp.expect_count($$select 1 from audit_events where reason = 'collected by mistake'$$, 1, 'reason missing from history');
select pg_temp.expect_fail($$select transition_job((select art from j), pg_temp.v((select art from j)), 'Cancelled')$$, 'cancel without reason');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail($$select transition_job((select art from j), pg_temp.v((select art from j)), 'Cancelled', 'x')$$, 'front desk cancelled');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.ok($$select transition_job((select art from j), pg_temp.v((select art from j)), 'Cancelled', 'customer withdrew')$$, 'manager cancel');
select pg_temp.expect_fail($$select transition_job((select art from j), pg_temp.v((select art from j)), 'In Production', 'x')$$, 'cancelled job jumped straight into production');
select pg_temp.expect_fail($$select transition_job((select art from j), pg_temp.v((select art from j)), 'Queued')$$, 'cancelled job reopened without reason');
select pg_temp.ok($$select transition_job((select art from j), pg_temp.v((select art from j)), 'Queued', 'customer is back')$$, 'manager reopens cancelled job with reason');

-- ===== edits need a reason for deadline / priority
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail($$select update_job_details((select noart from j), pg_temp.v((select noart from j)), 'NoArt Co',null,'Stamps',null,10,null,null,null, now()+interval '9 days','Rush',null)$$, 'deadline changed without reason');
select pg_temp.ok($$select update_job_details((select noart from j), pg_temp.v((select noart from j)), 'NoArt Co',null,'Stamps',null,10,null,null,null, now()+interval '9 days','Rush','customer asked for later')$$, 'deadline change with reason');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_fail($$select update_job_details((select noart from j), pg_temp.v((select noart from j)), 'X',null,'Y',null,1,null,null,null, now(),'Low','r')$$, 'staff edited details');

-- ===== history visibility
select pg_temp.expect_count($$select 1 from audit_events where job_id = (select noart from j)$$, 9, 'history for own job missing');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from audit_events$$, 0, 'bindery staff reads novelty history');

reset role;
select 'ALL PHASE 2 TESTS PASSED' as result;
