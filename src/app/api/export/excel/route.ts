import * as XLSX from "xlsx";
import { requireAuraUser } from "@/lib/auth";

export const runtime = "nodejs";

function markdownTable(text: string) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().startsWith("|"));
  const rows = lines.map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
  return rows.filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)));
}

export async function POST(request: Request) {
  const { response } = await requireAuraUser(["admin", "analis", "head"]); if (response) return response;
  const { title, content } = await request.json();
  if (!String(content ?? "").trim()) return Response.json({ error: "Isi dokumen kosong." }, { status: 400 });
  const workbook = XLSX.utils.book_new();
  const rows = markdownTable(String(content));
  if (rows.length > 1) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Tabel");
  const sections: string[][] = [];
  let heading = "Isi"; let body: string[] = [];
  for (const line of String(content).split(/\r?\n/)) {
    const clean = line.trim();
    if (clean.startsWith("#")) { if (body.length) sections.push([heading, body.join("\n")]); heading = clean.replace(/^#+\s*/, ""); body = []; }
    else if (!clean.startsWith("|") && !/^:?-{3,}/.test(clean)) body.push(clean);
  }
  if (body.length) sections.push([heading, body.join("\n")]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Bagian", "Isi"], ...sections]), "Draft");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Dokumen", String(title ?? "Draft AURA")], ["Dibuat", new Date().toISOString()]]), "Informasi");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=\"aura-draft.xlsx\"" } });
}
