-- Allow Analysts to revise an accepted T.1.1. The application resets accepted
-- downstream artifacts to draft whenever T.1.1 changes.
drop policy if exists "analysts edit generated documents" on public.project_documents;
create policy "analysts edit generated documents" on public.project_documents
  for update to authenticated
  using (public.current_aura_role() in ('admin', 'analis')
    and kind in ('t11', 'mockup', 'mapping')
    and status in ('draft', 'analyst_review', 'changes_requested', 'analyst_accepted'))
  with check (public.current_aura_role() in ('admin', 'analis')
    and kind in ('t11', 'mockup', 'mapping')
    and status in ('draft', 'analyst_review', 'changes_requested', 'analyst_accepted', 'analyst_rejected')
    and updated_by = auth.uid());
