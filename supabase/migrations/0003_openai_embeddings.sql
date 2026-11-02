-- Restrict semantic search to the OpenAI embedding space used by AURA.
-- Existing Gemini vectors remain stored until each document is reindexed.
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
