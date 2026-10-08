-- PressGO Phase 3.5: sign in with a username + password (no email).
-- A username "jane" is stored as the login address jane@pressgo.example.com. Nothing is ever emailed to it.
-- Managers create logins and reset passwords from the Staff screen, which calls the admin-users function.
alter table pressgo.employees
  add column if not exists username text generated always as (lower(split_part(email, '@', 1))) stored;

-- The admin-users function runs as service_role, which needs access to the pressgo schema.
grant usage on schema pressgo to service_role;
grant select, insert, update, delete on all tables in schema pressgo to service_role;
grant usage on all sequences in schema pressgo to service_role;
grant execute on all functions in schema pressgo to service_role;
