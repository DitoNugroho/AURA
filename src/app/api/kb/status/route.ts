import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const { user, response } = await requireAuraUser(["admin"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const { id, sourceStatus } = await request.json();
  if (!id || !["disetujui", "draft", "digantikan", "perlu_verifikasi"].includes(sourceStatus)) return Response.json({ error: "Status dokumen tidak valid." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("kb_documents").update({ source_status: sourceStatus }).eq("id", id).select("id,title,file_name,category,source_status,processing_status,created_at").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await supabase.from("audit_logs").insert({ user_id: user.id, action: "kb.status_changed", target_type: "kb_document", target_id: id, details: { source_status: sourceStatus } });
  return Response.json({ document: data });
}
