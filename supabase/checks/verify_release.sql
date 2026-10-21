-- PressGO: READ-ONLY release checks. Safe to run in the Supabase SQL editor of ANY project: it only reads catalog information
-- (no data is read or changed, nothing is created). Run it on a test project after applying 0001-0017, and on the live
-- project after applying 0015-0017. It returns one table; the expected values are for the schema after 0001-0017.
-- (Before 0015-0017 are applied, the rows about the new features are expected to say false: that is how it tells you what is missing.)
--
-- kind = required : every one of these must say ok = true. They check the SHAPE of the security rules: counts, row security,
--                   who may run the new functions, that they run with the owner's checked powers and a fixed search_path,
--                   that the job-lock trigger is switched on, what the key policies say, and what the storage policies say.
-- kind = advisory : fingerprints (md5) of the new or replaced functions and of all functions and policies, computed from the
--                   repository migrations on PostgreSQL 17. A mismatch means "something differs from the repository, look at it":
--                   it is a strong warning that a rule was edited by hand, but it can also be a harmless difference (for example a
--                   function changed on purpose after these values were made, or a different PostgreSQL version formatting the text
--                   differently). It never proves that everything is fine on its own. Function fingerprints ignore line endings and
--                   spacing (all runs of white space count as one space), because the live functions were pasted in from an editor whose
--                   line endings are not known; a hash of the raw text would differ for that reason alone.
-- This check cannot prove that the rules WORK (that is what the tests and the manual checklist are for); it proves the rules that
-- were installed are the ones that were reviewed. Regenerate the advisory values whenever a migration changes.
with
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo'),
newfn as (select * from fn where proname in ('set_avatar', 'remove_avatar', 'set_preferences', 'delete_job', '_emp_from_path', 'jobs_frozen_when_deleted')),
userfn as (select * from fn where proname in ('set_avatar', 'remove_avatar', 'set_preferences', 'delete_job')),
powerfn as (select * from fn where proname in ('set_avatar', 'remove_avatar', 'set_preferences', 'delete_job', 'can_view_job', 'check_job_assignee')),
pol as (select * from pg_policies where schemaname = 'pressgo'),
sto as (select * from pg_policies where schemaname = 'storage' and tablename = 'objects'),
checks(n, kind, check_name, expected, actual) as (
  select 1, 'required', 'tables in schema pressgo', '19',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relkind = 'r')::text
  union all select 2, 'required', 'policies in schema pressgo', '31', (select count(*) from pol)::text
  union all select 3, 'required', 'triggers in schema pressgo', '21',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and not t.tgisinternal)::text
  union all select 4, 'required', 'functions in schema pressgo', '54', (select count(*) from fn)::text
  union all select 5, 'required', 'tables WITHOUT row security', '0',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relkind = 'r' and not c.relrowsecurity)::text
  union all select 6, 'required', 'write privileges for authenticated/anon/PUBLIC on pressgo tables', '0',
    (select count(*) from information_schema.role_table_grants where table_schema = 'pressgo' and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type <> 'SELECT')::text
  union all select 7, 'required', 'new functions anon or PUBLIC can run', '0',
    (select count(*) from newfn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute'))::text
  union all select 8, 'required', 'signed-in people can run the 4 user functions', '4',
    (select count(*) from userfn where has_function_privilege('authenticated', oid, 'execute'))::text
  union all select 9, 'required', 'new tables with row security (avatars, preferences)', '2',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relname in ('employee_avatars', 'employee_preferences') and c.relrowsecurity)::text
  union all select 10, 'required', 'jobs has deleted_at / deleted_by / delete_reason', '3',
    (select count(*) from information_schema.columns where table_schema = 'pressgo' and table_name = 'jobs' and column_name in ('deleted_at', 'deleted_by', 'delete_reason'))::text
  union all select 11, 'required', 'trigger jobs_frozen exists (deleted jobs are locked)', '1',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relname = 'jobs' and t.tgname = 'jobs_frozen' and not t.tgisinternal)::text
  union all select 12, 'required', 'can_view_job() hides deleted jobs', 'true',
    coalesce((select bool_or(pg_get_functiondef(f.oid) ilike '%deleted_at is null%') from fn f where f.proname = 'can_view_job'), false)::text
  union all select 13, 'required', 'private buckets: avatars, chat-files, job-files', '3',
    (select count(*) from storage.buckets where id in ('avatars', 'chat-files', 'job-files') and public = false)::text
  union all select 14, 'required', 'avatars bucket: 2 MB limit, JPEG/PNG/WebP only', 'true',
    coalesce((select file_size_limit = 2097152 and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp'] and cardinality(allowed_mime_types) = 3 from storage.buckets where id = 'avatars'), false)::text
  union all select 15, 'required', 'avatars storage policies (read, add, tidy)', '3',
    (select count(*) from sto where policyname in ('pressgo avatars read', 'pressgo avatars add', 'pressgo avatars tidy'))::text
  union all select 16, 'required', 'no UPDATE policy on avatars (pictures cannot be overwritten)', '0',
    (select count(*) from sto where cmd in ('UPDATE', 'ALL') and (policyname ilike '%avatar%' or qual ilike '%avatars%' or with_check ilike '%avatars%'))::text
  -- ---- shape of the security rules
  union all select 17, 'required', 'the 4 user functions run with the owner''s checked powers (SECURITY DEFINER)', '4',
    (select count(*) from userfn where prosecdef)::text
  union all select 18, 'required', 'the 4 user functions + can_view_job + check_job_assignee have search_path fixed to pressgo', '6',
    (select count(*) from powerfn where proconfig @> array['search_path=pressgo'])::text
  union all select 19, 'required', 'jobs_frozen is switched on, per row, BEFORE update and delete only', '1',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pressgo' and c.relname = 'jobs' and t.tgname = 'jobs_frozen' and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16 and (t.tgtype & 4) = 0)::text
  union all select 20, 'required', 'employee_preferences: a person can read only their own row', 'true',
    coalesce((select bool_and(cmd = 'SELECT' and roles = array['authenticated']::name[] and qual = '(employee_id = pressgo.current_employee_id())') from pol where tablename = 'employee_preferences' and policyname = 'prefs_select'), false)::text
  union all select 21, 'required', 'employee_avatars: readable by active staff only', 'true',
    coalesce((select bool_and(cmd = 'SELECT' and roles = array['authenticated']::name[] and qual = '(pressgo.current_employee_id() IS NOT NULL)') from pol where tablename = 'employee_avatars' and policyname = 'avatars_select'), false)::text
  union all select 22, 'required', 'storage avatars READ: active staff, avatars bucket only', 'true',
    coalesce((select bool_and(cmd = 'SELECT' and position('avatars' in qual) > 0 and position('current_employee_id() IS NOT NULL' in qual) > 0) from sto where policyname = 'pressgo avatars read'), false)::text
  union all select 23, 'required', 'storage avatars ADD: only into your own folder', 'true',
    coalesce((select bool_and(cmd = 'INSERT' and position('avatars' in with_check) > 0 and position('_emp_from_path' in with_check) > 0 and position('current_employee_id()' in with_check) > 0) from sto where policyname = 'pressgo avatars add'), false)::text
  union all select 24, 'required', 'storage avatars TIDY (delete): only your own folder', 'true',
    coalesce((select bool_and(cmd = 'DELETE' and position('avatars' in qual) > 0 and position('_emp_from_path' in qual) > 0 and position('current_employee_id()' in qual) > 0) from sto where policyname = 'pressgo avatars tidy'), false)::text
  union all select 25, 'required', 'no other storage policy mentions the avatars bucket', '0',
    (select count(*) from sto where policyname not in ('pressgo avatars read', 'pressgo avatars add', 'pressgo avatars tidy') and (position('avatars' in coalesce(qual, '')) > 0 or position('avatars' in coalesce(with_check, '')) > 0))::text
  union all select 26, 'required', 'anonymous people can read neither new table', '0',
    (select count(*) from (values ('pressgo.employee_avatars'), ('pressgo.employee_preferences')) v(t) where to_regclass(v.t) is not null and has_table_privilege('anon', v.t, 'select'))::text
  union all select 27, 'required', 'signed-in people can read both new tables (row security decides which rows)', '2',
    (select count(*) from (values ('pressgo.employee_avatars'), ('pressgo.employee_preferences')) v(t) where to_regclass(v.t) is not null and has_table_privilege('authenticated', v.t, 'select'))::text
  -- ---- advisory fingerprints (see the note at the top)
  union all select 28, 'advisory', 'fingerprint: can_view_job()', 'd3412cd1c58ff04a728cbfaa3e9065f1',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'can_view_job'), '(missing)')
  union all select 29, 'advisory', 'fingerprint: check_job_assignee()', '1efd90c080871db634e59d6a05fb291c',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'check_job_assignee'), '(missing)')
  union all select 30, 'advisory', 'fingerprint: delete_job()', 'a2d23a46f5fbbbab22090c1f94b6a5cc',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'delete_job'), '(missing)')
  union all select 31, 'advisory', 'fingerprint: jobs_frozen_when_deleted()', '312b6913da28505e7e70d876c0a1a63b',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'jobs_frozen_when_deleted'), '(missing)')
  union all select 32, 'advisory', 'fingerprint: set_avatar()', '6f202afdefefcb2f10f38852ff76a019',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'set_avatar'), '(missing)')
  union all select 33, 'advisory', 'fingerprint: remove_avatar()', '7216ee58aba934d8eda7d875ff2272ef',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'remove_avatar'), '(missing)')
  union all select 34, 'advisory', 'fingerprint: set_preferences()', '4b955d00a02c4eb74417a867c74d3cf1',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = 'set_preferences'), '(missing)')
  union all select 35, 'advisory', 'fingerprint: _emp_from_path()', 'd07c4a0b87a63618562c36b4ad06cf99',
    coalesce((select md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) from fn where proname = '_emp_from_path'), '(missing)')
  union all select 36, 'advisory', 'fingerprint: ALL 54 functions in schema pressgo combined', '21d2fb22088bc64681399d32daff5dbe',
    (select md5(string_agg(x, ',' order by x collate "C")) from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g')) as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo') s)
  union all select 37, 'advisory', 'fingerprint: ALL 31 policies in schema pressgo combined (who, what, rule)', '7e09504e57aa250282a77ecfb9dee4e3',
    (select md5(string_agg(x, ',' order by x collate "C")) from (select tablename || '.' || policyname || '=' || md5(coalesce(cmd, '') || '|' || coalesce(array_to_string(roles, ','), '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')) as x from pg_policies where schemaname = 'pressgo') s)
)
select n, kind, check_name, expected, actual, (expected = actual) as ok from checks order by n;
