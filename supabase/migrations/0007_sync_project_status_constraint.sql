-- Ensure the active database accepts every status used by the AURA workflow.
-- Safe to apply whether or not 0006 was already applied to this database.
update public.projects
set status = case status
  when 'review' then 'analyst_review'
  else status
end
where status = 'review';

alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in (
    'draft',
    'submitted',
    'analyst_review',
    'changes_requested',
    'rejected',
    'pending_approval',
    'approved',
    'archived'
  ));
