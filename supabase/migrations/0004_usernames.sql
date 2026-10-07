-- PressGO: sign in with a username + password (no email). Username jane = login jane@pressgo.example.com.
alter table pressgo.employees add column if not exists username text generated always as (lower(split_part(email, '@', 1))) stored;
