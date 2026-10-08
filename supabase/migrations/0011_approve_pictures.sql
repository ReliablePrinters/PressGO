-- PressGO: approving pictures sent in chat.
-- Front desk and managers (admins) can approve a picture someone ELSE sent. The approval shows under the picture
-- ("Approved by ..."), the sender is told, and in a job chat the job's owner is told to go ahead (and it is added to the job's history).
alter table pressgo.messages
  add column if not exists approved_by uuid references pressgo.employees(id),
  add column if not exists approved_at timestamptz;

-- messages stay locked, except for the two controlled changes (deleting, approving)
create or replace function pressgo.messages_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.conversation_id = old.conversation_id
     and new.author_id = old.author_id and new.sent_at = old.sent_at then
    if current_setting('pressgo.deleting', true) = 'on' and old.hidden_at is null and new.hidden_at is not null then return new; end if;
    if current_setting('pressgo.approving', true) = 'on' and new.body is not distinct from old.body
       and new.attachment_path is not distinct from old.attachment_path and new.hidden_at is not distinct from old.hidden_at then return new; end if;
  end if;
  raise exception 'messages cannot be edited or deleted';
end $$;

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

do $$ begin
  revoke execute on function pressgo.approve_picture(uuid, boolean) from public, anon;
  grant execute on function pressgo.approve_picture(uuid, boolean) to authenticated;
end $$;
