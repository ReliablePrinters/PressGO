-- PressGO: deleting messages.
-- The person who wrote a message can delete it. Managers can also delete messages in channels and job chats they can see
-- (never in private chats they are not part of). Everyone in the chat then sees "This message was deleted".
-- The original text is moved to a locked table that no app screen can read (kept for the owner's records).
create table if not exists pressgo.deleted_messages (
  message_id    uuid primary key references pressgo.messages(id),
  original_body text not null,
  attachment_path text,
  deleted_by    uuid not null references pressgo.employees(id),
  deleted_at    timestamptz not null default now(),
  reason        text not null
);
alter table pressgo.deleted_messages enable row level security;   -- no policies on purpose: staff screens cannot read it

-- messages stay locked, except for the one controlled change made by delete_message below
create or replace function pressgo.messages_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('pressgo.deleting', true) = 'on'
     and old.hidden_at is null and new.hidden_at is not null
     and new.id = old.id and new.conversation_id = old.conversation_id and new.author_id = old.author_id and new.sent_at = old.sent_at then
    return new;
  end if;
  raise exception 'messages cannot be edited or deleted';
end $$;

create or replace function pressgo.delete_message(p_msg uuid) returns void
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); m pressgo.messages; v_why text;
begin
  select * into m from messages where id = p_msg;
  if v_me is null or m.id is null or not pressgo.can_read_conversation(m.conversation_id) then raise exception 'You cannot delete this message'; end if;
  if m.hidden_at is not null then return; end if;
  if m.author_id = v_me then v_why := 'deleted by its author';
  elsif pressgo.is_manager() then v_why := 'deleted by a manager';
  else raise exception 'You can only delete your own messages'; end if;
  insert into deleted_messages (message_id, original_body, attachment_path, deleted_by, reason)
    values (m.id, m.body, m.attachment_path, v_me, v_why);
  perform set_config('pressgo.deleting', 'on', true);
  update messages set body = 'This message was deleted', attachment_path = null, attachment_name = null,
    attachment_mime = null, attachment_size = null, hidden_at = now(), hidden_reason = v_why where id = m.id;
  perform set_config('pressgo.deleting', 'off', true);
end $$;

do $$ begin
  revoke execute on function pressgo.delete_message(uuid) from public, anon;
  grant execute on function pressgo.delete_message(uuid) to authenticated;
  revoke all on pressgo.deleted_messages from public, anon, authenticated;
end $$;
