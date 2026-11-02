import { requireAuraUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { response } = await requireAuraUser(["admin"]); if (response) return response;
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").select("id,email,display_name,role,active,created_at").order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ users: data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requireAuraUser(["admin"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "");
  if (!email || !name || password.length < 12 || !["analis", "head"].includes(role)) return Response.json({ error: "Nama, email, role, dan password minimal 12 karakter wajib diisi." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    if (error || !data.user) return Response.json({ error: error?.message ?? "Akun tidak dapat dibuat." }, { status: 400 });
    const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, email, display_name: name, role, active: true });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
    }
    await admin.from("audit_logs").insert({ user_id: user.id, action: "user.created", target_type: "profile", target_id: data.user.id, details: { role } });
    return Response.json({ user: { id: data.user.id, email, name, role } }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Akun tidak dapat dibuat." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { user, response } = await requireAuraUser(["admin"]); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const { id, active, role } = await request.json();
  if (!id || (active === undefined && !["admin", "analis", "head"].includes(role))) return Response.json({ error: "Perubahan pengguna tidak valid." }, { status: 400 });
  if (id === user.id && active === false) return Response.json({ error: "Admin tidak dapat menonaktifkan akunnya sendiri." }, { status: 400 });
  if (id === user.id && role && role !== "admin") return Response.json({ error: "Admin tidak dapat menghapus peran admin miliknya sendiri." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (active !== undefined) patch.active = Boolean(active);
  if (role) patch.role = role;
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").update(patch).eq("id", id).select("id,email,display_name,role,active,created_at").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await admin.from("audit_logs").insert({ user_id: user.id, action: "user.updated", target_type: "profile", target_id: id, details: patch });
  return Response.json({ user: data });
}
