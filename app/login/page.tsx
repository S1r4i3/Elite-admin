"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.ok) return setError(json.error || "Sign-in failed.");
    const next = params.get("next");
    router.replace(next && next.startsWith("/") ? next : "/");
    router.refresh();
  };

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo">
        <img className="logo-mark logo-mark-lg" src="/brand/ebt-mark.png" alt="Elite B Tax Services" width={320} height={162} />
      </div>
      <h1>Elite B Tax Services</h1>
      <p className="muted">Admin Panel</p>

      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="admin@elitebtax.com" />

      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />

      {error && (
        <p className="error" style={{ marginTop: 12 }} role="alert">
          {error}
        </p>
      )}

      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? <span className="spinner" /> : null} Sign in
      </button>
      </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
