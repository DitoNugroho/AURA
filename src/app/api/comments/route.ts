import { NextRequest } from "next/server";
import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { response } = await requireAuraUser(); if (response) return response;
  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!documentId) return Response.json({ error: "Dokumen tidak ditemukan." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_comments").select("id,message,created_at,profiles(display_name)").eq("document_id", documentId).order("created_at", { ascending: false }).limit(50);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ comments: data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin", "analis", "head"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const { documentId, message } = await request.json();
  const clean = String(message ?? "").trim();
  if (!documentId || !clean || clean.length > 4000) return Response.json({ error: "Komentar kosong atau terlalu panjang." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_comments").insert({ document_id: documentId, author_id: user.id, message: clean }).select("id,message,created_at,profiles(display_name)").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ comment: data }, { status: 201 });
}
