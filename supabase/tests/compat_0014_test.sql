-- Compatibility of the PressGO 2.0 web app with the database it meets.
-- Run twice by run_local.sh:  -v migrated=0  on a database built from migrations 0001-0014 only (what is live today),
--                             -v migrated=1  on a database built from all of 0001-0018.
-- It checks (a) that the four zero-row probes in docs/caps.js tell the two states apart, with the error that PostgreSQL gives when the object is missing,
-- (b) that everything the 1.x web app used is still there and callable in BOTH states, (c) that the five new functions and the avatar bucket exist only
-- once their update is applied. The browser side is tested in desktop/test/caps.test.js and compat-0014-web.test.js.
select set_config('compat.migrated', :'migrated', false);

create or replace function pg_temp.check_that(label text, cond boolean) returns void language plpgsql as $$
begin if cond is not true then raise exception 'COMPAT FAILED: %', label; end if; end $$;
create or replace function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

do $$
declare
  m boolean := current_setting('compat.migrated') = '1';
  fn text;
  old_fns text[] := array['accept_handoff','accept_invitation','approve_artwork','approve_picture','assign_job','cancel_handoff','create_job','create_task',
    'delete_message','department_staff','handoff_job','mark_alerts_read','mark_read','my_conversations','raise_hold','register_file','resolve_hold',
    'send_attachment','send_message','set_break','set_task_done','start_chat','transition_job','update_job_details','withdraw_artwork_approval'];
  new_fns text[] := array['set_avatar','remove_avatar','set_preferences','delete_job','mark_unread'];
begin
  -- (a) the probes in docs/caps.js: "ok" when the update is there, "table does not exist" (42P01) or "column does not exist" (42703) when it is not
  perform pg_temp.check_that('probe avatars (0015): employee_avatars.employee_id',  pg_temp.try('select employee_id from pressgo.employee_avatars limit 0') = case when m then 'ok' else '42P01' end);
  perform pg_temp.check_that('probe prefs (0016): employee_preferences.theme',      pg_temp.try('select theme from pressgo.employee_preferences limit 0') = case when m then 'ok' else '42P01' end);
  perform pg_temp.check_that('probe deleteJob (0017): jobs.deleted_at',             pg_temp.try('select deleted_at from pressgo.jobs limit 0') = case when m then 'ok' else '42703' end);
  perform pg_temp.check_that('probe links (0018): notifications.message_id',        pg_temp.try('select message_id from pressgo.notifications limit 0') = case when m then 'ok' else '42703' end);

  -- (b) what the 1.x web app used keeps working in both states
  perform pg_temp.check_that('Alerts: the older notification columns can always be read',
    pg_temp.try('select id, kind, title, job_id, created_at, read_at from pressgo.notifications limit 0') = 'ok');
  perform pg_temp.check_that('jobs and messages: the columns the lists and chats read exist in both states',
    pg_temp.try('select id, job_number, version, lifecycle_status, created_by, current_assignee_id from pressgo.jobs limit 0') = 'ok'
    and pg_temp.try('select id, body, sent_at, author_id, reply_to_id, attachment_path, hidden_at, approved_by, approved_at from pressgo.messages limit 0') = 'ok');
  foreach fn in array old_fns loop
    perform pg_temp.check_that('function ' || fn || ' exists in this state', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and p.proname = fn));
  end loop;
  perform pg_temp.check_that('text replies: send_message takes a reply (p_reply) in both states',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and p.proname = 'send_message' and 'p_reply' = any (p.proargnames)));
  perform pg_temp.check_that('pictures: the six-argument call of the 1.x app resolves in this state',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'pressgo' and p.proname = 'send_attachment' and p.pronargs - p.pronargdefaults <= 6 and p.pronargs >= 6)
    and (m or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and p.proname = 'send_attachment' and 'p_reply' = any (p.proargnames))));
  perform pg_temp.check_that('picture replies: send_attachment takes p_reply only once 0018 is applied',
    (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and p.proname = 'send_attachment' and 'p_reply' = any (p.proargnames))) = m);

  -- (c) the new functions and the avatar bucket exist exactly when their update is applied
  foreach fn in array new_fns loop
    perform pg_temp.check_that('function ' || fn || ' exists only after its update (migrated=' || m || ')',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo' and p.proname = fn) = m);
  end loop;
  perform pg_temp.check_that('the avatars bucket exists only after 0015', exists (select 1 from storage.buckets where id = 'avatars') = m);
  perform pg_temp.check_that('no 2.0 feature leaves a trace at 0014: no employee_avatars / employee_preferences tables, no jobs.deleted_by / delete_reason',
    (to_regclass('pressgo.employee_avatars') is not null) = m and (to_regclass('pressgo.employee_preferences') is not null) = m
    and (select count(*) from information_schema.columns where table_schema = 'pressgo' and table_name = 'jobs' and column_name in ('deleted_at', 'deleted_by', 'delete_reason')) = (case when m then 3 else 0 end));
end $$;

select case when current_setting('compat.migrated') = '1'
            then 'PASSED: web compatibility, fully migrated database'
            else 'PASSED: web compatibility, database at migration 0014' end as result;
