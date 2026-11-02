-- Keep laptop-local Ollama vectors separate from the existing cloud embedding index.
create table if not exists public.kb_chunks_local (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create index if not exists kb_chunks_local_embedding_idx
  on public.kb_chunks_local using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_chunks_local_document_idx
  on public.kb_chunks_local(document_id, chunk_index);

alter table public.kb_chunks_local enable row level security;
create policy "team reads local KB chunks" on public.kb_chunks_local
  for select to authenticated using (true);
create policy "admins manage local KB chunks" on public.kb_chunks_local
  for all to authenticated using (public.current_aura_role() = 'admin')
  with check (public.current_aura_role() = 'admin');

create or replace function public.match_aura_chunks_local(
  query_embedding extensions.vector(1024),
  embedding_model_filter text default 'bge-m3',
  match_count integer default 8,
  category_filter text default null,
  project_filter uuid default null
)
returns table(id uuid, document_id uuid, title text, category text, content text, metadata jsonb, score double precision)
language sql stable security invoker set search_path = public, extensions
as $$
  select c.id, d.id, d.title, d.category, c.content, c.metadata,
         1 - (c.embedding <=> query_embedding) as score
  from public.kb_chunks_local c
  join public.kb_documents d on d.id = c.document_id
  where d.processing_status = 'ready'
    and d.source_status = 'disetujui'
    and c.metadata->>'embedding_model' = embedding_model_filter
    and (d.project_id is null or d.project_id = project_filter)
    and (category_filter is null or d.category = category_filter or (d.category = 'Naskah Dinas' and d.project_id = project_filter))
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
