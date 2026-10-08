-- PressGO: close direct table writes.
-- Signed-in people may READ (row security still decides what). All changes must go through the checked functions.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pressgo' and c.relkind in ('r', 'p')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on pressgo.%I from authenticated, anon, public',
      t.relname);
  end loop;
end $$;
