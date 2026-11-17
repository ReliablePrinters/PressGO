-- PressGO: undo 0018 (message links, picture replies, reply alerts, mark-unread). Run as the database owner, in the Supabase SQL editor.
-- If the new web app is already published, put the OLD web app back first (revert the merge), otherwise people get errors
-- (the new screens call send_attachment with a reply argument and mark_unread, which disappear here).
-- Alerts that already have a chat/message link keep their text; only the two link columns are dropped.
-- Alerts of the kinds 'reply' and 'approval_withdrawn' stay in the table; the old app shows them with the generic bell icon.
begin;

-- the old six-argument send_attachment (exactly as in 0009)
drop function if exists pressgo.send_attachment(uuid, text, text, text, text, bigint, uuid);
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
revoke execute on function pressgo.send_attachment(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function pressgo.send_attachment(uuid, text, text, text, text, bigint) to authenticated;

-- the old send_message (exactly as in 0005)
create or replace function pressgo.send_message(p_conv uuid, p_body text, p_reply uuid default null) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  if v_me is null or not pressgo.can_read_conversation(p_conv) then raise exception 'You cannot post here'; end if;
  if v_body = '' then raise exception 'Type a message first'; end if;
  if length(v_body) > 4000 then raise exception 'That message is too long (4000 characters at most)'; end if;
  if p_reply is not null and not exists (select 1 from messages where id = p_reply and conversation_id = p_conv) then
    raise exception 'The message you are replying to is not in this chat';
  end if;
  insert into messages (conversation_id, author_id, body, reply_to_id) values (p_conv, v_me, v_body, p_reply) returning id into v_id;
  insert into conversation_reads (conversation_id, employee_id, last_read_at) values (p_conv, v_me, now())
    on conflict (conversation_id, employee_id) do update set last_read_at = now();
  return v_id;
end $$;

-- the old approve_picture (exactly as in 0011)
create or replace function pressgo.approve_picture(p_msg uuid, p_approve boolean default true) returns void
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); m pressgo.messages; c pressgo.conversations; j pressgo.jobs; v_name text;
begin
  if v_me is null or not (pressgo.is_manager() or pressgo.is_front_desk()) then
    raise exception 'Only front desk or a manager can approve pictures';
  end if;
  select * into m from messages where id = p_msg;
  if m.id is null or not pressgo.can_read_conversation(m.conversation_id) then raise exception 'You cannot reach this picture'; end if;
  if m.attachment_path is null or m.hidden_at is not null then raise exception 'That message is not a picture'; end if;
  select display_name into v_name from employees where id = v_me;
  select * into c from conversations where id = m.conversation_id;
  perform set_config('pressgo.approving', 'on', true);
  if p_approve then
    if m.author_id = v_me then raise exception 'You cannot approve your own picture'; end if;
    if m.approved_at is not null then return; end if;
    update messages set approved_by = v_me, approved_at = now() where id = m.id;
    if c.type = 'job' and c.job_id is not null then
      select * into j from jobs where id = c.job_id;
      perform pressgo._notify(m.author_id, 'approved', v_name || ' approved your picture on Job #' || j.job_number || ' (' || j.customer_name || ')', j.id);
      if j.current_assignee_id is distinct from m.author_id then
        perform pressgo._notify(j.current_assignee_id, 'approved', 'Picture approved on Job #' || j.job_number || ' (' || j.customer_name || '). You can go ahead.', j.id);
      end if;
      insert into audit_events (job_id, actor_id, action, after) values (j.id, v_me, 'job.picture_approved', jsonb_build_object('message_id', m.id, 'file_name', m.attachment_name));
    else
      perform pressgo._notify(m.author_id, 'approved', v_name || ' approved your picture', null);
    end if;
  else
    if m.approved_at is null then return; end if;
    if m.approved_by is distinct from v_me and not pressgo.is_manager() then raise exception 'Only the person who approved it, or a manager, can take the approval back'; end if;
    update messages set approved_by = null, approved_at = null where id = m.id;
    if c.type = 'job' and c.job_id is not null then
      insert into audit_events (job_id, actor_id, action, after) values (c.job_id, v_me, 'job.picture_approval_withdrawn', jsonb_build_object('message_id', m.id, 'file_name', m.attachment_name));
    end if;
  end if;
  perform set_config('pressgo.approving', 'off', true);
end $$;

drop function if exists pressgo.mark_unread(uuid, uuid);

-- the old five-argument _notify (exactly as in 0007), after everything that called the new one has been put back
drop function if exists pressgo._notify(uuid, text, text, uuid, uuid, uuid, uuid);
create or replace function pressgo._notify(p_emp uuid, p_kind text, p_title text, p_job uuid, p_task uuid default null) returns void
language plpgsql security definer set search_path = pressgo as $$
begin
  if p_emp is null or p_emp = pressgo.current_employee_id() then return; end if;   -- never alert people about their own actions
  if not exists (select 1 from employees where id = p_emp and active) then return; end if;
  insert into notifications (employee_id, kind, title, job_id, task_id) values (p_emp, p_kind, p_title, p_job, p_task);
end $$;
revoke all on function pressgo._notify(uuid, text, text, uuid, uuid) from public, authenticated, anon;

do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'pressgo' and tablename = 'notifications') then
    alter publication supabase_realtime drop table pressgo.notifications;
  end if;
end $$;
alter table pressgo.notifications drop column if exists message_id;
alter table pressgo.notifications drop column if exists conversation_id;
commit;
