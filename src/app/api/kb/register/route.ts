import { requireAuraUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";

const categories = ["T.0.1 Rencana", "T.1.1 User Requirement", "Timeline", "User Manual", "Naskah Dinas", "Lainnya"];

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const body = await request.json();
  if (!categories.includes(body.category) || !String(body.fileName ?? "").trim() || !String(body.storagePath ?? "").startsWith(`${user.id}/`)) return Response.json({ error: "Metadata atau lokasi file tidak valid." }, { status: 400 });
  const supabase = createAdminClient();
  const fileName = String(body.fileName).trim();
  const storagePath = String(body.storagePath);
  const { data: file, error: downloadError } = await supabase.storage.from("aura-kb").download(storagePath);
  if (downloadError || !file) return Response.json({ error: "File yang diunggah tidak dapat diverifikasi." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: existing, error: lookupError } = await supabase.from("kb_documents").select("id,file_name,storage_path,byte_size,content_sha256").limit(5000);
  if (lookupError) {
    await supabase.storage.from("aura-kb").remove([storagePath]);
    return Response.json({ error: "Pemeriksaan duplikasi gagal. Coba lagi." }, { status: 500 });
  }
  const normalizedName = fileName.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  const sameSizeWithoutHash = (existing ?? []).filter(item => !item.content_sha256 && Number(item.byte_size) === bytes.byteLength);
  const legacyMatches = await Promise.all(sameSizeWithoutHash.map(async item => {
    const { data: oldFile } = await supabase.storage.from("aura-kb").download(item.storage_path);
    if (!oldFile) return false;
    const oldBytes = Buffer.from(await oldFile.arrayBuffer());
    const oldHash = createHash("sha256").update(oldBytes).digest("hex");
    if (oldHash !== contentSha256) return false;
    await supabase.from("kb_documents").update({ content_sha256: oldHash }).eq("id", item.id);
    return true;
  }));
  const duplicate = (existing ?? []).find(item => item.content_sha256 === contentSha256) ?? (legacyMatches.includes(true) ? sameSizeWithoutHash.find((_, index) => legacyMatches[index]) : undefined);
  if (duplicate) {
    await supabase.storage.from("aura-kb").remove([storagePath]);
    return Response.json({ error: `Dokumen ini duplikat: isi file sama dengan “${duplicate.file_name}”.` }, { status: 409 });
  }
  const possibleMatches = (existing ?? []).filter(item => {
    const existingName = item.file_name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
    const existingStem = existingName.replace(/\.[^.]+$/, "");
    const incomingStem = normalizedName.replace(/\.[^.]+$/, "");
    const sameSize = Number(body.byteSize) > 0 && Number(item.byte_size) === Number(body.byteSize);
    return existingName === normalizedName || (sameSize && existingStem === incomingStem);
  });
  if (possibleMatches.length && body.allowPossibleDuplicate !== true) {
    return Response.json({
      duplicateCandidate: true,
      candidates: possibleMatches.slice(0, 5).map(item => `${item.file_name} (${item.byte_size} byte)`),
      error: "Ada dokumen dengan nama yang sama, atau nama dasar dan ukuran yang cocok. Pastikan ini bukan salinan atau versi yang sudah ada.",
    }, { status: 409 });
  }
  const { data, error } = await supabase.from("kb_documents").insert({ title: String(body.title ?? fileName), file_name: fileName, storage_path: storagePath, category: body.category, byte_size: bytes.byteLength, content_sha256: contentSha256, uploaded_by: user.id }).select().single();
  if (error?.code === "23505") {
    await supabase.storage.from("aura-kb").remove([storagePath]);
    return Response.json({ error: "Dokumen dengan isi yang sama sudah terdaftar di knowledge base." }, { status: 409 });
  }
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ document: data }, { status: 201 });
}
