import { NextRequest } from "next/server";
import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { user, response } = await requireAuraUser(); if (response) return response;
  const supabase = await createClient();
  let query = supabase.from("projects").select("*").order("updated_at", { ascending: false }).limit(100);
  const q = request.nextUrl.searchParams.get("q"); if (q) query = query.ilike("title", `%${q}%`);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ projects: data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin", "analis"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const body = await request.json();
  const title = String(body.title ?? "").trim();
  if (!title) return Response.json({ error: "Nama project wajib diisi." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").insert({ title, request_number: String(body.request_number ?? "").trim(), sector: String(body.sector ?? "").trim(), created_by: user.id, status: "submitted" }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await supabase.from("audit_logs").insert({ user_id: user.id, action: "project.created", target_type: "project", target_id: data.id });
  return Response.json({ project: data }, { status: 201 });
}
