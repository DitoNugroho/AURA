import { redirect } from "next/navigation";
import { getAuraUser } from "@/lib/auth";
import AuraWorkspace from "@/components/aura-workspace";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuraUser();
  if (!user) redirect("/login");
  return <AuraWorkspace user={user} />;
}
