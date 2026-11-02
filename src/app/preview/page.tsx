import AuraWorkspace from "@/components/aura-workspace";

export default function PreviewPage() {
  return <AuraWorkspace demoMode user={{ id: "preview", email: "preview@aura.local", name: "Pratinjau AURA", role: "admin" }} />;
}
