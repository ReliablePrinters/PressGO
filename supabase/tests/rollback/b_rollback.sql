-- Rollback test, step 5: restore the deleted job with the "restore" SQL from FEATURE-UPDATE-NOTES.md, run the three rollback
-- files in the documented reverse order, then check that the database is structurally identical to what it was before 0015.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_count(sql text, want bigint, label text) returns void language plpgsql as $$
declare got bigint; begin execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAILED: % (expected %, got %)', label, want, got; end if; end $$;
create or replace function pg_temp.dept(n text) returns uuid language sql as $$ select id from departments where name = n $$;
grant execute on all functions in schema pg_temp to public;

-- the restore SQL, exactly as the notes give it (job number 1001 is the first one created in this database)
alter table pressgo.jobs disable trigger jobs_frozen;
update pressgo.jobs set deleted_at = null, deleted_by = null, delete_reason = null where customer_name = 'Acme';
alter table pressgo.jobs enable trigger jobs_frozen;
select pg_temp.expect_count($$select 1 from jobs where deleted_at is not null$$, 0, 'the restore left no deleted job');

\ir ../../rollbacks/0017_rollback.sql
\ir ../../rollbacks/0016_rollback.sql
\ir ../../rollbacks/0015_rollback.sql
-- the one step the notes leave to the dashboard (Supabase does not allow it from SQL, so the stand-in does it here)
delete from storage.objects where bucket_id = 'avatars';
delete from storage.buckets where id = 'avatars';

select pg_temp.expect_count($$select what, item from rbcheck.snapshot() except select what, item from rbcheck.before$$, 0,
  'nothing exists now that did not exist before 0015');
select pg_temp.expect_count($$select what, item from rbcheck.before except select what, item from rbcheck.snapshot()$$, 0,
  'nothing that existed before 0015 is missing or different now');

-- and the old behaviour really is back
select pg_temp.expect_count($$select 1 from information_schema.columns where table_schema = 'pressgo' and table_name = 'jobs' and column_name in ('deleted_at', 'deleted_by', 'delete_reason')$$, 0, 'jobs has no delete columns');
select pg_temp.expect_count($$select 1 from jobs$$, 2, 'both jobs are still there, the restored one included');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from jobs$$, 2, 'a manager sees both jobs again');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select create_job('70000000-0000-0000-0000-000000000003','After',null,'cards',null,10,null,null,null,now()+interval '2 days','Normal',pg_temp.dept('Novelty'),null,true);
select pg_temp.expect_count($$select 1 from jobs where customer_name = 'After'$$, 1, 'creating a job still works');
reset role;
select 'PASSED: rollback of 0015-0017' as result;
