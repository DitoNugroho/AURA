create extension if not exists vector with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'analis' check (role in ('admin', 'analis', 'head')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  request_number text not null default '',
  sector text not null default '',
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'archived')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('t01', 't11', 'mockup', 'mapping', 'timeline', 'uat')),
  title text not null,
  content text not null default '',
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'changes_requested', 'approved')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create table if not exists public.document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.project_documents(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  category text not null check (category in ('T.0.1 Rencana', 'T.1.1 User Requirement', 'Timeline', 'User Manual', 'Naskah Dinas', 'Lainnya')),
  version_label text not null default '',
  document_date date,
  source_status text not null default 'perlu_verifikasi' check (source_status in ('disetujui', 'draft', 'digantikan', 'perlu_verifikasi')),
  processing_status text not null default 'queued' check (processing_status in ('queued', 'processing', 'ready', 'failed')),
  processing_message text not null default '',
  byte_size bigint not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create index if not exists kb_chunks_embedding_idx on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_chunks_document_idx on public.kb_chunks(document_id, chunk_index);
create index if not exists projects_expiry_idx on public.projects(expires_at);
create index if not exists kb_documents_expiry_idx on public.kb_documents(expires_at) where expires_at is not null;

create table if not exists public.prompt_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  project_id uuid references public.projects(id) on delete set null,
  prompt text not null,
  response_summary text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create or replace function public.current_aura_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.match_aura_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  category_filter text default null,
  project_filter uuid default null
)
returns table(id uuid, document_id uuid, title text, category text, content text, metadata jsonb, score double precision)
language sql stable security invoker set search_path = public, extensions
as $$
  select c.id, d.id, d.title, d.category, c.content, c.metadata,
         1 - (c.embedding <=> query_embedding) as score
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where d.processing_status = 'ready'
    and d.source_status = 'disetujui'
    and c.metadata->>'embedding_model' = 'text-embedding-3-small'
    and (d.project_id is null or d.project_id = project_filter)
    and (category_filter is null or d.category = category_filter or (d.category = 'Naskah Dinas' and d.project_id = project_filter))
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_documents enable row level security;
alter table public.document_comments enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.prompt_logs enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles self or admin read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_aura_role() = 'admin');
create policy "admin manages profiles" on public.profiles for all to authenticated
  using (public.current_aura_role() = 'admin') with check (public.current_aura_role() = 'admin');

create policy "team reads projects" on public.projects for select to authenticated using (true);
create policy "team creates projects" on public.projects for insert to authenticated with check (created_by = auth.uid());
create policy "team updates projects" on public.projects for update to authenticated using (true) with check (true);
create policy "team deletes projects" on public.projects for delete to authenticated using (public.current_aura_role() = 'admin');

create policy "team reads project documents" on public.project_documents for select to authenticated using (true);
create policy "team creates project documents" on public.project_documents for insert to authenticated with check (created_by = auth.uid());
create policy "makers edit project drafts" on public.project_documents for update to authenticated
  using (public.current_aura_role() in ('admin', 'analis') and status in ('draft', 'changes_requested'))
  with check (public.current_aura_role() in ('admin', 'analis') and status in ('draft', 'in_review') and updated_by = auth.uid());
create policy "heads review project documents" on public.project_documents for update to authenticated
  using (public.current_aura_role() in ('admin', 'head'))
  with check (public.current_aura_role() in ('admin', 'head') and updated_by = auth.uid());
create policy "admin deletes project documents" on public.project_documents for delete to authenticated using (public.current_aura_role() = 'admin');

create policy "team reads comments" on public.document_comments for select to authenticated using (true);
create policy "team adds comments" on public.document_comments for insert to authenticated with check (author_id = auth.uid());
create policy "authors or admins remove comments" on public.document_comments for delete to authenticated using (author_id = auth.uid() or public.current_aura_role() = 'admin');

create policy "team reads KB metadata" on public.kb_documents for select to authenticated using (true);
create policy "admins manage KB metadata" on public.kb_documents for all to authenticated
  using (public.current_aura_role() = 'admin') with check (public.current_aura_role() = 'admin');
create policy "analysts attach project request files" on public.kb_documents for insert to authenticated
  with check (category = 'Naskah Dinas' and project_id is not null and uploaded_by = auth.uid()
    and public.current_aura_role() in ('admin', 'analis'));
create policy "team reads KB chunks" on public.kb_chunks for select to authenticated using (true);
create policy "admins manage KB chunks" on public.kb_chunks for all to authenticated
  using (public.current_aura_role() = 'admin') with check (public.current_aura_role() = 'admin');

create policy "users create own prompt logs" on public.prompt_logs for insert to authenticated with check (user_id = auth.uid());
create policy "admins read prompt logs" on public.prompt_logs for select to authenticated using (public.current_aura_role() = 'admin');
create policy "users add audit logs" on public.audit_logs for insert to authenticated with check (user_id = auth.uid());
create policy "admins read audit logs" on public.audit_logs for select to authenticated using (public.current_aura_role() = 'admin');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aura-kb', 'aura-kb', false, 52428800,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy "admins upload KB files" on storage.objects for insert to authenticated
  with check (bucket_id = 'aura-kb' and public.current_aura_role() = 'admin');
create policy "analysts upload request files" on storage.objects for insert to authenticated
  with check (bucket_id = 'aura-kb' and public.current_aura_role() in ('admin', 'analis')
    and split_part(name, '/', 1) = auth.uid()::text);
create policy "team read KB files" on storage.objects for select to authenticated
  using (bucket_id = 'aura-kb');
create policy "admins update KB files" on storage.objects for update to authenticated
  using (bucket_id = 'aura-kb' and public.current_aura_role() = 'admin')
  with check (bucket_id = 'aura-kb' and public.current_aura_role() = 'admin');
create policy "admins remove KB files" on storage.objects for delete to authenticated
  using (bucket_id = 'aura-kb' and public.current_aura_role() = 'admin');

create or replace function public.purge_expired_aura_data()
returns integer language plpgsql security definer set search_path = public
as $$
declare removed integer := 0;
begin
  delete from public.prompt_logs where expires_at < now(); get diagnostics removed = row_count;
  delete from public.audit_logs where expires_at < now();
  delete from public.document_comments where expires_at < now();
  delete from public.project_documents where expires_at < now();
  delete from public.projects where expires_at < now();
  return removed;
end;
$$;
