-- Concurrency test for the 0017 rollback, step 2: a second database session that DELETES the job but has not finished
-- (the runner keeps this transaction open for a few seconds, then sends "commit;"). The rollback is started meanwhile.
\set ON_ERROR_STOP on
begin;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select pressgo.delete_job((select id from pressgo.jobs where customer_name = 'Race'), (select version from pressgo.jobs where customer_name = 'Race'), 'race test');
