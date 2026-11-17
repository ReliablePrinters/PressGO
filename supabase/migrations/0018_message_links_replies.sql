-- PressGO 2.0 (messaging): alerts remember WHICH message they are about, replies also work for pictures and alert the
-- person replied to, taking back a picture approval alerts the sender, and a chat can be marked unread again.
-- Nothing is removed: existing alerts keep working (their new link columns are simply empty), and every earlier rule in
-- send_message, send_attachment and approve_picture is unchanged.

-- ---- an alert can point at a chat and the exact message
alter table pressgo.notifications
  add column if not exists conversation_id uuid references pressgo.conversations(id),
  add column if not exists message_id      uuid references pressgo.messages(id);

-- _notify gets two optional extras. The old 5-argument version is removed so a call can only mean one thing.
drop function if exists pressgo._notify(uuid, text, text, uuid, uuid);
create or replace function pressgo._notify(p_emp uuid, p_kind text, p_title text, p_job uuid, p_task uuid default null,
                                           p_conv uuid default null, p_msg uuid default null) returns void
language plpgsql security definer set search_path = pressgo as $$
begin
  if p_emp is null or p_emp = pressgo.current_employee_id() then return; end if;   -- never alert people about their own actions
  if not exists (select 1 from employees where id = p_emp and active) then return; end if;
  insert into notifications (employee_id, kind, title, job_id, task_id, conversation_id, message_id)
  values (p_emp, p_kind, p_title, p_job, p_task, p_conv, p_msg);
end $$;
revoke all on function pressgo._notify(uuid, text, text, uuid, uuid, uuid, uuid) from public, authenticated, anon;

-- ---- approving a picture: the alert now carries the chat and the message; taking the approval back alerts the sender
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
      perform pressgo._notify(m.author_id, 'approved', v_name || ' approved your picture on Job #' || j.job_number || ' (' || j.customer_name || ')', j.id, null, m.conversation_id, m.id);
      if j.current_assignee_id is distinct from m.author_id then
        perform pressgo._notify(j.current_assignee_id, 'approved', 'Picture approved on Job #' || j.job_number || ' (' || j.customer_name || '). You can go ahead.', j.id, null, m.conversation_id, m.id);
      end if;
      insert into audit_events (job_id, actor_id, action, after) values (j.id, v_me, 'job.picture_approved', jsonb_build_object('message_id', m.id, 'file_name', m.attachment_name));
    else
      perform pressgo._notify(m.author_id, 'approved', v_name || ' approved your picture', null, null, m.conversation_id, m.id);
    end if;
  else
    if m.approved_at is null then return; end if;
    if m.approved_by is distinct from v_me and not pressgo.is_manager() then raise exception 'Only the person who approved it, or a manager, can take the approval back'; end if;
    update messages set approved_by = null, approved_at = null where id = m.id;
    if c.type = 'job' and c.job_id is not null then
      select * into j from jobs where id = c.job_id;
      perform pressgo._notify(m.author_id, 'approval_withdrawn', v_name || ' took back the approval of your picture on Job #' || j.job_number || ' (' || j.customer_name || ')', j.id, null, m.conversation_id, m.id);
      insert into audit_events (job_id, actor_id, action, after) values (c.job_id, v_me, 'job.picture_approval_withdrawn', jsonb_build_object('message_id', m.id, 'file_name', m.attachment_name));
    else
      perform pressgo._notify(m.author_id, 'approval_withdrawn', v_name || ' took back the approval of your picture', null, null, m.conversation_id, m.id);
    end if;
  end if;
  perform set_config('pressgo.approving', 'off', true);
end $$;

-- ---- send_message: replying alerts the person you replied to (never yourself)
create or replace function pressgo.send_message(p_conv uuid, p_body text, p_reply uuid default null) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_id uuid; v_body text := btrim(coalesce(p_body, ''));
        v_orig uuid; v_name text; v_job uuid; v_num text;
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
  if p_reply is not null then
    select author_id into v_orig from messages where id = p_reply;
    select display_name into v_name from employees where id = v_me;
    select c.job_id, j.job_number::text into v_job, v_num from conversations c left join jobs j on j.id = c.job_id where c.id = p_conv;
    perform pressgo._notify(v_orig, 'reply', v_name || ' replied to your message' || case when v_num is not null then ' on Job #' || v_num else '' end, v_job, null, p_conv, v_id);
  end if;
  return v_id;
end $$;

-- ---- send_attachment: pictures can be replies too (new optional last argument). The old 6-argument version is removed
-- so a call with six arguments cannot be ambiguous.
drop function if exists pressgo.send_attachment(uuid, text, text, text, text, bigint);
create or replace function pressgo.send_attachment(
  p_conv uuid, p_caption text, p_path text, p_name text, p_mime text, p_size bigint, p_reply uuid default null
) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_id uuid; v_cap text := btrim(coalesce(p_caption, ''));
        v_orig uuid; v_name text; v_job uuid; v_num text;
begin
  if v_me is null or not pressgo.can_read_conversation(p_conv) then raise exception 'You cannot post here'; end if;
  if coalesce(p_mime, '') not like 'image/%' then raise exception 'Only pictures can be sent here'; end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then raise exception 'That picture is too big (10 MB at most)'; end if;
  if pressgo._conv_from_path(p_path) is distinct from p_conv then raise exception 'Picture is not stored for this chat'; end if;
  if length(v_cap) > 1000 then raise exception 'That caption is too long (1000 characters at most)'; end if;
  if p_reply is not null and not exists (select 1 from messages where id = p_reply and conversation_id = p_conv) then
    raise exception 'The message you are replying to is not in this chat';
  end if;
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects where bucket_id = 'chat-files' and name = p_path) then
      raise exception 'The picture did not finish uploading. Try again.';
    end if;
  end if;
  insert into messages (conversation_id, author_id, body, reply_to_id, attachment_path, attachment_name, attachment_mime, attachment_size)
  values (p_conv, v_me, case when v_cap = '' then 'Photo' else v_cap end, p_reply, p_path, left(coalesce(p_name, 'photo'), 200), p_mime, p_size)
  returning id into v_id;
  insert into conversation_reads (conversation_id, employee_id, last_read_at) values (p_conv, v_me, now())
    on conflict (conversation_id, employee_id) do update set last_read_at = now();
  if p_reply is not null then
    select author_id into v_orig from messages where id = p_reply;
    select display_name into v_name from employees where id = v_me;
    select c.job_id, j.job_number::text into v_job, v_num from conversations c left join jobs j on j.id = c.job_id where c.id = p_conv;
    perform pressgo._notify(v_orig, 'reply', v_name || ' replied to your message' || case when v_num is not null then ' on Job #' || v_num else '' end, v_job, null, p_conv, v_id);
  end if;
  return v_id;
end $$;

-- ---- mark a chat unread again. With a message id: unread from that message on. Without: the latest message from someone else.
create or replace function pressgo.mark_unread(p_conv uuid, p_msg uuid default null) returns void
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_at timestamptz;
begin
  if v_me is null or not pressgo.can_read_conversation(p_conv) then return; end if;
  if p_msg is not null then select sent_at into v_at from messages where id = p_msg and conversation_id = p_conv; end if;
  if v_at is null then select max(sent_at) into v_at from messages where conversation_id = p_conv and author_id <> v_me; end if;
  if v_at is null then return; end if;
  insert into conversation_reads (conversation_id, employee_id, last_read_at) values (p_conv, v_me, v_at - interval '1 millisecond')
    on conflict (conversation_id, employee_id) do update set last_read_at = excluded.last_read_at;
end $$;

-- live updates for alerts (as 0005 did for messages): a new alert reaches the person's screen at once. Realtime applies the
-- same row rule as the table (people only receive their own alerts).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'pressgo' and tablename = 'notifications') then
    alter publication supabase_realtime add table pressgo.notifications;
  end if;
end $$;

do $$ begin
  revoke execute on function pressgo.send_attachment(uuid, text, text, text, text, bigint, uuid) from public, anon;
  grant execute on function pressgo.send_attachment(uuid, text, text, text, text, bigint, uuid) to authenticated;
  revoke execute on function pressgo.mark_unread(uuid, uuid) from public, anon;
  grant execute on function pressgo.mark_unread(uuid, uuid) to authenticated;
end $$;
