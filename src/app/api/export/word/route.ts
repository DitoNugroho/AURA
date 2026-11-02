import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { requireAuraUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { response } = await requireAuraUser(["admin", "analis", "head"]); if (response) return response;
  const { title, content } = await request.json();
  if (!String(content ?? "").trim()) return Response.json({ error: "Isi dokumen kosong." }, { status: 400 });
  const paragraphs = String(content).split(/\r?\n/).map((line: string) => {
    const text = line.trim();
    if (!text) return new Paragraph({ text: "" });
    if (text.startsWith("### ")) return new Paragraph({ text: text.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 150, after: 80 } });
    if (text.startsWith("## ")) return new Paragraph({ text: text.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } });
    if (text.startsWith("# ")) return new Paragraph({ text: text.slice(2), heading: HeadingLevel.TITLE, spacing: { after: 180 } });
    if (/^\|?\s*:?-{3,}/.test(text)) return new Paragraph({ text: "" });
    if (text.startsWith("|")) return new Paragraph({ children: [new TextRun({ text: text.replace(/^\||\|$/g, "").replace(/\|/g, "    │    "), font: "Aptos", size: 18 })], spacing: { after: 55 } });
    if (/^[-*]\s/.test(text)) return new Paragraph({ text: text.slice(2), bullet: { level: 0 }, indent: { left: 360, hanging: 180 }, spacing: { after: 70 } });
    return new Paragraph({ children: [new TextRun({ text, font: "Aptos", size: 20 })], spacing: { after: 100 } });
  });
  const doc = new Document({ sections: [{ properties: {}, children: [new Paragraph({ text: String(title ?? "Dokumen AURA"), heading: HeadingLevel.TITLE }), ...paragraphs] }] });
  const bytes = await Packer.toBuffer(doc);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="aura-draft.docx"` } });
}
