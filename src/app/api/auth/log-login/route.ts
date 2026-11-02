import { requireAuraUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const { user, response } = await requireAuraUser(); if (response) return response; if (!user) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  const supabase = await createClient();
  const { error } = await supabase.from("audit_logs").insert({ user_id: user.id, action: "user.login", target_type: "profile", target_id: user.id });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
