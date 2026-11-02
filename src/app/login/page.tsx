"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!configured) {
      setError("AURA belum terhubung ke Supabase. Lengkapi environment variables sesuai README terlebih dahulu.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      await fetch("/api/auth/log-login", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tidak dapat masuk. Periksa email dan password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AURA</span></div>
        <div className="login-story-copy">
          <span className="eyebrow light">AI USER REQUIREMENT</span>
          <h1>Dari usulan<br />menjadi kebutuhan<br /><em>yang lebih jelas.</em></h1>
          <p>Ruang kerja tim ADSI untuk menyusun, meninjau, dan menyempurnakan dokumen project dengan dukungan knowledge base.</p>
        </div>
        <div className="story-foot"><span>01</span><span>Ruang kerja internal</span><span className="story-line" /></div>
      </section>
      <section className="login-panel">
        <div className="login-panel-inner">
          <span className="eyebrow">SELAMAT DATANG</span>
          <h2>Masuk ke AURA</h2>
          <p className="muted">Gunakan akun AURA yang dibuat oleh administrator.</p>
          <form onSubmit={submit} className="login-form">
            <label>Email kerja<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@organisasi.go.id" required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan password" required /></label>
            {error && <div className="alert error">{error}</div>}
            <button className="button primary full" disabled={busy}>{busy ? "Memeriksa akun…" : "Masuk"}<span>→</span></button>
          </form>
          {!configured && <div className="setup-note"><strong>Belum dikonfigurasi</strong><span>Siapkan Supabase dan environment variables di Vercel. Lihat README pada folder aplikasi.</span></div>}
          <div className="login-footer"><span>Akses hanya untuk pengguna yang terdaftar.</span><a href="/preview">Lihat pratinjau</a></div>
        </div>
      </section>
    </main>
  );
}
