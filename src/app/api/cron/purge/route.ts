import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: expiredFiles, error: fileListError } = await admin.from("kb_documents").select("id,storage_path").not("project_id", "is", null).lt("expires_at", new Date().toISOString()).limit(500);
  if (fileListError) return Response.json({ error: fileListError.message }, { status: 500 });
  const paths = (expiredFiles ?? []).map(file => file.storage_path);
  if (paths.length) {
    const { error: storageError } = await admin.storage.from("aura-kb").remove(paths);
    if (storageError) return Response.json({ error: storageError.message }, { status: 500 });
    const { error: metadataError } = await admin.from("kb_documents").delete().in("id", (expiredFiles ?? []).map(file => file.id));
    if (metadataError) return Response.json({ error: metadataError.message }, { status: 500 });
  }
  const { data, error } = await admin.rpc("purge_expired_aura_data");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, removedProjectRequestFiles: paths.length, removedPromptLogs: data ?? 0 });
}
