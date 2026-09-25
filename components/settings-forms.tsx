"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/types";
import { taxYears } from "@/lib/types";

type FieldDef = { name: keyof Settings; label: string; half?: boolean; type?: "text" | "email" | "select" | "textarea" };

const COMPANY: FieldDef[] = [
  { name: "companyName", label: "Company name", half: true },
  { name: "taxYear", label: "Taxation year", half: true, type: "select" },
  { name: "phoneUs", label: "U.S. phone", half: true },
  { name: "phoneIn", label: "India phone", half: true },
  { name: "whatsapp", label: "WhatsApp number", half: true },
  { name: "email", label: "Email", half: true, type: "email" },
  { name: "address", label: "Address" },
];

const WEB: FieldDef[] = [
  { name: "facebook", label: "Facebook", half: true },
  { name: "instagram", label: "Instagram", half: true },
  { name: "linkedin", label: "LinkedIn", half: true },
  { name: "youtube", label: "YouTube", half: true },
  { name: "seoTitle", label: "SEO title" },
  { name: "seoDescription", label: "SEO description", type: "textarea" },
];

function Form({ title, fields, initial }: { title: string; fields: FieldDef[]; initial: Settings }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok && json.ok ? { ok: true, text: "Saved." } : { ok: false, text: json.error || "Could not save." });
    if (res.ok) router.refresh();
  };

  return (
    <form className="card card-pad" onSubmit={submit}>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{title}</h2>
      <div className="grid grid-2" style={{ gap: "0 14px" }}>
        {fields.map((f) => (
          <div className="field" key={f.name} style={f.half ? undefined : { gridColumn: "1 / -1" }}>
            <label htmlFor={`s-${f.name}`}>{f.label}</label>
            {f.type === "select" ? (
              <select id={`s-${f.name}`} name={f.name} defaultValue={String(initial[f.name] ?? "")}>
                {taxYears().map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea id={`s-${f.name}`} name={f.name} defaultValue={String(initial[f.name] ?? "")} />
            ) : (
              <input id={`s-${f.name}`} name={f.name} type={f.type || "text"} defaultValue={String(initial[f.name] ?? "")} />
            )}
          </div>
        ))}
      </div>
      <div className="flex">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : null} Save
        </button>
        {msg && <span style={{ color: msg.ok ? "var(--ok)" : "var(--danger)", fontSize: 14 }}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function SettingsForms({ initial }: { initial: Settings }) {
  return (
    <div className="grid grid-2">
      <Form title="Company & contact" fields={COMPANY} initial={initial} />
      <div className="stack">
        <Form title="Social links & SEO" fields={WEB} initial={initial} />
        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Admin password</h2>
          <p className="muted" style={{ fontSize: 14, margin: "0 0 10px" }}>
            Passwords are stored as scrypt hashes in <code>data/db.json</code>. To change the admin password, set
            <code> ADMIN_PASSWORD</code> in <code>.env.local</code> and delete <code>data/db.json</code> to re-seed, or add a
            password-change endpoint under <code>app/api/</code> (see README).
          </p>
        </div>
      </div>
    </div>
  );
}
