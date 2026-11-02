import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin", "analis"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const body = await request.json();
  const projectId = String(body.projectId ?? "");
  const storagePath = String(body.storagePath ?? "");
  const fileName = String(body.fileName ?? "");
  if (!projectId || !fileName || !storagePath.startsWith(`${user.id}/${projectId}/`)) return Response.json({ error: "File request atau project tidak valid." }, { status: 400 });
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase.from("projects").select("id").eq("id", projectId).single();
  if (projectError || !project) return Response.json({ error: "Project tidak ditemukan atau akses tidak tersedia." }, { status: 404 });
  const { data, error } = await supabase.from("kb_documents").insert({ project_id: projectId, title: fileName.replace(/\.[^.]+$/, ""), file_name: fileName, storage_path: storagePath, category: "Naskah Dinas", source_status: "disetujui", processing_status: "queued", byte_size: Number(body.byteSize ?? 0), uploaded_by: user.id, expires_at: new Date(Date.now() + 90 * 86400000).toISOString() }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ document: data }, { status: 201 });
}
