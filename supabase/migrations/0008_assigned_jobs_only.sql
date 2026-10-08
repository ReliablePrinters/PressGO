-- PressGO: people only see the jobs meant for them (not every job).
-- You can see a job if: you are a manager; it is assigned to you; you created it (so front desk can follow what they sent); you are front desk and the job is not yet released or is ready for collection;
-- it is assigned to your department and nobody in the department has taken it yet; it was handed to your department and is waiting for acceptance;
-- or you were given explicit access. Once a person takes or is given a job, the rest of the department no longer sees it.
create or replace function pressgo.can_view_job(p_job uuid) returns boolean
language sql stable security definer set search_path = pressgo as $$
  select pressgo.current_employee_id() is not null and exists (
    select 1 from jobs j where j.id = p_job and (
         pressgo.is_manager()
      or j.current_assignee_id = pressgo.current_employee_id()
      or j.created_by = pressgo.current_employee_id()
      or (pressgo.is_front_desk() and j.lifecycle_status in ('New', 'Ready for Collection'))
      or (j.current_assignee_id is null and pressgo.in_department(j.current_department_id))
      or exists (select 1 from job_access a where a.job_id = j.id and a.revoked_at is null
                 and (a.employee_id = pressgo.current_employee_id() or pressgo.in_department(a.department_id)))
      or exists (select 1 from job_handoffs h where h.job_id = j.id and h.status = 'Pending'
                 and pressgo.in_department(h.to_department_id))
    ))
$$;
