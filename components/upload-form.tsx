"use client";

import { useEffect, useState } from "react";
import { Modal } from "./modal";
import type { Client } from "@/lib/types";
import { taxYears } from "@/lib/types";

/** Uploads a real file to POST /api/uploads and creates the document record. */
export function UploadForm({
  kind,
  clientId,
  onClose,
  onDone,
}: {
  kind: "upload" | "draft" | "final";
  clientId?: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState(clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setClients(j.rows))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = new FormData(e.currentTarget);
    body.set("kind", kind);
    if (!(body.get("file") as File)?.size) return setError("Choose a file first.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/uploads", { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.ok) return setError(json.error || "Upload failed.");
    await onDone();
  };

  const title = kind === "draft" ? "Share draft estimation" : kind === "final" ? "Share final document" : "Upload client document";

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="u-client">Client</label>
          <select id="u-client" name="clientId" value={selected} onChange={(e) => setSelected(e.target.value)} required>
            <option value="">Select a client…</option>
            {/* keeps the pre-selected client valid while the list loads */}
            {selected && !clients.some((c) => c.id === selected) && <option value={selected}>Loading client…</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName} ({c.clientId})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-2" style={{ gap: "0 14px" }}>
          <div className="field">
            <label htmlFor="u-year">Tax year</label>
            <select id="u-year" name="taxYear" defaultValue={taxYears()[1]}>
              {taxYears().map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-type">Document label</label>
            <input id="u-type" name="type" defaultValue={kind === "final" ? "Final return" : kind === "draft" ? "Draft estimation" : "Client upload"} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="u-file">File</label>
          <input id="u-file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,.xls,.xlsx,.csv" required />
          <p className="hint">PDF, JPG, PNG, HEIC, DOC(X), XLS(X) or CSV · up to 15 MB</p>
        </div>
        <div className="field">
          <label htmlFor="u-note">Note to client</label>
          <textarea id="u-note" name="note" placeholder="e.g. Estimated federal refund $2,140. Please confirm your dependents." />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-foot" style={{ margin: "14px -20px -20px", borderRadius: 0 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : null} Upload &amp; share
          </button>
        </div>
      </form>
    </Modal>
  );
}
