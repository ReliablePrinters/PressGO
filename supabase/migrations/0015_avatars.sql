-- PressGO: profile pictures (avatars).
-- Each person can set, change or remove THEIR OWN picture. Nobody (managers included) can change someone else's.
-- Pictures live in a private bucket called avatars, in a folder named after the person's employee id.
-- Every active member of staff can see everybody's picture (it is shown next to names in chat and on jobs).
-- Nothing is shown for a person without one: the app falls back to the coloured initials circle (the default avatar).
-- Like the other tables, this one cannot be written directly: set_avatar() / remove_avatar() are the only way in.
create table if not exists pressgo.employee_avatars (
  employee_id uuid primary key references pressgo.employees(id),
  avatar_path text not null,
  mime_type   text not null,
  size_bytes  bigint not null check (size_bytes > 0 and size_bytes <= 2097152),
  updated_at  timestamptz not null default now()
);
alter table pressgo.employee_avatars enable row level security;
drop policy if exists avatars_select on pressgo.employee_avatars;
create policy avatars_select on pressgo.employee_avatars for select to authenticated
  using (pressgo.current_employee_id() is not null);
revoke all on pressgo.employee_avatars from public, anon, authenticated;
grant select on pressgo.employee_avatars to authenticated;

-- the first folder of a picture's path is the owner's employee id
create or replace function pressgo._emp_from_path(p_name text) returns uuid
language plpgsql immutable set search_path = pressgo as $$
begin return split_part(p_name, '/', 1)::uuid;
exception when others then return null; end $$;

-- Called after the browser has uploaded the picture to private storage. Always acts on the signed-in person.
create or replace function pressgo.set_avatar(p_path text, p_mime text, p_size bigint)
returns pressgo.employee_avatars
language plpgsql security definer set search_path = pressgo as $$
declare me uuid := current_employee_id(); ext text; a employee_avatars;
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce(p_mime, '') not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'a profile picture must be a JPEG, PNG or WebP image';
  end if;
  if p_size is null or p_size <= 0 or p_size > 2097152 then
    raise exception 'that picture is too big (2 MB at most)';
  end if;
  -- the file must sit in MY folder, with a plain generated name and the extension that matches its type
  if p_path is null or p_path !~ ('^' || me::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
    raise exception 'the picture is stored in the wrong place';
  end if;
  ext := substring(p_path from '\.([a-z]+)$');
  if (p_mime = 'image/jpeg' and ext <> 'jpg') or (p_mime = 'image/png' and ext <> 'png') or (p_mime = 'image/webp' and ext <> 'webp') then
    raise exception 'the picture''s file name does not match its type';
  end if;
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
      raise exception 'the picture did not finish uploading; please try again';
    end if;
  end if;
  insert into employee_avatars (employee_id, avatar_path, mime_type, size_bytes)
  values (me, p_path, p_mime, p_size)
  on conflict (employee_id) do update
    set avatar_path = excluded.avatar_path, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, updated_at = now()
  returning * into a;
  return a;
end $$;

-- Back to the default avatar. Returns the path that was in use so the app can tidy up the old file.
create or replace function pressgo.remove_avatar() returns text
language plpgsql security definer set search_path = pressgo as $$
declare me uuid := current_employee_id(); old text;
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from employee_avatars where employee_id = me returning avatar_path into old;
  return old;
end $$;

do $$ begin
  revoke execute on function pressgo.set_avatar(text, text, bigint) from public, anon;
  grant execute on function pressgo.set_avatar(text, text, bigint) to authenticated;
  revoke execute on function pressgo.remove_avatar() from public, anon;
  grant execute on function pressgo.remove_avatar() to authenticated;
  revoke execute on function pressgo._emp_from_path(text) from public, anon;
  grant execute on function pressgo._emp_from_path(text) to authenticated;

  if to_regnamespace('storage') is not null then
    -- the bucket itself refuses anything but small JPEG / PNG / WebP files
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

    -- any active staff member can see pictures; you can only add to (or tidy up) your OWN folder; nobody can overwrite
    drop policy if exists "pressgo avatars read" on storage.objects;
    create policy "pressgo avatars read" on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and pressgo.current_employee_id() is not null);
    drop policy if exists "pressgo avatars add" on storage.objects;
    create policy "pressgo avatars add" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and pressgo._emp_from_path(name) = pressgo.current_employee_id());
    drop policy if exists "pressgo avatars tidy" on storage.objects;
    create policy "pressgo avatars tidy" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and pressgo._emp_from_path(name) = pressgo.current_employee_id());
  end if;
end $$;
