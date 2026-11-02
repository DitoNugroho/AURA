import { NextRequest } from "next/server";
import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const allowedKinds = ["t01", "t11", "mockup", "mapping", "timeline", "uat"];

function hasAllT11MainSections(content: string) {
  const headings = [...content.matchAll(/^(?:#{1,6}\s*)?(10|[1-9])(?:\.(\d+))?\.\s+([^\n]+)$/gm)];
  const found = new Set(headings.map(match => match[1] === "10" && match[3].toLowerCase().includes("lain-lain") ? "11" : match[2] ? `${match[1]}.${match[2]}` : match[1]));
  return ["1", "1.1", "1.2", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].every(section => found.has(section));
}

export async function GET(request: NextRequest) {
  const { response } = await requireAuraUser(); if (response) return response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project tidak ditemukan." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_documents").select("*").eq("project_id", projectId).order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ documents: data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin", "analis"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const body = await request.json();
  const projectId = String(body.projectId ?? ""); const kind = String(body.kind ?? "");
  if (!projectId || !allowedKinds.includes(kind) || !String(body.content ?? "").trim()) return Response.json({ error: "Project, jenis artefak, dan isi draft wajib diisi." }, { status: 400 });
  const status = String(body.status ?? "draft");
  if (user.role === "analis" && !(kind === "t01" && status === "submitted") && !["draft", "analyst_review"].includes(status)) return Response.json({ error: "Status dokumen tidak valid untuk Analis." }, { status: 400 });
  const supabase = await createClient();
  if (kind === "mockup" || kind === "mapping") {
    const { data: t11, error: t11Error } = await supabase.from("project_documents").select("status")
      .eq("project_id", projectId).eq("kind", "t11").maybeSingle();
    if (t11Error) return Response.json({ error: t11Error.message }, { status: 400 });
    if (t11?.status !== "analyst_accepted" && t11?.status !== "approved") return Response.json({ error: "T.1.1 harus diterima Analis sebelum Mockup atau Mapping dapat disimpan." }, { status: 409 });
  }
  const { data: existing } = await supabase.from("project_documents").select("id,version,status").eq("project_id", projectId).eq("kind", kind).maybeSingle();
  const payload = { title: String(body.title ?? kind), content: String(body.content), status, updated_by: user.id, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 86400000).toISOString() };
  const result = existing
    ? await supabase.from("project_documents").update({ ...payload, version: Number(existing.version ?? 1) + 1 }).eq("id", existing.id).select().single()
    : await supabase.from("project_documents").insert({ ...payload, project_id: projectId, kind, created_by: user.id }).select().single();
  if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
  if (kind === "t11" && existing?.status === "analyst_accepted" && status !== "analyst_accepted") {
    const { error: resetError } = await supabase.from("project_documents").update({ status: "draft", updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("project_id", projectId).in("kind", ["mockup", "mapping"]).eq("status", "analyst_accepted");
    if (resetError) return Response.json({ error: `T.1.1 tersimpan, tetapi status artefak lanjutan belum dapat direset: ${resetError.message}` }, { status: 400 });
  }
  const projectStatus = status === "submitted" ? "submitted" : status === "analyst_review" || user.role === "analis" ? "analyst_review" : "draft";
  await supabase.from("projects").update({ status: projectStatus, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 86400000).toISOString() }).eq("id", projectId);
  await supabase.from("audit_logs").insert({ user_id: user.id, action: "document.saved", target_type: "project_document", target_id: result.data.id, details: { kind, status: payload.status, version: result.data.version } });
  return Response.json({ document: result.data });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireAuraUser(["admin", "analis", "head"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const { id, projectId, status } = await request.json();
  if (user.role === "head" && projectId && ["approved", "changes_requested"].includes(status)) {
    const supabase = await createClient();
    const { data: project } = await supabase.from("projects").select("id,status").eq("id", projectId).maybeSingle();
    if (!project || (status === "approved" && project.status !== "pending_approval")) return Response.json({ error: "Project belum siap untuk persetujuan akhir." }, { status: 409 });
    const { data: artefacts, error: artefactError } = await supabase.from("project_documents").select("id,kind,status").eq("project_id", projectId).in("kind", ["t11", "mockup", "mapping"]);
    if (artefactError) return Response.json({ error: artefactError.message }, { status: 400 });
    const required = new Set((artefacts ?? []).filter(item => item.status === "analyst_accepted").map(item => item.kind));
    if (status === "approved" && ["t11", "mockup"].some(kind => !required.has(kind))) return Response.json({ error: "T.1.1 dan Mockup UI/UX harus diterima Analis terlebih dahulu. Mapping Kode bersifat opsional." }, { status: 409 });
    const nextStatus = status === "approved" ? "approved" : "changes_requested";
    const { error: updateDocsError } = await supabase.from("project_documents").update({ status: nextStatus, updated_by: user.id, updated_at: new Date().toISOString() }).eq("project_id", projectId).in("kind", ["t11", "mockup", "mapping"]).eq("status", "analyst_accepted");
    if (updateDocsError) return Response.json({ error: updateDocsError.message }, { status: 400 });
    const projectStatus = status === "approved" ? "approved" : "analyst_review";
    const { error: updateProjectError } = await supabase.from("projects").update({ status: projectStatus, updated_at: new Date().toISOString() }).eq("id", projectId);
    if (updateProjectError) return Response.json({ error: updateProjectError.message }, { status: 400 });
    await supabase.from("audit_logs").insert({ user_id: user.id, action: `project.${status}`, target_type: "project", target_id: projectId });
    return Response.json({ ok: true, projectStatus });
  }
  if (!id || !["analyst_accepted", "analyst_rejected", "changes_requested"].includes(status) || !["admin", "analis"].includes(user.role)) return Response.json({ error: "Status review analis tidak valid." }, { status: 400 });
  const supabase = await createClient();
  if (status === "analyst_accepted") {
    const { data: candidate, error: candidateError } = await supabase.from("project_documents").select("kind,content").eq("id", id).maybeSingle();
    if (candidateError) return Response.json({ error: candidateError.message }, { status: 400 });
    if (candidate?.kind === "t11" && !hasAllT11MainSections(String(candidate.content ?? ""))) {
      return Response.json({ error: "T.1.1 belum lengkap. Susun semua 11 tahap utama dari template sebelum menerima hasil." }, { status: 409 });
    }
  }
  const { data, error } = await supabase.from("project_documents").update({ status, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (data.kind === "t11" && status !== "analyst_accepted") {
    const { error: resetError } = await supabase.from("project_documents").update({ status: "draft", updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("project_id", data.project_id).in("kind", ["mockup", "mapping"]).eq("status", "analyst_accepted");
    if (resetError) return Response.json({ error: `Status T.1.1 berubah, tetapi status artefak lanjutan belum dapat direset: ${resetError.message}` }, { status: 400 });
  }
  const { data: artefacts } = await supabase.from("project_documents").select("kind,status").eq("project_id", data.project_id).in("kind", ["t11", "mockup", "mapping"]);
  const requiredKinds = ["t11", "mockup"];
  const accepted = new Set((artefacts ?? []).filter(item => item.status === "analyst_accepted").map(item => item.kind));
  const anyRejected = (artefacts ?? []).some(item => requiredKinds.includes(item.kind) && item.status === "analyst_rejected");
  const anyChanges = (artefacts ?? []).some(item => requiredKinds.includes(item.kind) && item.status === "changes_requested");
  const projectStatus = anyRejected ? "rejected" : anyChanges ? "changes_requested" : requiredKinds.every(kind => accepted.has(kind)) ? "pending_approval" : "analyst_review";
  await supabase.from("projects").update({ status: projectStatus, updated_at: new Date().toISOString() }).eq("id", data.project_id);
  await supabase.from("audit_logs").insert({ user_id: user.id, action: `document.${status}`, target_type: "project_document", target_id: id });
  return Response.json({ document: data, projectStatus });
}
