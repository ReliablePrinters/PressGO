-- Tests for profile pictures (avatars). Fresh database each run.
-- Each person may set/change/remove ONLY their own picture; every active staff member may see pictures; bad uploads are refused.
\set ON_ERROR_STOP on
set search_path = pressgo, public;
insert into employees (id, auth_user_id, email, display_name, manager_role, front_desk, active) values
 ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','mgr@x.test','Manager',true,false,true),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2','fd@x.test','FrontDesk',false,true,true),
 ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000a3','nov@x.test','NoveltyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-0000000000a4','bin@x.test','BinderyStaff',false,false,true),
 ('00000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-0000000000a5','off@x.test','DisabledStaff',false,false,false);
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.email', '', false); end $$;
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin begin execute sql; exception when others then return; end; raise exception 'FAILED (should have been blocked): %', label; end $$;
-- like expect_fail, but the refusal must be the RIGHT one (its message must match), so a typo cannot hide behind "it failed"
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
grant execute on all functions in schema pg_temp to public;

-- pictures "uploaded by the browser" into the private bucket (the storage rules themselves are exercised further down)
reset role;
insert into storage.objects (bucket_id, name) values
 ('avatars', '00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg'),
 ('avatars', '00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000002.png'),
 ('avatars', '00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000003.webp'),
 ('avatars', '00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg');

-- ===== a person sets their own picture
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.ok($$select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg', 'image/jpeg', 20000)$$, 'set own picture (jpeg)');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a3'$$, 1, 'one row for the person');
select pg_temp.ok($$select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000002.png', 'image/png', 30000)$$, 'change own picture (png)');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a3' and avatar_path like '%.png'$$, 1, 'changing replaces the picture, does not add a second row');
select pg_temp.ok($$select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000003.webp', 'image/webp', 2097152)$$, 'webp, exactly at the 2 MB limit');

-- ===== everybody active can see it; managers, front desk and plain staff alike
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a3'$$, 1, 'colleague sees the picture');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from employee_avatars$$, 1, 'manager sees the picture');

-- ===== nobody else can change it (not a colleague, not Front Desk, not even a manager)
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'wrong place', 'colleague cannot point their profile at someone else''s file');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'wrong place', 'manager cannot set another person''s picture');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'wrong place', 'front desk cannot set another person''s picture');
-- remove_avatar has no "who" argument: it can only ever remove the caller's own picture
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.ok($$select remove_avatar()$$, 'removing when you have none is harmless');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a3'$$, 1, 'a colleague''s remove did not touch my picture');
-- direct table writes are closed for everyone
select pg_temp.expect_error($$update employee_avatars set avatar_path = 'x'$$, 'permission denied', 'direct update');
select pg_temp.expect_error($$insert into employee_avatars (employee_id, avatar_path, mime_type, size_bytes) values ('00000000-0000-0000-0000-0000000000a4', 'x', 'image/png', 1)$$, 'permission denied', 'direct insert');
select pg_temp.expect_error($$delete from employee_avatars$$, 'permission denied', 'direct delete');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$update employee_avatars set avatar_path = 'x'$$, 'permission denied', 'manager direct update');
select pg_temp.expect_error($$delete from employee_avatars$$, 'permission denied', 'manager direct delete');

-- ===== bad uploads are refused
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'application/pdf', 100)$$, 'JPEG, PNG or WebP', 'not an image');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/svg+xml', 100)$$, 'JPEG, PNG or WebP', 'svg refused');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/gif', 100)$$, 'JPEG, PNG or WebP', 'gif refused');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', null, 100)$$, 'JPEG, PNG or WebP', 'no type');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/jpeg', 2097153)$$, 'too big', 'over 2 MB');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/jpeg', 0)$$, 'too big', 'empty');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/jpeg', null)$$, 'too big', 'no size');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/png', 100)$$, 'does not match', 'name says jpg, type says png');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/evil.php.jpg', 'image/jpeg', 100)$$, 'wrong place', 'odd file name');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/../00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'wrong place', 'path trick');
select pg_temp.expect_error($$select set_avatar(null, 'image/jpeg', 100)$$, 'wrong place', 'no path');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/cccccccc-0000-4000-8000-000000000009.jpg', 'image/jpeg', 100)$$, 'did not finish', 'file was never uploaded');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a4'$$, 0, 'none of the refused uploads left a row');
-- positive control: the same call with a good file works (so the refusals above were about the input, not a broken function)
select pg_temp.ok($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'good upload still works');

-- ===== signed out (the anonymous role)
-- These must be refused by the database's PERMISSION system itself ("permission denied" / "row-level security"), not merely by
-- a function noticing nobody is signed in, so a missing REVOKE or a missing policy cannot hide behind "it raised some error".
-- Supabase gives anon USAGE on every schema it exposes through its API and table rights on storage.objects (the policies then
-- decide), so give it the same here (undone below). Without them the anonymous role could not even see the objects, which would
-- hide the very thing being tested. A signed-out request also carries no user id (earlier tests left one set).
reset role;
grant usage on schema pressgo to anon;
grant usage on schema storage to anon;
grant select, insert, delete on storage.objects to anon;
select set_config('request.jwt.claim.sub', '', false);
select count(*) as n_avatar_objects from storage.objects where bucket_id = 'avatars' \gset
select pg_temp.expect_count($$select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'pressgo'::regnamespace and p.proname in ('set_avatar', 'remove_avatar', '_emp_from_path')
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'$$, 0, 'PUBLIC holds no execute right on the avatar functions');
select pg_temp.expect_count($$select 1 where has_function_privilege('anon', 'pressgo.set_avatar(text,text,bigint)', 'execute')
    or has_function_privilege('anon', 'pressgo.remove_avatar()', 'execute')
    or has_function_privilege('anon', 'pressgo._emp_from_path(text)', 'execute')$$, 0, 'anon holds no execute right on the avatar functions');
select pg_temp.expect_count($$select 1 where has_function_privilege('authenticated', 'pressgo.set_avatar(text,text,bigint)', 'execute')
    and has_function_privilege('authenticated', 'pressgo.remove_avatar()', 'execute')
    and has_function_privilege('authenticated', 'pressgo._emp_from_path(text)', 'execute')$$, 1, 'positive control: signed-in users do hold them');
select pg_temp.expect_count($$select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.oid = 'pressgo.employee_avatars'::regclass and a.grantee = 0$$, 0, 'PUBLIC holds no right on the pictures table');
select pg_temp.expect_count($$select 1 where has_table_privilege('anon', 'pressgo.employee_avatars', 'select,insert,update,delete')
    or has_table_privilege('anon', 'pressgo.employee_avatars', 'select')
    or has_table_privilege('anon', 'pressgo.employee_avatars', 'insert')
    or has_table_privilege('anon', 'pressgo.employee_avatars', 'update')
    or has_table_privilege('anon', 'pressgo.employee_avatars', 'delete')$$, 0, 'anon holds no right on the pictures table');
select pg_temp.expect_count($$select 1 where has_table_privilege('authenticated', 'pressgo.employee_avatars', 'select')
    and not has_table_privilege('authenticated', 'pressgo.employee_avatars', 'insert')
    and not has_table_privilege('authenticated', 'pressgo.employee_avatars', 'update')
    and not has_table_privilege('authenticated', 'pressgo.employee_avatars', 'delete')$$, 1, 'positive control: signed-in users can read the table but not write to it');
set role anon;
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'permission denied', 'anonymous cannot set a picture (even a well-formed one)');
select pg_temp.expect_error($$select remove_avatar()$$, 'permission denied', 'anonymous cannot remove a picture');
select pg_temp.expect_error($$select _emp_from_path('00000000-0000-0000-0000-0000000000a4/x.jpg')$$, 'permission denied', 'anonymous cannot call the path helper');
select pg_temp.expect_error($$select 1 from employee_avatars$$, 'permission denied', 'anonymous cannot read who has a picture');
select pg_temp.expect_error($$insert into employee_avatars (employee_id, avatar_path, mime_type, size_bytes) values ('00000000-0000-0000-0000-0000000000a4', 'x', 'image/png', 1)$$, 'permission denied', 'anonymous direct insert');
select pg_temp.expect_error($$update employee_avatars set avatar_path = 'x'$$, 'permission denied', 'anonymous direct update');
select pg_temp.expect_error($$delete from employee_avatars$$, 'permission denied', 'anonymous direct delete');
-- the picture files themselves: the storage policies are for signed-in staff only
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'avatars'$$, 0, 'anonymous sees no picture files although they exist');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a4/ffffffff-0000-4000-8000-000000000001.jpg')$$, 'row-level security', 'anonymous cannot upload a picture');
delete from storage.objects where bucket_id = 'avatars';
reset role;
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'avatars'$$, :'n_avatar_objects'::bigint, 'anonymous delete removed no picture file');
revoke select, insert, delete on storage.objects from anon;
revoke usage on schema storage from anon;
revoke usage on schema pressgo from anon;
-- ===== disabled and non-staff accounts
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000a5/dddddddd-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'not signed in', 'disabled person');
select pg_temp.expect_count($$select 1 from employee_avatars$$, 0, 'disabled person sees no pictures');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000ff');
select pg_temp.expect_error($$select set_avatar('00000000-0000-0000-0000-0000000000ff/dddddddd-0000-4000-8000-000000000001.jpg', 'image/jpeg', 100)$$, 'not signed in', 'login with no employee record');
select pg_temp.expect_error($$select remove_avatar()$$, 'not signed in', 'login with no employee record can not remove');
select pg_temp.expect_count($$select 1 from employee_avatars$$, 0, 'login with no employee record sees no pictures');

-- ===== storage rules (private bucket)
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'avatars' and name like '00000000-0000-0000-0000-0000000000a3/%'$$, 3, 'staff can read colleagues'' picture files');
select pg_temp.ok($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a4/bbbbbbbb-0000-4000-8000-000000000002.png')$$, 'upload into my own folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a3/zzzzzzzz-0000-4000-8000-000000000001.png')$$, 'row-level security', 'upload into someone else''s folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('avatars', 'loose-file.png')$$, 'row-level security', 'upload outside any person''s folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a1/zzzzzzzz-0000-4000-8000-000000000001.png')$$, 'row-level security', 'upload into the manager''s folder');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a3/zzzzzzzz-0000-4000-8000-000000000002.png')$$, 'row-level security', 'even a manager cannot upload into someone else''s folder');
-- tidy-up (delete) only works on your own files; other people's files are untouched
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
delete from storage.objects where bucket_id = 'avatars' and name like '00000000-0000-0000-0000-0000000000a3/%';
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
delete from storage.objects where bucket_id = 'avatars' and name like '00000000-0000-0000-0000-0000000000a3/%';
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'avatars' and name like '00000000-0000-0000-0000-0000000000a3/%'$$, 3, 'colleague and manager could not delete someone else''s files');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a3');
delete from storage.objects where bucket_id = 'avatars' and name = '00000000-0000-0000-0000-0000000000a3/aaaaaaaa-0000-4000-8000-000000000001.jpg';
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'avatars' and name like '00000000-0000-0000-0000-0000000000a3/%'$$, 2, 'I can delete my own old file');
-- the avatars rules do not open other buckets
reset role;
insert into storage.objects (bucket_id, name) values ('job-files', '00000000-0000-0000-0000-0000000000a9/secret.pdf');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'job-files'$$, 0, 'avatar rules do not expose job files');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_count($$select 1 from storage.objects where bucket_id = 'avatars'$$, 0, 'disabled person cannot read picture files');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a5/eeeeeeee-0000-4000-8000-000000000001.jpg')$$, 'row-level security', 'disabled person cannot upload');

-- ===== removing returns to the default avatar
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a4');
select pg_temp.ok($$select remove_avatar()$$, 'remove my own picture');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a4'$$, 0, 'back to the default avatar');
select pg_temp.as_user('10000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count($$select 1 from employee_avatars where employee_id = '00000000-0000-0000-0000-0000000000a3'$$, 1, 'removing mine did not touch anyone else''s');

-- ===== bucket configuration
reset role;
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'avatars' and public = false and file_size_limit = 2097152
                   and allowed_mime_types = array['image/jpeg','image/png','image/webp']) then
    raise exception 'FAILED: avatars bucket is not private / 2 MB / jpeg-png-webp only';
  end if;
end $$;
select 'PASSED: avatars' as result;
