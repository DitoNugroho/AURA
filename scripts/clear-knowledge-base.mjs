import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { loadEnvConfig } = nextEnv;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(projectRoot);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Isi NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SECRET_KEY di .env.local terlebih dahulu.");
  process.exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pageSize = 1000;
const batchSize = 500;
const confirm = process.argv.includes("--confirm");

async function getGlobalDocuments() {
  const documents = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("kb_documents")
      .select("id, title, storage_path")
      .is("project_id", null)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    documents.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return documents;
}

try {
  const documents = await getGlobalDocuments();
  if (!documents.length) {
    console.log("Tidak ada dokumen Knowledge Base global untuk dihapus.");
    process.exit(0);
  }

  console.log(`Ditemukan ${documents.length} dokumen Knowledge Base global.`);
  console.log("Lampiran yang terhubung ke project tidak akan dihapus.");
  if (!confirm) {
    console.log("Mode pratinjau saja. Untuk menghapus file dan indeks secara permanen, jalankan ulang dengan --confirm.");
    process.exit(0);
  }

  const paths = documents.map(document => document.storage_path);
  for (let i = 0; i < paths.length; i += batchSize) {
    const { error } = await supabase.storage.from("aura-kb").remove(paths.slice(i, i + batchSize));
    if (error) throw new Error(`Gagal menghapus file Storage batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
  }

  const ids = documents.map(document => document.id);
  for (let i = 0; i < ids.length; i += batchSize) {
    const { error } = await supabase.from("kb_documents").delete().in("id", ids.slice(i, i + batchSize));
    if (error) throw new Error(`File Storage sudah dihapus, tetapi metadata batch ${Math.floor(i / batchSize) + 1} gagal dihapus: ${error.message}`);
  }

  console.log(`Selesai: ${documents.length} dokumen, file Storage, dan potongan indeksnya dihapus.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Penghapusan gagal.");
  process.exit(1);
}
