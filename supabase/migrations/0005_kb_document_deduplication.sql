alter table public.kb_documents
  add column if not exists content_sha256 text;

create unique index if not exists kb_documents_content_sha256_unique
  on public.kb_documents (content_sha256)
  where content_sha256 is not null;

create index if not exists kb_documents_file_name_size_idx
  on public.kb_documents (lower(file_name), byte_size);
