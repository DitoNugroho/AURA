LKW1UlewYc8eMmRA

# AURA — AI User Requirement

AURA is a separate Next.js application for the ADSI workflow: project proposals, T.1.1 requirements, UI/UX draft previews, data mapping, timelines, UAT scenarios, and maker/reviewer collaboration.

## Current implementation

- Indonesian workspace with project list and artifact editor.
- Email/password login through Supabase Auth.
- Roles: `admin`, `analis`, and `head`.
- Admin-managed accounts, knowledge-base uploads, and approval of source documents.
- Private Supabase Storage for PDF, DOCX, and XLSX files.
- Server-side text extraction, chunking, embeddings, and semantic retrieval.
- DataByte generates drafts. Local development uses Ollama with BGE-M3 embeddings; the Vercel deployment continues using the cloud embedding index. Both search only approved internal sources.
- Review comments, document status, version number, audit/prompt logging, and 90-day draft/log cleanup.
- Word and Excel exports.
- `/preview` is a public, synthetic-data preview. It does not call AI, save files, or contain any supplied knowledge-base documents.

## Requirements

- Node.js 20 or newer.
- A Supabase project with PostgreSQL, Supabase Auth, and Storage.
- Ollama installed locally for laptop-based BGE-M3 embeddings.
- The BGE-M3 model pulled into Ollama (`ollama pull bge-m3`).
- A DataByte API key for draft generation.
- A Vercel project connected to this application directory.

## Configure Supabase

1. Create a Supabase project under the account approved for the intended internal data.
2. Run migrations `0001` through `0004` in order. For an existing database that already ran `0003`, run `supabase/migrations/0004_local_ollama_embeddings.sql`. This adds a separate 1024-dimensional local index and preserves the cloud index.
3. Disable public sign-ups in Supabase Auth. Create the first user in Supabase Authentication. Then add that user as the initial AURA admin using the SQL editor:

   ```sql
   insert into public.profiles (id, email, display_name, role, active)
   select id, email, 'Administrator AURA', 'admin', true
   from auth.users
   where email = 'admin@example.org'
   on conflict (id) do update set role = 'admin', active = true;
   ```

4. Copy the project URL and the publishable and secret API keys from Supabase Settings → API Keys. The publishable key is for the browser; the secret key must remain server-only.
5. Configure DataByte with `DATABYTE_BASE_URL`, `DATABYTE_API_KEY`, and `DATABYTE_MODEL` for draft generation. The default model is `MiniMax-M3`; use a model ID available to your DataByte account.

## Configure local development

Copy `.env.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBEDDING_MODEL=bge-m3
DATABYTE_BASE_URL=https://ai.databyte.co.id/v1
DATABYTE_API_KEY=YOUR_DATABYTE_API_KEY
DATABYTE_MODEL=MiniMax-M3
DATABYTE_MAX_TOKENS=8192
CRON_SECRET=YOUR_LONG_RANDOM_SECRET
```

Start Ollama, download BGE-M3 once, then run AURA locally:

```bash
ollama pull bge-m3
npm install
npm run dev
```

Open `http://localhost:3000`. `/preview` is available without configuration and uses synthetic examples only.

## Deploy to Vercel

1. Import the Git repository into Vercel.
2. Because this is a separate app folder, either create a Git repository from this `aura-web` folder and use `.` as Vercel's **Root Directory**, or place this folder inside a repository and point Vercel to its path.
3. For Vercel, set `EMBEDDING_PROVIDER=openai` and configure `OPENAI_API_KEY`; Ollama on your laptop is reachable only by the local AURA process. Keep `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, and `DATABYTE_API_KEY` server-only; never prefix them with `NEXT_PUBLIC_`.
4. Deploy and open `/login`.
5. Add the same `CRON_SECRET` value in Vercel so the daily purge job can call `/api/cron/purge`.

Vercel Functions reject request and response bodies larger than 4.5 MB. AURA sends file bytes directly from the browser to the private Supabase Storage bucket, then sends only document metadata to the function. The bucket currently caps a single file at 50 MB; the 225 MB knowledge base can be uploaded as multiple files.

## Knowledge-base workflow

1. An admin uploads PDF, DOCX, or XLSX files under **Knowledge base**.
2. AURA extracts text, splits it into searchable chunks, creates embeddings, and records the index state.
   To populate the laptop-only BGE-M3 index, an admin must use **Indeks ulang** on each knowledge-base document while AURA and Ollama are running locally. This does not replace the separate cloud index.
3. The admin reviews source status and marks only approved, current sources as **disetujui**. AI retrieval only searches those approved sources.
4. The analyst creates a project, enters context from the official request, and asks AURA to draft an artifact.
5. AURA displays the source document titles used. The analyst edits and saves the draft, then sends it to the head for review.

Scanned PDFs with little or no extractable text need OCR before indexing. Text extraction does not currently index screenshots embedded in Word or PDF files. Upload and indexing are per file; a durable queue for bulk re-indexing and OCR is a later production enhancement.

## Data and access notes

- Supabase Row Level Security protects application tables and the private file bucket. Apply the SQL migration before creating or inviting users.
- Passwords are managed by Supabase Auth, which stores password verifiers rather than reversible passwords.
- AURA sets a 90-day expiry on projects, drafts, comments, prompt logs, and audit logs; Vercel Cron runs the purge function daily. Project-specific request files are also removed from private storage after 90 days. Global knowledge-base source documents are retained until an admin replaces or deletes them.
- Local BGE-M3 inference runs on the laptop. The document files and generated vectors remain stored in the configured Supabase project.
- This starter does not automatically copy `C:\Paper\KB\` into cloud storage. An authorized AURA admin must upload the source documents after hosting and data-processing approvals are complete.

## References

- [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart)
- [Ollama embeddings](https://docs.ollama.com/capabilities/embeddings)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel Cron jobs](https://vercel.com/docs/cron-jobs)
