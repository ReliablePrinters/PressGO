-- PressGO Phase 4: chat (General, Urgent Jobs, department channels, direct messages, job chat).
-- The conversations / messages tables and read rules already exist from phase 1; this adds
-- unread tracking, starting a direct message, sending, and the conversation list.

create table pressgo.conversation_reads (
  conversation_id uuid not null references pressgo.conversations(id),
  employee_id     uuid not null references pressgo.employees(id),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, employee_id)
);
alter table pressgo.conversation_reads enable row level security;
create policy cread_select on pressgo.conversation_reads for select to authenticated
  using (employee_id = pressgo.current_employee_id());
grant select on pressgo.conversation_reads to authenticated;
grant select, insert, update, delete on pressgo.conversation_reads to service_role;

-- Start (or find) a private chat between me and one other person.
create or replace function pressgo.start_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_conv uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_other is null or p_other = v_me then raise exception 'Pick someone else to message'; end if;
  if not exists (select 1 from employees where id = p_other and active) then raise exception 'That person is not available'; end if;
  select c.id into v_conv from conversations c
   where c.type = 'direct'
     and exists (select 1 from conversation_members m where m.conversation_id = c.id and m.employee_id = v_me)
     and exists (select 1 from conversation_members m where m.conversation_id = c.id and m.employee_id = p_other)
     and (select count(*) from conversation_members m where m.conversation_id = c.id) = 2
   limit 1;
  if v_conv is null then
    insert into conversations (type) values ('direct') returning id into v_conv;
    insert into conversation_members (conversation_id, employee_id) values (v_conv, v_me), (v_conv, p_other);
  end if;
  return v_conv;
end $$;

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

create or replace function pressgo.mark_read(p_conv uuid) returns void
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id();
begin
  if v_me is null or not pressgo.can_read_conversation(p_conv) then return; end if;
  insert into conversation_reads (conversation_id, employee_id, last_read_at) values (p_conv, v_me, now())
    on conflict (conversation_id, employee_id) do update set last_read_at = now();
end $$;

-- Everything I can chat in, with the latest message and my unread count.
-- Job chats only appear once someone has written in them.
create or replace function pressgo.my_conversations() returns table (
  id uuid, type text, name text, job_id uuid, last_body text, last_at timestamptz, last_author text, unread bigint)
language sql stable security definer set search_path = pressgo as $$
  with me as (select e.id, e.created_at from employees e where e.id = pressgo.current_employee_id() and e.active)
  select c.id, c.type,
    case c.type
      when 'direct' then (select e.display_name from conversation_members m join employees e on e.id = m.employee_id
                           where m.conversation_id = c.id and m.employee_id <> (select id from me) limit 1)
      when 'job' then 'Job #' || (select j.job_number from jobs j where j.id = c.job_id) || ' · ' || (select j.customer_name from jobs j where j.id = c.job_id)
      else c.name end,
    c.job_id, lm.body, lm.sent_at, lm.author,
    (select count(*) from messages m2 where m2.conversation_id = c.id and m2.author_id <> (select id from me)
        and m2.sent_at > coalesce(r.last_read_at, (select created_at from me)))
  from conversations c
  left join conversation_reads r on r.conversation_id = c.id and r.employee_id = (select id from me)
  left join lateral (select m.body, m.sent_at, a.display_name as author from messages m join employees a on a.id = m.author_id
                      where m.conversation_id = c.id order by m.sent_at desc limit 1) lm on true
  where exists (select 1 from me) and pressgo.can_read_conversation(c.id)
    and (c.type <> 'job' or lm.sent_at is not null)
  order by lm.sent_at desc nulls last, c.name
$$;

grant execute on function pressgo.start_direct(uuid), pressgo.send_message(uuid, text, uuid),
  pressgo.mark_read(uuid), pressgo.my_conversations() to authenticated, service_role;

-- live updates: new messages show up on other people's screens without a refresh
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'pressgo' and tablename = 'messages') then
    alter publication supabase_realtime add table pressgo.messages;
  end if;
end $$;
