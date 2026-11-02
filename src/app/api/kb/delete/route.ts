import { requireAuraUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin"]);
  if (response) return response;
  if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });

  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "ID dokumen tidak valid." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: document, error: findError } = await supabase
    .from("kb_documents")
    .select("id,file_name,storage_path")
    .eq("id", id)
    .single();
  if (findError || !document) return Response.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });

  // The document foreign keys cascade, so both cloud and local search chunks are removed here.
  const { error: deleteError } = await supabase.from("kb_documents").delete().eq("id", id);
  if (deleteError) return Response.json({ error: "Dokumen gagal dihapus dari indeks." }, { status: 500 });

  const { error: storageError } = await supabase.storage.from("aura-kb").remove([document.storage_path]);
  return Response.json({
    ok: true,
    fileName: document.file_name,
    warning: storageError ? "Data indeks sudah dihapus, tetapi file di storage belum berhasil dihapus." : undefined,
  });
}
