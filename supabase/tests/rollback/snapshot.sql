-- Rollback test, step 1 (run on a database that has migrations 0001-0014 ONLY, before 0015-0017 are applied).
-- Records what the structure of the database looks like (functions, rules, triggers, columns, constraints, table rights,
-- storage buckets). After 0015-0017 are applied and rolled back, the same snapshot must be identical.
create schema rbcheck;
create function rbcheck.snapshot() returns table(what text, item text) language sql stable set search_path = pg_catalog as $$   -- fixed, so the text does not depend on the caller's search_path
  select 'function'::text, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')='
         || md5(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g')) || '|acl=' || coalesce(p.proacl::text, '')
    from pg_proc p where p.pronamespace = 'pressgo'::regnamespace
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname || '='
         || md5(coalesce(cmd, '') || '|' || coalesce(array_to_string(roles, ','), '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''))
    from pg_policies where schemaname = 'pressgo' or (schemaname = 'storage' and tablename = 'objects')
  union all
  select 'trigger', c.relname || '.' || t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'pressgo'::regnamespace and not t.tgisinternal
  union all
  select 'column', c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'pressgo'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint', conrelid::regclass::text || '.' || conname || '=' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'pressgo'::regnamespace
  union all
  select 'table', c.relname || ':kind=' || c.relkind::text || ':rls=' || c.relrowsecurity::text || ':acl=' || coalesce(c.relacl::text, '')
    from pg_class c where c.relnamespace = 'pressgo'::regnamespace and c.relkind in ('r', 'v')
  union all
  select 'bucket', id || ':public=' || public::text || ':limit=' || coalesce(file_size_limit::text, '') || ':types=' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets
$$;
create table rbcheck.before as select * from rbcheck.snapshot();
select 'snapshot taken: ' || count(*) || ' items' as result from rbcheck.before;
