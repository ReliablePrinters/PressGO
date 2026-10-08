-- PressGO: private messages to one person OR to a chosen group (e.g. everyone in a department).
-- Anyone can start one; only the people in it can read it. Reuses the same chat if the exact same group already has one.
create or replace function pressgo.start_chat(p_people uuid[]) returns uuid
language plpgsql security definer set search_path = pressgo as $$
declare v_me uuid := pressgo.current_employee_id(); v_all uuid[]; v_conv uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_all
    from unnest(coalesce(p_people, '{}') || v_me) x;
  if array_length(v_all, 1) < 2 then raise exception 'Pick at least one other person'; end if;
  if array_length(v_all, 1) > 40 then raise exception 'That is too many people for one chat (40 at most)'; end if;
  if exists (select 1 from unnest(v_all) x where not exists (select 1 from employees e where e.id = x and e.active)) then
    raise exception 'Someone you picked is not available';
  end if;
  select c.id into v_conv from conversations c
   where c.type = 'direct'
     and (select coalesce(array_agg(m.employee_id order by m.employee_id), '{}') from conversation_members m where m.conversation_id = c.id) = v_all
   limit 1;
  if v_conv is null then
    insert into conversations (type) values ('direct') returning id into v_conv;
    insert into conversation_members (conversation_id, employee_id) select v_conv, x from unnest(v_all) x;
  end if;
  return v_conv;
end $$;
grant execute on function pressgo.start_chat(uuid[]) to authenticated, service_role;

-- a private chat is named after the other people in it
create or replace function pressgo.my_conversations() returns table (
  id uuid, type text, name text, job_id uuid, last_body text, last_at timestamptz, last_author text, unread bigint)
language sql stable security definer set search_path = pressgo as $$
  with me as (select e.id, e.created_at from employees e where e.id = pressgo.current_employee_id() and e.active)
  select c.id, c.type,
    case c.type
      when 'direct' then (select left(string_agg(e.display_name, ', ' order by e.display_name), 80) from conversation_members m
                           join employees e on e.id = m.employee_id
                           where m.conversation_id = c.id and m.employee_id <> (select id from me))
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
