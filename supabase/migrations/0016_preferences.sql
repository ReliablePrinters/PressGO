-- PressGO: personal look-and-feel settings, saved per person so they come back at the next sign-in.
--   theme  = System (follow the computer), Light or Dark
--   accent = the colour of buttons, links and highlights (a short fixed list, each one checked for readable contrast)
-- Only the person themselves can read or change their own row (not even managers). The list of accents is repeated in
-- docs/prefs.js and docs/style.css: if you add one, add it in all three places.
create table if not exists pressgo.employee_preferences (
  employee_id uuid primary key references pressgo.employees(id),
  theme       text not null default 'system' check (theme in ('system', 'light', 'dark')),
  accent      text not null default 'purple' check (accent in ('purple', 'blue', 'teal', 'green', 'orange', 'graphite')),
  updated_at  timestamptz not null default now()
);
alter table pressgo.employee_preferences enable row level security;
drop policy if exists prefs_select on pressgo.employee_preferences;
create policy prefs_select on pressgo.employee_preferences for select to authenticated
  using (employee_id = pressgo.current_employee_id());
revoke all on pressgo.employee_preferences from public, anon, authenticated;
grant select on pressgo.employee_preferences to authenticated;

create or replace function pressgo.set_preferences(p_theme text, p_accent text)
returns pressgo.employee_preferences
language plpgsql security definer set search_path = pressgo as $$
declare me uuid := current_employee_id(); r employee_preferences;
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce(p_theme, '') not in ('system', 'light', 'dark') then raise exception 'unknown appearance'; end if;
  if coalesce(p_accent, '') not in ('purple', 'blue', 'teal', 'green', 'orange', 'graphite') then raise exception 'unknown accent colour'; end if;
  insert into employee_preferences (employee_id, theme, accent) values (me, p_theme, p_accent)
  on conflict (employee_id) do update set theme = excluded.theme, accent = excluded.accent, updated_at = now()
  returning * into r;
  return r;
end $$;

do $$ begin
  revoke execute on function pressgo.set_preferences(text, text) from public, anon;
  grant execute on function pressgo.set_preferences(text, text) to authenticated;
end $$;
