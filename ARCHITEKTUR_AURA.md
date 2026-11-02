# Arsitektur Umum AURA

Diagram ini menunjukkan dua cara menjalankan aplikasi dengan Supabase yang sama: lokal di laptop dan deployment cloud di Vercel. **Ollama/BGE-M3 hanya dapat dipanggil oleh AURA yang berjalan di laptop tersebut.** Vercel tidak dapat mengakses `localhost` laptop.

```mermaid
flowchart LR
  User[Pengguna AURA]

  subgraph Laptop[Mode lokal — laptop]
    NPM[npm\ninstall dependency dan menjalankan script]
    LocalAURA[AURA Next.js\nUI dan API routes]
    Ollama[Ollama lokal\nHTTP localhost:11434]
    BGE[BGE-M3 BAAI\nembedding multilingual\n1024 dimensi]
    NPM -. package.json / npm run dev .-> LocalAURA
    User <-->|browser / localhost:3000| LocalAURA
    LocalAURA -->|teks dokumen atau pertanyaan| Ollama
    Ollama --> BGE
    BGE -->|vektor embedding| LocalAURA
  end

  subgraph Cloud[Vercel — deployment online]
    VercelAURA[AURA Next.js\nVercel Functions]
    CloudEmbed[Embedding cloud\nEMBEDDING_PROVIDER=openai]
    VercelAURA --> CloudEmbed
    UserCloud[Pengguna online] <-->|HTTPS| VercelAURA
  end

  subgraph Supabase[Supabase]
    Auth[Supabase Auth\nlogin dan sesi]
    DB[(PostgreSQL + pgvector\nproject, dokumen, indeks)]
    Storage[(Private Storage\nPDF, DOCX, XLSX)]
  end

  subgraph DataByte[DataByte AI]
    Gateway[DataByte API Gateway]
    MiniMax[MiniMax-M3.1-Flash\ngenerasi draft]
    Gateway --> MiniMax
  end

  LocalAURA <-->|publishable key dan sesi| Auth
  LocalAURA <-->|server API: secret key| DB
  LocalAURA <-->|unggah / unduh file| Storage
  LocalAURA -->|prompt + sumber terpilih| Gateway
  MiniMax -->|draft| LocalAURA
  VercelAURA <-->|publishable key dan sesi| Auth
  VercelAURA <-->|server API: secret key| DB
  VercelAURA <-->|unggah / unduh file| Storage
  VercelAURA -->|prompt + sumber terpilih| Gateway
  MiniMax -->|draft| VercelAURA
  BGE -. indeks lokal .-> DB
  CloudEmbed -. indeks cloud terpisah .-> DB
```

## Alur pencarian dan pembuatan draft

1. AURA mengambil file knowledge base dari Supabase Storage, mengekstrak teks, lalu membaginya menjadi potongan.
2. Saat AURA berjalan lokal, Ollama menjalankan BGE-M3 di laptop. Vektornya disimpan di tabel `kb_chunks_local` dan dicari melalui RPC `match_aura_chunks_local`.
3. Saat AURA berjalan di Vercel, server cloud menggunakan provider embedding cloud dan indeks `kb_chunks`. Vercel tidak mengirim permintaan ke Ollama di laptop.
4. AURA mengambil sumber yang relevan dari PostgreSQL, lalu mengirim konteks dan instruksi ke DataByte. DataByte menjalankan `MiniMax-M3.1-Flash` dan mengembalikan draft ke AURA.
5. AURA menampilkan draft dan sumbernya kepada pengguna. Login, metadata project, dokumen, dan file tetap dikelola lewat Supabase.

## Peran tiap komponen

| Komponen | Peran |
|---|---|
| **npm** | Memasang dependency dari `package.json` dan menjalankan script proyek. npm bukan server aplikasi atau model AI. |
| **AURA / Next.js** | Menyediakan UI, API routes, ekstraksi teks, indexing, pencarian, dan orkestrasi permintaan AI. |
| **Ollama** | Menyajikan model embedding lokal melalui HTTP pada laptop. |
| **BGE-M3 (BAAI)** | Mengubah teks dokumen dan pertanyaan menjadi vektor untuk pencarian semantik lokal. Kedua jenis teks harus memakai model yang sama. |
| **Supabase** | Menyediakan autentikasi, PostgreSQL/pgvector, metadata aplikasi, dan private storage. Indeks lokal dan cloud disimpan di tabel terpisah. |
| **DataByte** | Menyediakan endpoint model generasi teks. Model yang dikonfigurasi untuk AURA adalah `MiniMax-M3.1-Flash`. |
| **Vercel** | Menjalankan versi online AURA. Server Vercel tidak dapat mengakses proses Ollama di laptop pengguna. |

## Batas keamanan

- `SUPABASE_SECRET_KEY`, `DATABYTE_API_KEY`, dan `OPENAI_API_KEY` (bila dipakai untuk embedding cloud) hanya berada di environment server.
- Browser memakai Supabase publishable key dan sesi Auth; jangan menaruh secret key di variabel `NEXT_PUBLIC_*`.
- Permintaan generasi draft mengirim prompt dan potongan sumber terpilih ke DataByte untuk diproses oleh MiniMax.
- Model BGE-M3 berjalan lokal, tetapi file sumber dan vektor indeks AURA tetap disimpan di Supabase.
