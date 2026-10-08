\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','a@x.test','A',false,false),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','b@x.test','B',true,false);
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select set_break(true);
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
do $$ begin
  if (select count(*) from employee_status where break_since is not null) <> 1 then raise exception 'FAILED: colleague should see the break'; end if;
  begin insert into employee_status values ('00000000-0000-0000-0000-0000000000a1', null);
    raise exception 'FAILED: direct insert allowed'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select set_break(false);
do $$ begin if (select count(*) from employee_status where break_since is not null) <> 0 then raise exception 'FAILED: break not cleared'; end if; end $$;
reset role;
\echo PASSED: break status
