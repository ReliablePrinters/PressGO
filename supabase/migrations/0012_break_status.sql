-- PressGO: "on break" status. Online/offline is worked out live in the browser (Realtime presence).
-- Break is stored so everyone sees it. Each person can only change their own (no audit noise).
create table if not exists pressgo.employee_status (
  employee_id uuid primary key references pressgo.employees(id) on delete cascade,
  break_since timestamptz
);
alter table pressgo.employee_status enable row level security;
drop policy if exists status_select on pressgo.employee_status;
create policy status_select on pressgo.employee_status for select to authenticated
  using (pressgo.current_employee_id() is not null);
revoke all on pressgo.employee_status from public, anon;
grant select on pressgo.employee_status to authenticated;

create or replace function pressgo.set_break(p_on boolean) returns timestamptz
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_ts timestamptz;
begin
  if v_me is null then raise exception 'Not signed in as staff'; end if;
  v_ts := case when p_on then now() else null end;
  insert into employee_status (employee_id, break_since) values (v_me, v_ts)
    on conflict (employee_id) do update set break_since = excluded.break_since;
  return v_ts;
end $$;

do $$ begin
  revoke execute on function pressgo.set_break(boolean) from public, anon;
  grant execute on function pressgo.set_break(boolean) to authenticated;
end $$;
