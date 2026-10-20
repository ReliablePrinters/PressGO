-- PressGO: READ-ONLY release checks. Safe to run in the Supabase SQL editor of ANY project: it only reads catalog information
-- (no data is read or changed, nothing is created). Run it on the test project after applying 0001-0017, and again on the live
-- project after applying 0015-0017. Every row should say ok = true. Expected numbers are for the schema after 0001-0017.
-- (Before 0015-0017 are applied, the rows about the new features are expected to say false: that is how it tells you what is missing.)
with
fn as (select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo'),
newfn as (select * from fn where proname in ('set_avatar', 'remove_avatar', 'set_preferences', 'delete_job', '_emp_from_path', 'jobs_frozen_when_deleted')),
userfn as (select * from fn where proname in ('set_avatar', 'remove_avatar', 'set_preferences', 'delete_job')),
checks(n, check_name, expected, actual) as (
  select 1, 'tables in schema pressgo', '19',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relkind = 'r')::text
  union all select 2, 'policies in schema pressgo', '31', (select count(*) from pg_policies where schemaname = 'pressgo')::text
  union all select 3, 'triggers in schema pressgo', '21',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and not t.tgisinternal)::text
  union all select 4, 'functions in schema pressgo', '54', (select count(*) from fn)::text
  union all select 5, 'tables WITHOUT row security', '0',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relkind = 'r' and not c.relrowsecurity)::text
  union all select 6, 'write privileges for authenticated/anon/PUBLIC on pressgo tables', '0',
    (select count(*) from information_schema.role_table_grants where table_schema = 'pressgo' and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type <> 'SELECT')::text
  union all select 7, 'new functions anon or PUBLIC can run', '0',
    (select count(*) from newfn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute'))::text
  union all select 8, 'signed-in people can run the 4 user functions', '4',
    (select count(*) from userfn where has_function_privilege('authenticated', oid, 'execute'))::text
  union all select 9, 'new tables with row security (avatars, preferences)', '2',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relname in ('employee_avatars', 'employee_preferences') and c.relrowsecurity)::text
  union all select 10, 'jobs has deleted_at / deleted_by / delete_reason', '3',
    (select count(*) from information_schema.columns where table_schema = 'pressgo' and table_name = 'jobs' and column_name in ('deleted_at', 'deleted_by', 'delete_reason'))::text
  union all select 11, 'trigger jobs_frozen exists (deleted jobs are locked)', '1',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pressgo' and c.relname = 'jobs' and t.tgname = 'jobs_frozen' and not t.tgisinternal)::text
  union all select 12, 'can_view_job() hides deleted jobs', 'true',
    coalesce((select bool_or(pg_get_functiondef(f.oid) ilike '%deleted_at is null%') from fn f where f.proname = 'can_view_job'), false)::text
  union all select 13, 'private buckets: avatars, chat-files, job-files', '3',
    (select count(*) from storage.buckets where id in ('avatars', 'chat-files', 'job-files') and public = false)::text
  union all select 14, 'avatars bucket: 2 MB limit, JPEG/PNG/WebP only', 'true',
    coalesce((select file_size_limit = 2097152 and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp'] and cardinality(allowed_mime_types) = 3 from storage.buckets where id = 'avatars'), false)::text
  union all select 15, 'avatars storage policies (read, add, tidy)', '3',
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('pressgo avatars read', 'pressgo avatars add', 'pressgo avatars tidy'))::text
  union all select 16, 'no UPDATE policy on avatars (pictures cannot be overwritten)', '0',
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL') and (policyname ilike '%avatar%' or qual ilike '%avatars%' or with_check ilike '%avatars%'))::text
)
select n, check_name, expected, actual, (expected = actual) as ok from checks order by n;
