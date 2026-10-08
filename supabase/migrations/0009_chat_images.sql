-- PressGO: photos in chat. Images are stored in a private bucket called chat-files, in a folder named after the chat.
-- Only people who can read that chat can see or add pictures there (so private messages stay private).
-- Pictures cannot be changed or deleted afterwards, same as messages.
alter table pressgo.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

create or replace function pressgo._conv_from_path(p_name text) returns uuid
language plpgsql immutable set search_path = pressgo as $$
begin return split_part(p_name, '/', 1)::uuid;
exception when others then return null; end $$;

-- Called after the browser has uploaded the picture to private storage.
create or replace function pressgo.send_attachment(
  p_conv uuid, p_caption text, p_path text, p_name text, p_mime text, p_size bigint
) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_id uuid; v_cap text := btrim(coalesce(p_caption, ''));
begin
  if v_me is null or not pressgo.can_read_conversation(p_conv) then raise exception 'You cannot post here'; end if;
  if coalesce(p_mime, '') not like 'image/%' then raise exception 'Only pictures can be sent here'; end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then raise exception 'That picture is too big (10 MB at most)'; end if;
  if pressgo._conv_from_path(p_path) is distinct from p_conv then raise exception 'Picture is not stored for this chat'; end if;
  if length(v_cap) > 1000 then raise exception 'That caption is too long (1000 characters at most)'; end if;
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects where bucket_id = 'chat-files' and name = p_path) then
      raise exception 'The picture did not finish uploading. Try again.';
    end if;
  end if;
  insert into messages (conversation_id, author_id, body, attachment_path, attachment_name, attachment_mime, attachment_size)
  values (p_conv, v_me, case when v_cap = '' then 'Photo' else v_cap end, p_path, left(coalesce(p_name, 'photo'), 200), p_mime, p_size)
  returning id into v_id;
  insert into conversation_reads (conversation_id, employee_id, last_read_at) values (p_conv, v_me, now())
    on conflict (conversation_id, employee_id) do update set last_read_at = now();
  return v_id;
end $$;

do $$ begin
  revoke execute on function pressgo.send_attachment(uuid, text, text, text, text, bigint) from public, anon;
  grant execute on function pressgo.send_attachment(uuid, text, text, text, text, bigint) to authenticated;
  revoke execute on function pressgo._conv_from_path(text) from public, anon;
  grant execute on function pressgo._conv_from_path(text) to authenticated;
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat-files', 'chat-files', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif','image/heic'])
    on conflict (id) do update set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic'];
    drop policy if exists "pressgo chat files read" on storage.objects;
    create policy "pressgo chat files read" on storage.objects for select to authenticated
      using (bucket_id = 'chat-files' and pressgo.can_read_conversation(pressgo._conv_from_path(name)));
    drop policy if exists "pressgo chat files add" on storage.objects;
    create policy "pressgo chat files add" on storage.objects for insert to authenticated
      with check (bucket_id = 'chat-files' and pressgo.can_read_conversation(pressgo._conv_from_path(name)));
  end if;
end $$;
