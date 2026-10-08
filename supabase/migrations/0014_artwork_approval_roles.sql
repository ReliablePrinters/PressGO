-- PressGO: who may approve artwork ("Approved for Print").
-- Only Front Desk or a manager (the app's administrator role) may approve artwork. Everyone else is refused here, on the server,
-- whatever the app shows. This is the ONLY change: the rest of approve_artwork is exactly as in 0003, and
-- withdraw_artwork_approval is untouched (still manager-only).
create or replace function pressgo.approve_artwork(p_job uuid, p_version integer, p_file uuid)
returns pressgo.jobs
language plpgsql security definer set search_path = pressgo as $$
declare j jobs; o jobs; f job_files;
begin
  if not (is_manager() or is_front_desk()) then raise exception 'only Front Desk or a manager can approve artwork'; end if;
  select * into o from jobs where id = p_job;
  if not found then raise exception 'job not found'; end if;
  if o.lifecycle_status in ('Collected','Cancelled') then raise exception 'this job is closed'; end if;
  select * into f from job_files where id = p_file and job_id = p_job;
  if not found then raise exception 'file not found on this job'; end if;
  if f.category = 'Supporting Document' then raise exception 'a supporting document cannot be approved as artwork'; end if;
  perform _note('job.artwork_approved', 'Approved for Print: ' || f.file_name || ' (v' || f.version_no || ')');
  update jobs set approved_file_id = p_file where id = p_job and version = p_version returning * into j;
  if not found then raise exception 'job was changed by someone else (version conflict)' using errcode = '40001'; end if;
  return j;
end $$;

do $$ begin
  revoke execute on function pressgo.approve_artwork(uuid, integer, uuid) from public, anon;
  grant execute on function pressgo.approve_artwork(uuid, integer, uuid) to authenticated;
end $$;
