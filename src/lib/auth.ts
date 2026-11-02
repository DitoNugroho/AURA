import { createClient } from "@/lib/supabase/server";

export type AuraRole = "admin" | "analis" | "head";
export type AuraUser = { id: string; email: string; name: string; role: AuraRole };

export async function getAuraUser(): Promise<AuraUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("display_name, role, active").eq("id", user.id).single();
  if (!profile || !profile.active) return null;
  return {
    id: user.id,
    email: user.email ?? "",
    name: profile.display_name || user.email || "Pengguna AURA",
    role: profile.role as AuraRole,
  };
}

export async function requireAuraUser(roles?: AuraRole[]) {
  const user = await getAuraUser();
  if (!user) return { user: null, response: Response.json({ error: "Sesi tidak valid." }, { status: 401 }) };
  if (roles && !roles.includes(user.role)) return { user: null, response: Response.json({ error: "Akses tidak diizinkan." }, { status: 403 }) };
  return { user, response: null };
}
