-- AURA workflow: analyst uploads T.0.1, reviews generated outputs, then approver performs final check.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'analis', 'head'));

alter table public.projects drop constraint if exists projects_status_check;
update public.projects set status = case status
  when 'review' then 'analyst_review'
  when 'approved' then 'approved'
  else status
end;
alter table public.projects add constraint projects_status_check
  check (status in ('draft', 'submitted', 'analyst_review', 'changes_requested', 'rejected', 'pending_approval', 'approved', 'archived'));

alter table public.project_documents drop constraint if exists project_documents_status_check;
update public.project_documents set status = case status
  when 'in_review' then 'analyst_review'
  when 'approved' then 'approved'
  when 'changes_requested' then 'changes_requested'
  else status
end;
alter table public.project_documents add constraint project_documents_status_check
  check (status in ('draft', 'submitted', 'analyst_review', 'changes_requested', 'analyst_accepted', 'analyst_rejected', 'approved'));

drop policy if exists "makers edit project drafts" on public.project_documents;
drop policy if exists "heads review project documents" on public.project_documents;
create policy "analysts edit generated documents" on public.project_documents for update to authenticated
  using (public.current_aura_role() in ('admin', 'analis') and kind in ('t11', 'mockup', 'mapping')
    and status in ('draft', 'analyst_review', 'changes_requested'))
  with check (public.current_aura_role() in ('admin', 'analis') and kind in ('t11', 'mockup', 'mapping')
    and status in ('draft', 'analyst_review', 'changes_requested', 'analyst_accepted', 'analyst_rejected') and updated_by = auth.uid());
create policy "analysts create output documents" on public.project_documents for insert to authenticated
  with check (public.current_aura_role() in ('admin', 'analis') and kind in ('t11', 'mockup', 'mapping')
    and status = 'draft' and created_by = auth.uid() and updated_by = auth.uid());
create policy "analysts attach t01 to project" on public.project_documents for insert to authenticated
  with check (public.current_aura_role() in ('admin', 'analis') and kind = 't01' and status = 'submitted'
    and created_by = auth.uid() and updated_by = auth.uid());
create policy "approvers finalize analyst documents" on public.project_documents for update to authenticated
  using (public.current_aura_role() in ('admin', 'head') and kind in ('t11', 'mockup', 'mapping') and status in ('analyst_accepted', 'approved'))
  with check (public.current_aura_role() in ('admin', 'head') and kind in ('t11', 'mockup', 'mapping') and status in ('approved', 'changes_requested') and updated_by = auth.uid());

drop policy if exists "analysts attach project request files" on public.kb_documents;
create policy "analysts attach project request files" on public.kb_documents for insert to authenticated
  with check (project_id is not null and category = 'Naskah Dinas' and uploaded_by = auth.uid()
    and public.current_aura_role() in ('admin', 'analis'));

drop policy if exists "analysts upload request files" on storage.objects;
create policy "analysts upload request files" on storage.objects for insert to authenticated
  with check (bucket_id = 'aura-kb' and public.current_aura_role() in ('admin', 'analis')
    and split_part(name, '/', 1) = auth.uid()::text);
