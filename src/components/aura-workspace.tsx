"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AuraRole, AuraUser } from "@/lib/auth";

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const EMBEDDING_PROVIDER_LABEL = process.env.NEXT_PUBLIC_EMBEDDING_PROVIDER === "openai"
  ? `OpenAI (${process.env.NEXT_PUBLIC_EMBEDDING_MODEL || "text-embedding-3-small"})`
  : `Ollama (${process.env.NEXT_PUBLIC_EMBEDDING_MODEL || "bge-m3"})`;

type View = "home" | "projects" | "knowledge" | "admin";
type Kind = "t01" | "t11" | "mockup" | "mapping" | "timeline" | "uat";
type Project = { id: string; title: string; request_number?: string; sector?: string; status: string; created_at?: string };
type KBDoc = { id: string; title: string; category: string; source_status: string; processing_status: string; file_name: string; created_at: string };
type ProjectDocument = { id: string; kind: Kind; title: string; content: string; status: string; version: number };
type MockupSpec = { title: string; purpose: string; navigation: string[]; actions: string[]; filters: string[]; metrics: { label: string; value: string; detail: string }[]; columns: string[]; rows: string[][]; note: string };
type Comment = { id: string; message: string; created_at: string; profiles?: { display_name: string } };
type TeamUser = { id: string; email: string; display_name: string; role: AuraRole; active: boolean; created_at: string };
const t11Stages = [
  { id: "1", label: "1. Tinjauan Sistem yang Ada (1.1 dan 1.2)" },
  { id: "2", label: "2. Tujuan Pembuatan Sistem Baru" },
  { id: "3", label: "3. Definisi Lingkup Pekerjaan (3.1–3.3)" },
  { id: "4", label: "4. Ketersediaan Sistem (4.1–4.2)" },
  { id: "5", label: "5. Kebutuhan Pengendalian Pengamanan (5.1–5.4)" },
  { id: "6", label: "6. Rencana Pengelolaan" },
  { id: "7", label: "7. Permintaan Khusus (7.1–7.2)" },
  { id: "8", label: "8. Kebutuhan Pemulihan SI / BCP" },
  { id: "9", label: "9. Dampak dari Permintaan" },
  { id: "10", label: "10. Manajemen Risiko" },
  { id: "11", label: "10. Lain-Lain" },
];

function mergeT11Section(current: string, generated: string, sectionId: string) {
  const placeholder = /\n\nDraft T\.1\.1 belum dibuat\.[\s\S]*$/;
  const base = current.replace(placeholder, "").trimEnd();
  const headingPattern = /^(?:#{1,6}\s*)?(10|[1-9])\.\s+([^\n]+)$/gm;
  const sections: { id: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(base))) {
    const title = match[2].toLowerCase();
    const id = match[1] === "10" && title.includes("lain-lain") ? "11" : match[1];
    sections.push({ id, start: match.index, end: base.length });
  }
  sections.forEach((section, index) => { section.end = sections[index + 1]?.start ?? base.length; });
  const target = sections.find(section => section.id === sectionId);
  if (target) return `${base.slice(0, target.start).trimEnd()}\n\n${generated.trim()}\n\n${base.slice(target.end).trimStart()}`.trim();
  const rank = (id: string) => id === "11" ? 10.5 : Number(id);
  const next = sections.find(section => rank(section.id) > rank(sectionId));
  if (next) return `${base.slice(0, next.start).trimEnd()}\n\n${generated.trim()}\n\n${base.slice(next.start).trimStart()}`.trim();
  return `${base}\n\n${generated.trim()}`.trim();
}

function hasT11Stage(content: string, sectionId: string) {
  const headings = [...content.matchAll(/^(?:#{1,6}\s*)?(10|[1-9])\.\s+([^\n]+)$/gm)];
  return headings.some(match => {
    const isOther = match[1] === "10" && match[2].toLowerCase().includes("lain-lain");
    return sectionId === "11" ? isOther : !isOther && match[1] === sectionId;
  });
}

const kinds: { id: Kind; label: string; short: string; description: string }[] = [
  { id: "t01", label: "Usulan PKSI", short: "T.0.1", description: "Usulan yang diserahkan Satuan Kerja dan diunggah Analis." },
  { id: "t11", label: "Spesifikasi Kebutuhan (User Requirement)", short: "T.1.1", description: "Rincian kebutuhan fungsional, operasional, keamanan, dan risiko." },
  { id: "mockup", label: "Mockup UI/UX", short: "UI/UX", description: "Rancangan awal layar dan alur interaksi pengguna." },
  { id: "mapping", label: "Mapping Kode Pelaporan (opsional)", short: "KODE", description: "Pemetaan kode pelaporan, sumber, field, dan aturan validasi bila diperlukan." },
  { id: "timeline", label: "Timeline", short: "JADWAL", description: "Tahapan, target waktu, dan PIC pelaksanaan." },
  { id: "uat", label: "Skenario UAT", short: "UAT", description: "Skenario, langkah pengujian, dan hasil yang diharapkan." },
];

const demoProjects: Project[] = [
  { id: "demo-1", title: "Enhancement Modul Analisis Laporan Berkala", request_number: "PKSI-2026-014", sector: "Asuransi dan Reasuransi", status: "review", created_at: "2026-10-25T08:00:00Z" },
  { id: "demo-2", title: "Pengembangan Modul Monitoring Kepatuhan", request_number: "PKSI-2026-011", sector: "Dana Pensiun", status: "draft", created_at: "2026-10-21T08:00:00Z" },
  { id: "demo-3", title: "Pembaruan sumber data dan integrasi sistem", request_number: "PKSI-2026-008", sector: "Penjaminan", status: "approved", created_at: "2026-10-17T08:00:00Z" },
];

const roleLabels: Record<AuraRole, string> = { admin: "ADMIN", analis: "ANALIS · REVIEWER", head: "APPROVER · FINAL CHECKER" };

function readMockupSpec(content: string): MockupSpec | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (typeof value.title !== "string" || !Array.isArray(value.navigation) || !Array.isArray(value.metrics) || !Array.isArray(value.columns)) return null;
    const text = (item: unknown, fallback = "—") => typeof item === "string" ? item.slice(0, 300) : fallback;
    const list = (items: unknown, max: number) => Array.isArray(items) ? items.slice(0, max).map(item => text(item, "")).filter(Boolean) : [];
    const columns = list(value.columns, 6);
    return {
      title: text(value.title), purpose: text(value.purpose, "Rancangan awal untuk ditinjau Analis."),
      navigation: list(value.navigation, 6), actions: list(value.actions, 4), filters: list(value.filters, 4),
      metrics: value.metrics.slice(0, 4).map(item => {
        const metric = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return { label: text(metric.label, "Ringkasan"), value: text(metric.value), detail: text(metric.detail, "Perlu konfirmasi") };
      }),
      columns, rows: Array.isArray(value.rows) ? value.rows.slice(0, 5).map(row => columns.map((_, index) => Array.isArray(row) ? text(row[index]) : "—")) : [],
      note: text(value.note, "Validasi rancangan terhadap T.0.1."),
    };
  } catch { return null; }
}

function starterText(kind: Kind, title: string) {
  const project = title || "[Nama project]";
  const templates: Record<Kind, string> = {
    t01: `# Dokumen Rencana Program Kerja Sistem Informasi (PKSI)\n\n## ${project}\n\n### 1. Pendahuluan\n**Deskripsi PKSI**\n\n[Uraikan perubahan atau sistem yang diusulkan berdasarkan naskah dinas dan sumber knowledge base.]\n\n**Mengapa PKSI diperlukan**\n\n[Masalah atau kebutuhan yang menjadi dasar usulan.]\n\n**Target penyelesaian**\n\n[Periode target yang perlu dikonfirmasi.]\n\n### 2. Tujuan dan Kegunaan PKSI\n[Manfaat dan tujuan terukur.]\n\n### 3. Cakupan PKSI\n**Termasuk:**\n- [Fungsi dan pengguna dalam cakupan]\n\n**Tidak termasuk:**\n- [Batasan yang disepakati]\n\n**Sistem terkait dan asumsi:**\n- [Sumber data, integrasi, dan asumsi]\n\n### 4. Risiko dan Batasan\n[Risiko proses bisnis, data, jadwal, dan pengendalian.]\n\n### 5. Gambaran Umum Aplikasi yang Diharapkan\n[Ringkasan fitur utama dan informasi yang dikelola.]\n\n### 6. Usulan Jadwal Pelaksanaan\n| Tahap | Target | PIC |\n|---|---|---|\n| Spesifikasi kebutuhan | [Tanggal] | [PIC] |\n| Desain dan pengembangan | [Tanggal] | [PIC] |\n| SIT dan UAT | [Tanggal] | [PIC] |\n| Deployment dan go-live | [Tanggal] | [PIC] |\n\n### 7. Rencana Pengelolaan\n[Peran satuan kerja pemilik, operasional, dukungan, dan pemeliharaan.]`,
    t11: `# T.1.1 Spesifikasi Kebutuhan (User Requirement)\n\n## ${project}\n\nDraft T.1.1 belum dibuat. Gunakan tombol **Susun draft T.1.1** agar AURA mengikuti dokumen "T.1.1 Template Spesifikasi Kebutuhan (Usreq).docx" dari knowledge base. Bagian dan urutan akan mengikuti template tersebut; informasi yang tidak tersedia dari T.0.1 akan ditandai untuk konfirmasi Analis.`,
    mockup: `# Rancangan Mockup\n\n## ${project}\n\n### Tujuan layar\n[Tujuan dan pengguna layar.]\n\n### Komponen utama\n- Pencarian dan filter periode\n- Ringkasan status data\n- Tabel informasi utama\n- Panel detail dan riwayat perubahan\n- Aksi sesuai kewenangan pengguna\n\n### Alur interaksi\n1. Pengguna memilih entitas dan periode.\n2. Sistem menampilkan data dari sumber yang disepakati.\n3. Pengguna meninjau, mengisi analisis, lalu menyimpan sebagai draft.\n4. Reviewer/approver meninjau sesuai kewenangan.\n\n[Gunakan pratinjau layar di sebelah kanan sebagai kerangka awal; validasi field dan alur terhadap sumber.]`,
    mapping: `# Mapping Data Source\n\n## ${project}\n\n| Kode | Nama field | Sistem sumber | Tabel/entitas | Field sumber | Transformasi/aturan | Validasi |\n|---|---|---|---|---|---|---|\n| [Kode] | [Nama] | [Sistem] | [Tabel] | [Field] | [Aturan] | [Validasi] |\n\nCatatan: kode dan nama field yang belum didukung sumber resmi harus ditandai untuk konfirmasi analis.`,
    timeline: `# Timeline Pelaksanaan\n\n## ${project}\n\n| Tahap | Mulai | Selesai | PIC | Ketergantungan | Status |\n|---|---|---|---|---|---|\n| Penyusunan spesifikasi kebutuhan | [Tanggal] | [Tanggal] | [PIC] | Naskah dinas disepakati | Rencana |\n| Finalisasi T.1.1 | [Tanggal] | [Tanggal] | [PIC] | Review end user | Rencana |\n| Desain dan pengembangan | [Tanggal] | [Tanggal] | [PIC] | T.1.1 disetujui | Rencana |\n| SIT | [Tanggal] | [Tanggal] | [PIC] | Pengembangan selesai | Rencana |\n| UAT | [Tanggal] | [Tanggal] | [PIC] | SIT selesai | Rencana |\n| Deployment / go-live | [Tanggal] | [Tanggal] | [PIC] | UAT disetujui | Rencana |`,
    uat: `# Skenario User Acceptance Test\n\n## ${project}\n\n| ID | Skenario | Prasyarat | Langkah uji | Hasil yang diharapkan | Hasil aktual | Status |\n|---|---|---|---|---|---|---|\n| UAT-01 | [Nama skenario] | [Prasyarat] | 1. [Langkah] | [Hasil] | [Diisi saat UAT] | Belum diuji |\n\nPastikan skenario mencakup alur normal, validasi, kewenangan akses, penanganan kesalahan, dan audit trail.`,
  };
  return templates[kind];
}

export default function AuraWorkspace({ user, demoMode = false }: { user: AuraUser; demoMode?: boolean }) {
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<Project[]>(demoMode ? demoProjects : []);
  const [kbDocs, setKbDocs] = useState<KBDoc[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [kind, setKind] = useState<Kind>("t01");
  const [draft, setDraft] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [t11SectionId, setT11SectionId] = useState("1");
  const [sources, setSources] = useState<{ title: string; category: string; score?: number }[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newRequest, setNewRequest] = useState("");
  const [newSector, setNewSector] = useState("");
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const [kbCategory, setKbCategory] = useState("T.0.1 Rencana");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminRole, setAdminRole] = useState<"analis" | "head">("analis");

  useEffect(() => {
    if (demoMode) return;
    fetch("/api/projects").then(r => r.ok ? r.json() : Promise.reject()).then(d => setProjects(d.projects ?? [])).catch(() => setError("Belum dapat memuat project. Pastikan migrasi Supabase sudah diterapkan."));
    fetch("/api/kb").then(r => r.ok ? r.json() : Promise.reject()).then(d => setKbDocs(d.documents ?? [])).catch(() => undefined);
  }, [demoMode]);

  useEffect(() => {
    if (demoMode || view !== "admin" || user.role !== "admin") return;
    fetch("/api/admin/users").then(r => r.ok ? r.json() : Promise.reject()).then(d => setTeamUsers(d.users ?? [])).catch(() => setError("Daftar pengguna belum dapat dimuat."));
  }, [demoMode, view, user.role]);

  const roleLabel = roleLabels[user.role] || "PENGGUNA";
  const dateLabel = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const moduleInfo = useMemo(() => kinds.find(k => k.id === kind)!, [kind]);
  const mockupSpec = useMemo(() => kind === "mockup" ? readMockupSpec(draft) : null, [kind, draft]);
  const t11Accepted = docs.some(item => item.kind === "t11" && ["analyst_accepted", "approved"].includes(item.status));
  const t11CompletedCount = t11Stages.filter(stage => hasT11Stage(draft, stage.id)).length;
  const t11Complete = t11CompletedCount === t11Stages.length;
  const visibleKinds = user.role === "head"
      ? kinds.filter(k => ["t01", "t11", "mockup", "mapping"].includes(k.id))
      : user.role === "analis"
        ? kinds.filter(k => ["t01", "t11", "mockup", "mapping"].includes(k.id))
        : kinds;

  function openProject(item: Project) {
    const initialKind: Kind = "t11";
    setProject(item); setView("projects"); setKind(initialKind); setDraft(starterText(initialKind, item.title)); setSources([]); setComments([]); setDocs([]); setError("");
    if (!demoMode) {
      fetch(`/api/documents?projectId=${encodeURIComponent(item.id)}`).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
        const loaded: ProjectDocument[] = d.documents ?? [];
        setDocs(loaded);
        const first = loaded.find(x => x.kind === initialKind);
        if (first) {
          setDraft(first.content);
          fetch(`/api/comments?documentId=${first.id}`).then(r => r.ok ? r.json() : Promise.reject()).then(result => setComments(result.comments ?? [])).catch(() => undefined);
        }
      }).catch(() => setError("Dokumen project belum dapat dimuat."));
    }
  }

  async function uploadRequestFile(projectId: string, file: File) {
    const supabase = createClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/${projectId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("aura-kb").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;
    const reg = await fetch("/api/kb/register-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, storagePath: path, fileName: file.name, byteSize: file.size }) });
    const registered = await reg.json(); if (!reg.ok) throw new Error(registered.error || "Naskah dinas gagal diregistrasi.");
    const process = await fetch("/api/kb/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: registered.document.id }) });
    const processed = await process.json(); if (!process.ok) throw new Error(processed.error || "Naskah dinas gagal diindeks.");
    setNotice("Naskah dinas berhasil diunggah dan disiapkan untuk pencarian AI.");
  }

  function selectKind(next: Kind) {
    setKind(next);
    const saved = docs.find(d => d.kind === next);
    setDraft(saved?.content ?? starterText(next, project?.title ?? "[Nama project]"));
    setSources([]);
    setComments([]);
    if (saved && !demoMode) fetch(`/api/comments?documentId=${saved.id}`).then(r => r.ok ? r.json() : Promise.reject()).then(d => setComments(d.comments ?? [])).catch(() => undefined);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!newTitle.trim()) return;
    if (!demoMode && !requestFile) { setError("Unggah dokumen T.0.1 Usulan PKSI yang telah diserahkan Satuan Kerja."); return; }
    if (demoMode) {
      const item: Project = { id: `demo-${Date.now()}`, title: newTitle.trim(), request_number: newRequest, sector: newSector, status: "draft", created_at: new Date().toISOString() };
      setProjects(prev => [item, ...prev]); setNewProjectOpen(false); setNewTitle(""); setNewRequest(""); setNewSector(""); setRequestFile(null); openProject(item); if (requestFile) setNotice("Pratinjau tidak menyimpan dokumen. Unggah naskah hanya pada AURA yang sudah dikonfigurasi."); return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle, request_number: newRequest, sector: newSector }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Project tidak dapat dibuat.");
      const uploadedRequest = requestFile;
      setProjects(prev => [data.project, ...prev]); setNewProjectOpen(false); setNewTitle(""); setNewRequest(""); setNewSector(""); setRequestFile(null);
      openProject(data.project);
      if (uploadedRequest) {
        setNotice("Mengunggah dan mengindeks naskah dinas…");
        try {
          await uploadRequestFile(data.project.id, uploadedRequest);
          const submitted = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: data.project.id, kind: "t01", title: `T.0.1 · ${data.project.title}`, content: `Dokumen T.0.1 Usulan PKSI yang diserahkan Satuan Kerja: ${uploadedRequest.name}\n\nFile tersimpan privat dan telah diproses ke knowledge base project.`, status: "submitted" }) });
          const submittedData = await submitted.json();
          if (!submitted.ok) throw new Error(submittedData.error || "T.0.1 gagal dilampirkan ke project.");
          setDocs([submittedData.document]);
          setProject({ ...data.project, status: "submitted" });
          setKind("t11");
          setDraft(starterText("t11", data.project.title));
          setNotice("T.0.1 berhasil diunggah oleh Analis. AURA siap menyusun T.1.1 per bagian.");
        }
        catch (e) { setError(e instanceof Error ? e.message : "Naskah dinas belum dapat diindeks."); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Project tidak dapat dibuat."); } finally { setBusy(false); }
  }

  async function generateDraft() {
    const activePrompt = prompt.trim() || (kind === "t11" ? "Susun bagian ini saja sesuai template T.1.1 dan fakta T.0.1. Tandai informasi yang belum tersedia untuk konfirmasi Analis." : "");
    if (!project || !activePrompt) { setError("Pilih project dan tulis konteks yang ingin dikerjakan."); return; }
    if ((kind === "mockup" || kind === "mapping") && !t11Accepted) { setError("Selesaikan dan terima draft T.1.1 terlebih dahulu."); return; }
    setBusy(true); setError(""); setNotice(""); setSources([]);
    if (demoMode) {
      setDraft(`${starterText(kind, project.title)}\n\n## Catatan pratinjau\n\nMode pratinjau tidak memanggil AI dan tidak menggunakan dokumen internal. Hubungkan Supabase dan DataByte untuk menghasilkan draft berdasarkan knowledge base.`);
      setNotice("Pratinjau saja — teks ini contoh struktur, bukan hasil AI atau hasil analisis knowledge base."); setBusy(false); return;
    }
    try {
      const res = await fetch("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, kind, projectTitle: project.title, prompt: activePrompt, currentDraft: draft, ...(kind === "t11" ? { t11SectionId } : {}) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI belum dapat membuat draft.");
      setDraft(kind === "t11" ? mergeT11Section(draft, data.content, t11SectionId) : data.content);
      setSources(data.sources ?? []);
      setNotice(data.truncated
        ? `PERINGATAN: respons ${kind === "t11" ? `tahap ${t11Stages.find(stage => stage.id === t11SectionId)?.label ?? "T.1.1"}` : `artefak ${moduleInfo.label}`} mencapai batas token (finish_reason=${data.finishReason ?? "length"}, ${data.completionTokens ?? "?"} token). Isi mungkin terpotong; periksa kelengkapan dan susun ulang bagian ini sebelum menyimpan.`
        : data.needsMoreInfo
          ? "Sumber belum cukup. Tinjau pertanyaan klarifikasi pada bagian ini sebelum menyetujuinya."
          : kind === "t11"
            ? `Bagian ${t11Stages.find(stage => stage.id === t11SectionId)?.label} selesai dan digabungkan. Pilih tahap berikutnya; simpan draft setelah beberapa bagian selesai.`
            : "Draft dibuat. Periksa sumber dan asumsi sebelum mengirim untuk review.");
    } catch (e) { setError(e instanceof Error ? e.message : "AI belum dapat membuat draft."); }
    finally { setBusy(false); }
  }

  async function saveDraft(nextStatus?: string) {
    if (!project) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, kind, title: `${moduleInfo.short} · ${project.title}`, content: draft, status: nextStatus }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Draft tidak dapat disimpan.");
      setDocs(prev => {
        const updated = [data.document, ...prev.filter(d => d.kind !== kind)];
        return kind === "t11" ? updated.map(d => ["mockup", "mapping"].includes(d.kind) && d.status === "analyst_accepted" ? { ...d, status: "draft" } : d) : updated;
      });
      setNotice(nextStatus === "submitted" ? "T.0.1 berhasil dikirim ke Analis." : nextStatus === "analyst_review" ? "Hasil disimpan untuk review Analis." : "Draft tersimpan.");
    } catch (e) { setError(e instanceof Error ? e.message : "Draft tidak dapat disimpan."); }
    finally { setBusy(false); }
  }

  async function approveDraft() {
    if (kind === "t11" && user.role === "analis" && !t11Complete) { setError(`T.1.1 belum lengkap: baru ${t11CompletedCount} dari ${t11Stages.length} tahap terdeteksi. Susun semua bagian template sebelum menerima hasil.`); return; }
    const saved = docs.find(d => d.kind === kind); if (!saved) { setError("Simpan draft terlebih dahulu sebelum menyetujui."); return; }
    setBusy(true); setError("");
    try {
      const body = user.role === "head" ? { projectId: project?.id, status: "approved" } : { id: saved.id, status: "analyst_accepted" };
      const res = await fetch("/api/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Dokumen tidak dapat disetujui.");
      if (user.role === "head") {
        setDocs(prev => prev.map(d => ["t11", "mockup", "mapping"].includes(d.kind) && d.status === "analyst_accepted" ? { ...d, status: "approved" } : d));
        setProject(prev => prev ? { ...prev, status: "approved" } : prev);
        setNotice("Paket hasil disetujui oleh Approver.");
      } else {
        setDocs(prev => prev.map(d => d.id === saved.id ? data.document : d));
        if (data.projectStatus) setProject(prev => prev ? { ...prev, status: data.projectStatus } : prev);
        setNotice(data.projectStatus === "pending_approval" ? "Semua artefak diterima Analis dan dikirim ke Approver." : "Hasil diterima Analis.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Dokumen tidak dapat disetujui."); } finally { setBusy(false); }
  }

  async function rejectDraft() {
    const saved = docs.find(d => d.kind === kind); if (!saved) { setError("Simpan hasil sebelum memberi keputusan."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: saved.id, status: "analyst_rejected" }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Hasil tidak dapat ditolak.");
      setDocs(prev => prev.map(d => d.id === saved.id ? data.document : saved.kind === "t11" && ["mockup", "mapping"].includes(d.kind) && d.status === "analyst_accepted" ? { ...d, status: "draft" } : d));
      setProject(prev => prev ? { ...prev, status: data.projectStatus } : prev);
      setNotice("Hasil ditolak oleh Analis.");
    } catch (e) { setError(e instanceof Error ? e.message : "Hasil tidak dapat ditolak."); } finally { setBusy(false); }
  }

  async function requestChanges() {
    const saved = docs.find(d => d.kind === kind); if (!saved) { setError("Simpan draft terlebih dahulu sebelum meminta revisi."); return; }
    setBusy(true); setError("");
    try {
      const body = user.role === "head" ? { projectId: project?.id, status: "changes_requested" } : { id: saved.id, status: "changes_requested" };
      const res = await fetch("/api/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Status tidak dapat diubah.");
      if (user.role === "head") {
        setDocs(prev => prev.map(d => ["t11", "mockup", "mapping"].includes(d.kind) && d.status === "analyst_accepted" ? { ...d, status: "changes_requested" } : d));
        setProject(prev => prev ? { ...prev, status: "analyst_review" } : prev);
      } else {
        setDocs(prev => prev.map(d => d.id === saved.id ? data.document : saved.kind === "t11" && ["mockup", "mapping"].includes(d.kind) && d.status === "analyst_accepted" ? { ...d, status: "draft" } : d));
        if (data.projectStatus) setProject(prev => prev ? { ...prev, status: data.projectStatus } : prev);
      }
      setNotice("Revisi diminta. Tambahkan catatan agar penanggung jawab mengetahui bagian yang perlu diperbaiki.");
    } catch (e) { setError(e instanceof Error ? e.message : "Status tidak dapat diubah."); } finally { setBusy(false); }
  }

  async function setKBStatus(id: string, sourceStatus: string) {
    if (demoMode) return;
    const res = await fetch("/api/kb/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, sourceStatus }) });
    const data = await res.json(); if (!res.ok) { setError(data.error || "Status sumber tidak dapat diubah."); return; }
    setKbDocs(prev => prev.map(d => d.id === id ? data.document : d));
  }

  async function reindexKBDocument(id: string) {
    if (demoMode) return;
    const stuck = kbDocs.find(doc => doc.id === id)?.processing_status === "processing";
    if (stuck && !window.confirm("Status dokumen masih ‘processing’ dari proses sebelumnya. Pastikan tidak ada indeksasi lain yang sedang berjalan, lalu pilih OK untuk mencoba ulang.")) return;
    setBusy(true); setError(""); setNotice(`Mengindeks ulang dokumen dengan ${EMBEDDING_PROVIDER_LABEL}…`);
    try {
      const res = await fetch("/api/kb/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: id }), signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dokumen gagal diindeks ulang.");
      const fresh = await fetch("/api/kb", { cache: "no-store" }).then(r => r.json());
      setKbDocs(fresh.documents ?? []);
      setNotice(`Dokumen berhasil diindeks ulang (${data.chunks} bagian).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dokumen gagal diindeks ulang.");
      const fresh = await fetch("/api/kb", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (fresh?.documents) setKbDocs(fresh.documents);
    } finally {
      setBusy(false);
    }
  }

  async function deleteKBDocument(document: KBDoc) {
    if (demoMode || !window.confirm(`Hapus “${document.title}” dari knowledge base? File dan seluruh indeks pencariannya akan dihapus permanen.`)) return;
    setBusy(true); setError(""); setNotice("Menghapus dokumen dan indeks pencarian…");
    try {
      const res = await fetch("/api/kb/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dokumen gagal dihapus.");
      setKbDocs(prev => prev.filter(item => item.id !== document.id));
      setNotice(data.warning || `“${document.title}” dan indeks pencariannya berhasil dihapus.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dokumen gagal dihapus.");
    } finally {
      setBusy(false);
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault(); const saved = docs.find(d => d.kind === kind);
    if (!commentText.trim() || !saved) { setError("Simpan draft sebelum menambahkan komentar."); return; }
    if (demoMode) { setComments(prev => [{ id: `${Date.now()}`, message: commentText.trim(), created_at: new Date().toISOString() }, ...prev]); setCommentText(""); return; }
    const res = await fetch("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: saved.id, message: commentText }) });
    const data = await res.json(); if (!res.ok) { setError(data.error || "Komentar tidak dapat disimpan."); return; }
    setComments(prev => [data.comment, ...prev]); setCommentText("");
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); if (!files.length) return;
    if (demoMode) { setNotice("Upload dinonaktifkan pada pratinjau agar dokumen internal tidak tersimpan di browser."); event.target.value = ""; return; }
    const unsupportedFile = files.find(file => !/\.(pdf|docx|xlsx)$/i.test(file.name));
    if (unsupportedFile) { setError(`Format ${unsupportedFile.name.split(".").pop()?.toUpperCase() ?? "file"} belum didukung. Simpan dokumen Word lama (.doc) sebagai .docx, lalu unggah ulang.`); event.target.value = ""; return; }
    setBusy(true); setError(""); setNotice(`Unggah dan indeksasi dimulai dengan ${EMBEDDING_PROVIDER_LABEL}. Batas waktu proses 10 menit per dokumen.`);
    try {
      const supabase = createClient();
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${user.id}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("aura-kb").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (uploadError) throw uploadError;
        const registrationBody = { title: file.name.replace(/\.[^.]+$/, ""), fileName: file.name, storagePath: path, category: kbCategory, byteSize: file.size };
        let reg = await fetch("/api/kb/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(registrationBody) });
        let registered = await reg.json();
        if (reg.status === 409 && registered.duplicateCandidate) {
          const candidates = (registered.candidates as string[] | undefined)?.join("\n") ?? "";
          const proceed = window.confirm(`${registered.error}\n\nDokumen yang mirip:\n${candidates}\n\nTetap unggah sebagai dokumen berbeda?`);
          if (proceed) {
            reg = await fetch("/api/kb/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...registrationBody, allowPossibleDuplicate: true }) });
            registered = await reg.json();
          } else {
            await supabase.storage.from("aura-kb").remove([path]);
            throw new Error("Unggah dibatalkan karena dokumen berpotensi duplikat.");
          }
        }
        if (!reg.ok) { await supabase.storage.from("aura-kb").remove([path]); throw new Error(registered.error || "Metadata dokumen gagal disimpan."); }
        const process = await fetch("/api/kb/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: registered.document.id }), signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
        const processed = await process.json(); if (!process.ok) throw new Error(processed.error || "Indeksasi dokumen gagal.");
      }
      const fresh = await fetch("/api/kb").then(r => r.json()); setKbDocs(fresh.documents ?? []); setNotice(`${files.length} dokumen selesai diunggah dan masuk knowledge base.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unggah dokumen gagal."); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function exportDocument(format: "word" | "excel") {
    if (!draft.trim()) return;
    if (demoMode) { setNotice("Ekspor tersedia setelah backend AURA dikonfigurasi."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/export/${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `${moduleInfo.short} - ${project?.title ?? "AURA"}`, content: draft }) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Ekspor gagal."); }
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${moduleInfo.short}-${(project?.title ?? "AURA").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${format === "word" ? "docx" : "xlsx"}`; a.click(); URL.revokeObjectURL(url); setNotice(`Berkas ${format.toUpperCase()} berhasil dibuat.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Ekspor gagal."); } finally { setBusy(false); }
  }

  async function inviteUser(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: adminEmail, name: adminName, password: adminPassword, role: adminRole }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Pengguna tidak dapat dibuat.");
      setNotice(`Akun ${adminEmail} telah dibuat.`); setAdminEmail(""); setAdminName(""); setAdminPassword("");
      const fresh = await fetch("/api/admin/users").then(r => r.json()); setTeamUsers(fresh.users ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Pengguna tidak dapat dibuat."); } finally { setBusy(false); }
  }

  async function toggleUser(userId: string, active: boolean) {
    const res = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: userId, active: !active }) });
    const data = await res.json(); if (!res.ok) { setError(data.error || "Status akun tidak dapat diubah."); return; }
    setTeamUsers(prev => prev.map(item => item.id === userId ? data.user : item));
  }

  async function logout() {
    if (demoMode) { window.location.href = "/login"; return; }
    await createClient().auth.signOut(); window.location.href = "/login";
  }

  const nav = (next: View, label: string, icon: string) => <button className={`nav-item ${view === next ? "active" : ""}`} onClick={() => { setView(next); setProject(null); setMobileMenu(false); setNotice(""); setError(""); }}><span className="nav-icon">{icon}</span>{label}</button>;
  const statusLabels: Record<string, string> = { submitted: "Menunggu Review Analis", analyst_review: "Review Analis", changes_requested: "Perlu revisi", rejected: "Ditolak Analis", pending_approval: "Menunggu Approver", approved: "Disetujui final", analyst_accepted: "Diterima Analis", analyst_rejected: "Ditolak Analis", draft: "Draft", review: "Review Analis", in_review: "Review Analis" };
  const statusLabel = (status: string) => statusLabels[status] || "Draft";
  const projectStatusClass = (status: string) => status === "approved" ? "approved" : ["submitted", "analyst_review", "pending_approval", "review"].includes(status) ? "review" : "draft";
  const sortedProjects = [...projects].sort((a,b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <div className="app-shell">
      {demoMode && <div className="demo-banner">PRATINJAU AURA · data contoh · AI dan unggah dokumen tidak aktif</div>}
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <a href={demoMode ? "/preview" : "/dashboard"} className="sidebar-brand"><span className="brand-mark">A</span><span>AURA</span></a>
        <div className="side-caption">RUANG KERJA</div>
        <nav className="side-nav">{nav("home", "Beranda", "⌂")}{nav("projects", "Project", "▤")}{nav("knowledge", "Knowledge base", "▧")}</nav>
        <div className="side-caption">PENGELOLAAN</div>
        <nav className="side-nav">{user.role === "admin" && !demoMode && nav("admin", "Pengguna", "♙")}</nav>
        <div className="side-spacer" />
        <div className="kb-status"><strong>Knowledge base</strong><span>{demoMode ? "190 dokumen · contoh" : `${kbDocs.length} dokumen terdaftar`}</span><span>{demoMode ? "Pratinjau isi dan alur kerja" : "Pembaruan terakhir tersinkron"}</span></div>
        <div className="sidebar-user"><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><div><b>{user.name}</b><small>{roleLabel}</small></div></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileMenu(v => !v)}>☰</button><div className="crumb">AURA <span> / </span> <strong>{project ? project.title : view === "home" ? "Beranda" : view === "projects" ? "Project" : view === "knowledge" ? "Knowledge base" : "Pengguna"}</strong></div></div>
          <div className="topbar-right"><span className="topbar-date">{dateLabel}</span><span className="role-pill">{roleLabel}</span><button className="icon-button" onClick={logout} title="Keluar">↗</button></div>
        </header>
        <main className="content">
          {error && <div className="alert error" style={{ marginBottom: 14 }}>{error}</div>}
          {notice && <div className={notice.startsWith("PERINGATAN:") ? "alert error" : "notice-strip"} style={{ marginBottom: 14 }}>{notice}</div>}
          {view === "home" && <>
            <div className="page-heading"><div><span className="eyebrow">RUANG KERJA ADSI</span><h1>Selamat pagi, {user.name.split(" ")[0]}.</h1><p>{user.role === "analis" ? "Unggah T.0.1 yang diserahkan Satuan Kerja, susun hasil AURA, lalu review." : "Periksa paket hasil yang telah diterima Analis."}</p></div><div className="heading-actions">{user.role !== "head" && <button className="button primary" onClick={() => setNewProjectOpen(true)}>＋ {user.role === "analis" ? "Project baru · unggah T.0.1" : "Project baru"}</button>}</div></div>
            <div className="stat-grid"><div className="stat-card"><div className="stat-label">Project aktif <span>◌</span></div><div className="stat-number">{projects.filter(p => p.status !== "approved").length.toString().padStart(2,"0")}</div><div className="stat-sub">Dalam penyusunan atau review</div></div><div className="stat-card"><div className="stat-label">Menunggu review <span>◷</span></div><div className="stat-number">{projects.filter(p => ["analyst_review", "pending_approval", "review"].includes(p.status)).length.toString().padStart(2,"0")}</div><div className="stat-sub">Perlu tanggapan Analis atau Approver</div></div><div className="stat-card"><div className="stat-label">Knowledge base <span>▧</span></div><div className="stat-number">{demoMode ? "190" : kbDocs.length.toString().padStart(2,"0")}</div><div className="stat-sub">Dokumen terindeks</div></div><div className="stat-card"><div className="stat-label">Draft tersimpan <span>▤</span></div><div className="stat-number">{demoMode ? "08" : docs.length.toString().padStart(2,"0")}</div><div className="stat-sub">T.0.1, T.1.1, dan artefak</div></div></div>
            <div className="workspace-grid"><section className="panel"><div className="panel-header"><div><h3>Project terbaru</h3><p>Project yang terakhir diperbarui tim Anda</p></div><button className="button ghost small" onClick={() => setView("projects")}>Semua project →</button></div><div className="project-list">{sortedProjects.length ? sortedProjects.slice(0,5).map(p => <div className="project-row" key={p.id}><div><div className="project-title">{p.title}</div><div className="project-meta">{p.request_number || "Nomor belum diisi"}</div></div><div className="project-sector">{p.sector || "Sektor belum ditentukan"}</div><div><span className={`status ${projectStatusClass(p.status)}`}><i className="status-dot" />{statusLabel(p.status)}</span></div><div className="project-meta">{p.created_at ? new Date(p.created_at).toLocaleDateString("id-ID", { day:"numeric", month:"short" }) : "Baru"}</div><button className="project-open" onClick={() => openProject(p)}>Buka →</button></div>) : <div className="empty-state">Belum ada project. Buat project pertama untuk memulai.</div>}</div></section>
              <section className="panel"><div className="panel-header"><div><h3>Mulai dengan artefak</h3><p>Artefak yang tersedia sesuai peran Anda</p></div></div><div className="source-list">{visibleKinds.slice(0,4).map((k,i)=><button className="source-item" key={k.id} onClick={()=>{if(project)selectKind(k.id);else setNewProjectOpen(true)}} style={{width:"100%",border:0,background:"transparent",textAlign:"left",cursor:"pointer"}}><span className="source-type">{k.short}</span><span><b>{k.label}</b><small>{i===0?"T.0.1 Usulan PKSI":"Artefak proses AURA"}</small></span></button>)}</div></section></div>
            <div className="panel" style={{marginTop:16}}><div className="panel-header"><div><h3>Alur kerja AURA</h3><p>Tahapan dari usulan sampai keputusan akhir.</p></div><span className="status approved"><i className="status-dot"/>Siklus kerja</span></div><div className="workflow-steps"><div><span>01</span><b>Analis mengunggah T.0.1</b><small>Usulan PKSI menjadi dasar pemrosesan.</small></div><i>→</i><div><span>02</span><b>AURA menyusun draft T.1.1</b><small>Format mengikuti template spesifikasi kebutuhan di knowledge base.</small></div><i>→</i><div><span>03</span><b>Analis menerima T.1.1</b><small>Setelah diterima, Mockup dan Mapping opsional dapat disusun.</small></div><i>→</i><div><span>04</span><b>Approver memeriksa akhir</b><small>Finalisasi dilakukan setelah Mockup diterima; Mapping bersifat opsional.</small></div></div></div>
          </>}

          {view === "projects" && !project && <>
            <div className="page-heading"><div><span className="eyebrow">PORTOFOLIO</span><h1>Project</h1><p>Daftar usulan dan dokumen yang sedang disusun.</p></div>{user.role !== "head" && <button className="button primary" onClick={() => setNewProjectOpen(true)}>＋ {user.role === "analis" ? "Project baru · unggah T.0.1" : "Project baru"}</button>}</div>
            <section className="panel"><div className="panel-header"><div><h3>Semua project</h3><p>{projects.length} project dalam ruang kerja</p></div><div className="filter-row"><input placeholder="Cari project…" onChange={e=>{const q=e.target.value.toLowerCase(); if(!demoMode) fetch(`/api/projects?q=${encodeURIComponent(q)}`).then(r=>r.json()).then(d=>setProjects(d.projects??[])); else setProjects(demoProjects.filter(p=>p.title.toLowerCase().includes(q)))}} /></div></div><div className="project-list">{sortedProjects.length ? sortedProjects.map(p=><div className="project-row" key={p.id}><div><div className="project-title">{p.title}</div><div className="project-meta">{p.request_number || "Nomor belum diisi"}</div></div><div className="project-sector">{p.sector || "Sektor belum ditentukan"}</div><div><span className={`status ${p.status === "approved" ? "approved" : p.status === "pending_approval" || p.status === "analyst_review" || p.status === "review" ? "review" : "draft"}`}><i className="status-dot" />{statusLabel(p.status)}</span></div><div className="project-meta">{p.created_at ? new Date(p.created_at).toLocaleDateString("id-ID") : ""}</div><button className="project-open" onClick={()=>openProject(p)}>Buka →</button></div>) : <div className="empty-state">Tidak ada project.</div>}</div></section>
          </>}

          {view === "projects" && project && <>
            <div className="workspace-toolbar"><button className="back-button" onClick={()=>{setProject(null);setView("projects")}}>← Kembali ke project</button><div className="heading-actions"><span className={`status ${projectStatusClass(project.status)}`}><i className="status-dot" />{statusLabel(project.status)}</span></div></div>
            <div className="page-heading" style={{marginBottom:15}}><div><span className="eyebrow">{project.request_number || "USULAN BARU"} · {project.sector || "SEKTOR BELUM DIISI"}</span><h1>{project.title}</h1><p>{t11Accepted ? "T.1.1 telah diterima. Mockup dapat disusun berikutnya; Mapping Kode bersifat opsional." : "Tahap pertama: susun, periksa, simpan, dan terima T.1.1 sebelum melanjutkan."}</p></div></div>
            <div className="module-tabs">{visibleKinds.map(k=>{const locked=(k.id==="mockup"||k.id==="mapping")&&!t11Accepted;return <button key={k.id} className={`module-tab ${kind===k.id?"active":""}`} onClick={()=>selectKind(k.id)} disabled={locked} title={locked?"Terima draft T.1.1 terlebih dahulu":""}>{k.id==="mapping"?"KODE · OPSIONAL":k.short}</button>})}</div>
            <div className="editor-layout"><section className="panel editor-card"><h3>{moduleInfo.label}</h3><p className="helper">{moduleInfo.description}</p>
              {kind === "mockup" && (
                <div className="mockup-frame">
                  <div style={{fontSize:10,color:"#72817c",fontWeight:700}}>PRATINJAU WIREFRAME · {mockupSpec ? "HASIL GENERASI AURA" : "MENUNGGU SPESIFIKASI"}</div>
                  <div className="mockup-window">
                    <div className="mockup-top"><i/><i/><i/><span style={{fontSize:8,color:"#899590",marginLeft:7}}>Pratinjau rancangan · AURA</span></div>
                    <div className="mockup-body">
                      <div className="mockup-side">{(mockupSpec?.navigation ?? ["Ringkasan", "Data utama", "Riwayat"]).map((item, index)=><span className={index===0?"selected":""} key={`${item}-${index}`}>{item}</span>)}</div>
                      <div className="mockup-main">
                        <h4>{mockupSpec?.title ?? project.title}</h4>
                        <p className="mockup-purpose">{mockupSpec?.purpose ?? "Pratinjau akan terisi setelah Analis membuat rancangan mockup dengan AURA."}</p>
                        <div className="mockup-filters">{(mockupSpec?.filters ?? ["Periode", "Status"]).map((filter,index)=><span key={`${filter}-${index}`}>{filter}　⌄</span>)}</div>
                        <div className="mockup-metrics">{(mockupSpec?.metrics ?? [{label:"Ringkasan",value:"—",detail:"Menunggu rancangan"}]).map((metric,index)=><div className="mockup-metric" key={`${metric.label}-${index}`}><small>{metric.label}</small><b>{metric.value}</b><span>{metric.detail}</span></div>)}</div>
                        <div className="mockup-table-wrap"><table className="mockup-data-table"><thead><tr>{(mockupSpec?.columns ?? ["Informasi", "Status"]).map((column,index)=><th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{(mockupSpec?.rows?.length ? mockupSpec.rows : [["Contoh data untuk ditinjau", "Perlu konfirmasi"]]).map((row,index)=><tr key={`row-${index}`}>{(mockupSpec?.columns ?? ["Informasi", "Status"]).map((_,columnIndex)=><td key={`cell-${columnIndex}`}>{row[columnIndex] ?? "—"}</td>)}</tr>)}</tbody></table></div>
                        <div className="mockup-preview-actions">{(mockupSpec?.actions ?? ["Cari", "Ekspor"]).map((action,index)=><span key={`${action}-${index}`}>{action}</span>)}</div>
                        <div className="mockup-note">{mockupSpec?.note ?? "Label dan data contoh harus divalidasi terhadap T.0.1."}</div>
                      </div>
                    </div>
                  </div>
                  {mockupSpec && <div className="mockup-edit-hint">Pratinjau berasal dari spesifikasi JSON pada draft di bawah; perubahan JSON yang valid akan memperbarui layar.</div>}
                </div>
              )}
              {kind === "t11" && <div className="project-meta" style={{margin:"5px 0 9px"}}>Tahap T.1.1 terisi: {t11CompletedCount}/{t11Stages.length}. {t11Complete ? "Bagian utama terdeteksi lengkap; Analis tetap perlu memeriksa subbagian dan isi." : "Persetujuan Analis terbuka setelah semua tahap utama disusun."}</div>}
              <textarea className="field-area" value={draft} readOnly={user.role === "head" || kind === "t01" || (user.role === "analis" && docs.find(d => d.kind === kind)?.status === "approved")} onChange={e=>setDraft(e.target.value)} placeholder="Isi draft atau minta AI menyusunnya berdasarkan knowledge base…" />
              <div className="editor-actions"><div className="editor-actions-left">{user.role === "analis" && kind !== "t01" && <button className="button secondary small" onClick={()=>saveDraft("draft")} disabled={busy}>Simpan hasil</button>}<button className="button ghost small" onClick={()=>exportDocument("word")} disabled={busy}>Ekspor Word</button><button className="button ghost small" onClick={()=>exportDocument("excel")} disabled={busy}>Ekspor Excel</button></div><div className="editor-actions-right">{user.role === "analis" && kind !== "t01" && docs.some(d=>d.kind===kind) && <><button className="button ghost small" onClick={requestChanges} disabled={busy}>Minta revisi</button><button className="button danger small" onClick={rejectDraft} disabled={busy}>Tolak hasil</button><button className="button primary small" onClick={approveDraft} disabled={busy||(kind==="t11"&&!t11Complete)} title={kind==="t11"&&!t11Complete?"Susun semua tahap T.1.1 terlebih dahulu":""}>Terima hasil</button></>}{user.role === "head" && project.status === "pending_approval" && <><button className="button secondary small" onClick={requestChanges} disabled={busy}>Kembalikan ke Analis</button><button className="button primary small" onClick={approveDraft} disabled={busy}>Setujui final</button></>}</div></div>
            </section><aside className="editor-side">{user.role === "analis" && kind !== "t01" && <div className="ai-card"><h4>Bantu susun dengan AURA</h4><p>{kind === "t11" ? "Susun T.1.1 per bagian. Hasil tiap tahap digabung ke draft; periksa dan simpan sebelum lanjut." : kind === "mapping" ? "Mapping kode bersifat opsional. AURA akan memakai T.1.1 yang sudah diterima sebagai acuan." : "AURA akan memakai T.1.1 yang sudah diterima serta User Manual SIP IKNB sebagai acuan mockup."}</p>{kind === "t11" && <label className="field-label" style={{display:"block",marginBottom:10}}>Tahap T.1.1<select className="field-select" value={t11SectionId} onChange={e=>setT11SectionId(e.target.value)} disabled={busy} style={{width:"100%",marginTop:5}}>{t11Stages.map(stage=><option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>}<textarea className="field-area" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={kind === "t11" ? "Opsional: fokus atau arahan khusus untuk tahap ini…" : "Instruksi atau fokus penyusunan untuk artefak ini…"}/><button className="button primary small" onClick={generateDraft} disabled={busy||((kind==="mockup"||kind==="mapping")&&!t11Accepted)}>{busy ? "Menyusun draft…" : kind === "t11" ? `Susun tahap ${t11SectionId}` : kind === "mockup" ? "Susun draft Mockup" : "Susun draft Mapping (opsional)"}<span>→</span></button>{kind === "t11" && <small style={{display:"block",marginTop:8,color:"#65736e"}}>Bagian yang sudah ada akan dipertahankan. Tahap 1 mencakup 1.1 dan 1.2. Simpan draft setelah menyusun beberapa tahap.</small>}{!t11Accepted&&(kind==="mockup"||kind==="mapping")&&<small style={{display:"block",marginTop:8,color:"#896629"}}>Terima draft T.1.1 terlebih dahulu untuk membuka tahap ini.</small>}</div>}
              <div className="evidence-card"><h4>Sumber yang dipakai</h4>{sources.length ? sources.map((s,i)=><div className="evidence-row" key={`${s.title}-${i}`}><b>{s.title}</b>{s.category}{s.score ? ` · kecocokan ${Math.round(s.score*100)}%` : ""}</div>) : <div className="evidence-row">Sumber akan muncul setelah draft dibuat oleh AI.</div>}</div>
              <div className="review-card"><h4>Catatan review</h4>{comments.map(c=><div className="comment" key={c.id}>{c.message}<small>{c.profiles?.display_name || "Anggota tim"} · {new Date(c.created_at).toLocaleDateString("id-ID")}</small></div>)}<form className="comment-box" onSubmit={addComment}><input value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Tulis catatan…"/><button className="button secondary small" type="submit">Kirim</button></form><div className="project-meta">Simpan draft terlebih dahulu untuk membuka catatan review.</div></div>
            </aside></div>
          </>}

          {view === "knowledge" && <>
            <div className="page-heading"><div><span className="eyebrow">SUMBER AURA</span><h1>Knowledge base</h1><p>Dokumen yang menjadi rujukan draft dan spesifikasi.</p></div></div>
            {user.role === "admin" && <section className="panel" style={{padding:17,marginBottom:15}}><div className="panel-header" style={{padding:0,border:0,marginBottom:12}}><div><h3>Tambah dokumen</h3><p>Unggah PDF, Word, atau Excel. File dikirim langsung ke bucket privat.</p></div><span className="role-pill">ADMIN</span></div><div className="upload-drop"><strong>Pilih dokumen knowledge base</strong><span>Berkas diproses satu per satu dan dipotong menjadi bagian pencarian.</span><div className="filter-row" style={{justifyContent:"center",marginTop:13}}><select value={kbCategory} onChange={e=>setKbCategory(e.target.value)}><option>T.0.1 Rencana</option><option>T.1.1 User Requirement</option><option>Timeline</option><option>User Manual</option><option>Naskah Dinas</option><option>Lainnya</option></select><input type="file" multiple accept=".pdf,.docx,.xlsx" onChange={uploadFiles} disabled={busy}/></div>{busy&&<div className="inline-progress">{notice || "Memproses berkas…"}</div>}</div></section>}
            {demoMode && <div className="notice-strip">Pratinjau menampilkan jumlah dokumen contoh saja; file internal tidak dimuat ke pratinjau.</div>}
            <section className="panel"><div className="panel-header"><div><h3>Dokumen terdaftar</h3><p>{kbDocs.length} dokumen · hanya sumber berstatus disetujui yang dipakai AI</p></div><div className="filter-row"><select><option>Semua kategori</option><option>T.0.1 Rencana</option><option>T.1.1 User Requirement</option><option>User Manual</option></select></div></div><div style={{overflowX:"auto"}}><table className="kb-table"><thead><tr><th>Dokumen</th><th>Kategori</th><th>Status sumber</th><th>Indeksasi</th><th>Aksi</th></tr></thead><tbody>{kbDocs.length ? kbDocs.map(d=><tr key={d.id}><td>{d.title}<small style={{display:"block",color:"#8a9692",marginTop:4}}>{d.file_name}</small></td><td>{d.category}</td><td>{d.source_status.replaceAll("_"," ")}</td><td>{d.processing_status}</td><td>{user.role === "admin" && <div className="filter-row"><button className="button secondary small" disabled={busy} onClick={()=>reindexKBDocument(d.id)}>{d.processing_status === "processing" ? "Coba indeks ulang" : "Indeks ulang"}</button><button className="button secondary small" disabled={d.processing_status !== "ready" || d.source_status === "disetujui" || busy} onClick={()=>setKBStatus(d.id,"disetujui")}>Setujui</button><button className="button ghost small" disabled={d.source_status === "digantikan" || busy} onClick={()=>setKBStatus(d.id,"digantikan")}>Gantikan</button><button className="button danger small" disabled={busy} onClick={()=>deleteKBDocument(d)}>Hapus</button></div>}</td></tr>) : demoMode ? ["T.0.1 Rencana","T.1.1 User Requirement","Timeline","User Manual"].map(c=><tr key={c}><td>Dokumen contoh kategori {c}</td><td>{c}</td><td>perlu verifikasi</td><td>pratinjau</td><td>—</td></tr>) : <tr><td colSpan={5} className="empty-state">Belum ada dokumen. Admin dapat menambahkannya di sini.</td></tr>}</tbody></table></div></section>
          </>}

          {view === "admin" && <>
            <div className="page-heading"><div><span className="eyebrow">ADMINISTRASI</span><h1>Pengguna</h1><p>Admin mengelola akun dan menetapkan peran pengguna AURA.</p></div></div>
            <div className="workspace-grid"><section className="panel" style={{padding:18}}><h3 style={{fontSize:13,margin:"0 0 6px"}}>Buat akun pengguna</h3><p className="muted" style={{lineHeight:1.6}}>Password akan ditangani Supabase Auth. AURA tidak menyimpan password dalam bentuk yang dapat dibaca.</p><form onSubmit={inviteUser} className="form-grid" style={{marginTop:17}}><label className="field-label">Nama<input className="field-input" value={adminName} onChange={e=>setAdminName(e.target.value)} required/></label><label className="field-label">Email kerja<input className="field-input" type="email" value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} required/></label><label className="field-label">Peran<select className="field-select" value={adminRole} onChange={e=>setAdminRole(e.target.value as "analis"|"head")}><option value="analis">Analis · Reviewer</option><option value="head">Approver · Final Checker</option></select></label><label className="field-label">Password awal<input className="field-input" type="password" minLength={12} value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} required/><small style={{fontWeight:400,color:"#899490"}}>Minimal 12 karakter. Admin menyampaikan password awal melalui kanal terpisah.</small></label><div className="span-two"><button className="button primary" disabled={busy}>Buat akun pengguna</button></div></form></section><section className="panel" style={{padding:18}}><h3 style={{fontSize:13,margin:"0 0 9px"}}>Peran AURA</h3><div className="activity-list" style={{padding:0}}><div className="activity-item"><span className="activity-icon">A</span><div><b>Admin</b><small>Mengelola pengguna, knowledge base, dan pengaturan.</small></div></div><div className="activity-item"><span className="activity-icon">S</span><div><b>Satuan Kerja</b><small>Menyerahkan dokumen T.0.1 kepada Analis untuk diunggah ke AURA.</small></div></div><div className="activity-item"><span className="activity-icon">M</span><div><b>Analis</b><small>Menyusun dan meninjau T.1.1, Mockup UI/UX, dan Mapping Kode.</small></div></div><div className="activity-item"><span className="activity-icon">A</span><div><b>Approver</b><small>Melakukan pemeriksaan akhir dan menyetujui paket hasil.</small></div></div></div></section></div>
            <section className="panel" style={{marginTop:16}}><div className="panel-header"><div><h3>Akun terdaftar</h3><p>{teamUsers.length} akun · admin dapat menonaktifkan akses</p></div></div><div style={{overflowX:"auto"}}><table className="kb-table"><thead><tr><th>Pengguna</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{teamUsers.map(member=><tr key={member.id}><td>{member.display_name}<small style={{display:"block",color:"#8a9692",marginTop:4}}>{member.email}</small></td><td>{roleLabels[member.role]}</td><td>{member.active?"Aktif":"Nonaktif"}</td><td><button className={`button small ${member.active?"ghost":"secondary"}`} disabled={member.id===user.id} onClick={()=>toggleUser(member.id,member.active)}>{member.active?"Nonaktifkan":"Aktifkan"}</button></td></tr>)}</tbody></table></div></section>
          </>}
        </main>
      </div>
      {newProjectOpen && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setNewProjectOpen(false)}}><section className="modal"><div className="modal-head"><div><span className="eyebrow">{"MULAI DARI REQUEST"}</span><h3>{user.role === "analis" ? "Project baru · unggah T.0.1" : "Project baru"}</h3></div><button className="modal-close" onClick={()=>setNewProjectOpen(false)}>×</button></div><form onSubmit={createProject} className="form-grid"><label className="field-label span-two">Nama project<input className="field-input" value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Contoh: Enhancement Modul…" required/></label><label className="field-label">Nomor naskah / PKSI<input className="field-input" value={newRequest} onChange={e=>setNewRequest(e.target.value)} placeholder="Opsional"/></label><label className="field-label">Industri / sektor<input className="field-input" value={newSector} onChange={e=>setNewSector(e.target.value)} placeholder="Asuransi, Penjaminan, Dana Pensiun…"/></label><label className="field-label span-two">Dokumen T.0.1 Usulan PKSI {"(wajib)"}<input className="field-input" type="file" accept=".pdf,.docx,.xlsx" required onChange={e=>setRequestFile(e.target.files?.[0] ?? null)}/><small style={{fontWeight:400,color:"#899490"}}>PDF, DOCX, atau XLSX. File disimpan privat dan menjadi sumber untuk tiga artefak AURA.</small></label><div className="span-two" style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:7}}><button type="button" className="button ghost" onClick={()=>setNewProjectOpen(false)}>Batal</button><button className="button primary" disabled={busy}>{busy?"Mengirim…":"Buat project dan unggah T.0.1 →"}</button></div></form></section></div>}
    </div>
  );
}
