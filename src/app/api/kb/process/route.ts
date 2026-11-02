import { requireAuraUser } from "@/lib/auth";
import { embedTexts, embeddingModel, embeddingProvider, splitIntoChunks } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 300;

async function extractText(fileName: string, bytes: Buffer) {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const pdfModule = await import("pdf-parse");
    const parse = (pdfModule as unknown as { default: (data: Buffer) => Promise<{ text: string }> }).default;
    return (await parse(bytes)).text;
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  if (ext === "xlsx") {
    const workbook = XLSX.read(bytes, {
      type: "buffer",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetStubs: false,
    });
    const extractedSheets: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;

      // Excel files can declare a huge used range because of leftover formatting.
      // Bound the exported CSV to actual non-empty cells instead of trusting !ref.
      const populated: XLSX.CellAddress[] = [];
      for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) continue;
        const cell = sheet[address] as XLSX.CellObject | undefined;
        if (cell && (cell.v !== undefined && cell.v !== null && cell.v !== "" || cell.f)) {
          populated.push(XLSX.utils.decode_cell(address));
        }
      }
      if (!populated.length) continue;

      const range = populated.reduce<XLSX.Range>((bounds, cell) => ({
        s: { r: Math.min(bounds.s.r, cell.r), c: Math.min(bounds.s.c, cell.c) },
        e: { r: Math.max(bounds.e.r, cell.r), c: Math.max(bounds.e.c, cell.c) },
      }), { s: { r: Number.MAX_SAFE_INTEGER, c: Number.MAX_SAFE_INTEGER }, e: { r: 0, c: 0 } });
      const rowCount = range.e.r - range.s.r + 1;
      const columnCount = range.e.c - range.s.c + 1;
      if (rowCount > 100_000 || columnCount > 500 || rowCount * columnCount > 2_000_000) {
        throw new Error(`Sheet “${name}” terlalu besar untuk diproses (${rowCount} baris × ${columnCount} kolom). Hapus format/baris kosong berlebih atau pecah file Excel.`);
      }
      const boundedSheet = { ...sheet, "!ref": XLSX.utils.encode_range(range) } as XLSX.WorkSheet;
      extractedSheets.push(`SHEET: ${name}\n${XLSX.utils.sheet_to_csv(boundedSheet, { blankrows: false })}`);
    }
    return extractedSheets.join("\n\n");
  }
  throw new Error("Format dokumen belum didukung. Gunakan PDF, DOCX, atau XLSX.");
}

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin", "analis"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  if (embeddingProvider === "openai" && !process.env.OPENAI_API_KEY) return Response.json({ error: "OPENAI_API_KEY belum disiapkan untuk embedding cloud." }, { status: 503 });
  const { documentId } = await request.json();
  const userSupabase = await createClient();
  const { data: document, error: loadError } = await userSupabase.from("kb_documents").select("*").eq("id", documentId).single();
  if (loadError || !document) return Response.json({ error: "Metadata dokumen tidak ditemukan." }, { status: 404 });
  if (user.role === "analis" && (document.category !== "Naskah Dinas" || document.uploaded_by !== user.id)) return Response.json({ error: "Dokumen tidak dapat diindeks oleh akun ini." }, { status: 403 });
  const supabase = createAdminClient();
  try {
    const { error: startError } = await supabase.from("kb_documents").update({ processing_status: "processing", processing_message: "Mengunduh dan mengekstrak dokumen." }).eq("id", documentId);
    if (startError) throw startError;
    const { data: blob, error: downloadError } = await supabase.storage.from("aura-kb").download(document.storage_path);
    if (downloadError || !blob) throw downloadError ?? new Error("File sumber tidak ditemukan.");
    const fileBytes = Buffer.from(await blob.arrayBuffer());
    const contentSha256 = createHash("sha256").update(fileBytes).digest("hex");
    const text = await extractText(document.file_name, fileBytes);
    if (text.trim().length < 100) throw new Error("Teks sangat sedikit atau PDF berupa pindai. Siapkan versi OCR agar dapat dicari.");
    const chunks = splitIntoChunks(text);
    // BGE-M3 runs on the developer's laptop; keep its batches small to avoid
    // CPU/memory spikes on machines with limited resources.
    const batchSize = embeddingProvider === "ollama" ? 2 : 24;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const { error: progressError } = await supabase.from("kb_documents").update({ processing_message: `Membuat embedding dengan ${embeddingModel}: batch ${batchNumber}/${totalBatches} (${chunks.length} bagian).` }).eq("id", documentId);
      if (progressError) throw progressError;
      console.info(`[kb/process] ${document.file_name}: embedding batch ${batchNumber}/${totalBatches} (${batch.length} chunks, ${embeddingModel})`);
      const vectors = await embedTexts(batch);
      const rows = batch.map((content, offset) => ({ document_id: documentId, chunk_index: i + offset, content, metadata: { file_name: document.file_name, category: document.category, source_status: document.source_status, embedding_model: embeddingModel }, embedding: `[${vectors[offset].join(",")}]` }));
      const table = embeddingProvider === "ollama" ? "kb_chunks_local" : "kb_chunks";
      const { error: insertError } = await supabase.from(table).upsert(rows, { onConflict: "document_id,chunk_index" });
      if (insertError) throw insertError;
    }
    const table = embeddingProvider === "ollama" ? "kb_chunks_local" : "kb_chunks";
    await supabase.from(table).delete().eq("document_id", documentId).gte("chunk_index", chunks.length);
    const { error: readyError } = await supabase.from("kb_documents").update({ content_sha256: contentSha256, processing_status: "ready", processing_message: `${chunks.length} bagian berhasil diindeks.` }).eq("id", documentId);
    if (readyError?.code === "23505") {
      await supabase.from("kb_documents").update({ processing_status: "ready", processing_message: `${chunks.length} bagian berhasil diindeks. Isi file sama dengan dokumen lain yang sudah ada.` }).eq("id", documentId);
    } else if (readyError) {
      throw readyError;
    }
    return Response.json({ ok: true, chunks: chunks.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Indeksasi gagal.";
    console.error("[kb/process] Indeksasi gagal untuk %s (%s)", document.file_name, documentId, e);
    await supabase.from("kb_documents").update({ processing_status: "failed", processing_message: message.slice(0, 500) }).eq("id", documentId);
    return Response.json({ error: message }, { status: 500 });
  }
}
