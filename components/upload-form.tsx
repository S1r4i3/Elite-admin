"use client";

import { useEffect, useState } from "react";
import { Modal } from "./modal";
import type { Client } from "@/lib/types";
import { taxYears } from "@/lib/types";

const MAX_BYTES = 15 * 1024 * 1024;
/** Vercel rejects request bodies above ~4.5 MB, so only small files may go through our API. */
const API_BODY_LIMIT = 4 * 1024 * 1024;

/** PUT the file to a Supabase signed upload URL, reporting progress (0–100). */
function putToStorage(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`storage ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(body);
  });
}

/**
 * Shares a draft estimation / final document / client document.
 * The file goes straight from the browser to storage (signed URL), then the record is created —
 * so files up to 15 MB work in production too.
 */
export function UploadForm({
  kind,
  clientId,
  onClose,
  onDone,
  intro,
}: {
  kind: "upload" | "draft" | "final";
  clientId?: string;
  /** Message shown at the top, e.g. why this upload opened by itself. */
  intro?: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState(clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clientId) return; // opened from a client page — no need for the full list
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setClients(j.rows))
      .catch(() => {});
  }, [clientId]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("kind", kind);
    const file = form.get("file") as File | null;
    if (!file?.size) return setError("Choose a file first.");
    if (file.size > MAX_BYTES) return setError("File is larger than 15 MB.");
    const target = String(form.get("clientId") || "");
    if (!target) return setError("Choose a client.");
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      // 1) ask for a one-time upload URL
      const sign = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: target, name: file.name, size: file.size }),
      });
      const s = await sign.json().catch(() => ({}));
      let res: Response;
      if (sign.ok && s.ok) {
        // 2) send the file straight to storage, 3) record it
        await putToStorage(s.signedUrl, file, setProgress);
        res = await fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: s.key,
            clientId: target,
            kind,
            name: file.name,
            taxYear: form.get("taxYear"),
            type: form.get("type"),
            note: form.get("note"),
          }),
        });
      } else if (sign.status === 501 || (!s.error && file.size <= API_BODY_LIMIT)) {
        res = await fetch("/api/uploads", { method: "POST", body: form }); // local / small-file fallback
      } else {
        throw new Error(s.error || "Could not start the upload.");
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || (res.status === 413 ? "File is too large." : "Upload failed."));
      setProgress(100);
      await onDone();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg === "network" || msg.startsWith("storage") ? "The file couldn't be uploaded — check your connection and try again." : msg);
    } finally {
      setBusy(false);
    }
  };

  const title = kind === "draft" ? "Share draft estimation" : kind === "final" ? "Share final document" : "Upload client document";

  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        {intro && (
          <div className="wf-banner wf-banner-warn" role="alert" style={{ marginBottom: 14 }}>
            <strong>{intro}</strong>
          </div>
        )}
        <div className="field">
          <label htmlFor="u-client">Client</label>
          <select id="u-client" name="clientId" value={selected} onChange={(e) => setSelected(e.target.value)} required disabled={!!clientId}>
            <option value="">Select a client…</option>
            {selected && !clients.some((c) => c.id === selected) && <option value={selected}>{clientId ? "This client" : "Loading client…"}</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName} ({c.clientId})
              </option>
            ))}
          </select>
          {clientId && <input type="hidden" name="clientId" value={clientId} />}
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
        {progress !== null && busy && (
          <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-foot" style={{ margin: "14px -20px -20px", borderRadius: 0 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {busy ? <span className="spinner" /> : null} {busy ? (progress && progress < 100 ? `Uploading ${progress}%` : "Sharing…") : "Upload & share"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
