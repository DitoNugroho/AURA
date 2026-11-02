import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const { response } = await requireAuraUser(); if (response) return response;
  const supabase = await createClient();
  const { data, error } = await supabase.from("kb_documents").select("id,title,file_name,category,source_status,processing_status,created_at").order("created_at", { ascending: false }).limit(250);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ documents: data ?? [] });
}
