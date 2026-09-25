"use client";

import { useCallback, useEffect, useState } from "react";
import { LIVE_EVENT, type LiveChange } from "./live-updates";

type Handoff = {
  id: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  from: string;
  to: string;
  status: string;
  note: string;
  reason: string;
  requestedBy: string;
  decidedBy: string;
  createdAt: string;
  decidedAt: string | null;
};

const fmt = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS: Record<string, [string, string]> = {
  pending: ["badge-brand", "Awaiting approval"],
  approved: ["badge-ok", "Approved"],
  rejected: ["badge-warn", "Rejected"],
  admin: ["badge-info", "Admin move"],
  cancelled: ["badge-muted", "Cancelled"],
};

/** Pending client moves (Approve / Reject) and the full hand-off history. */
export function Approvals() {
  const [pending, setPending] = useState<Handoff[]>([]);
  const [history, setHistory] = useState<Handoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        fetch("/api/handoffs?status=pending", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/handoffs", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!p.ok) throw new Error(p.error || "Could not load requests.");
      setPending(p.rows);
      setHistory((h.rows ?? []).filter((x: Handoff) => x.status !== "pending"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onLive = (e: Event) => {
      const c = (e as CustomEvent<LiveChange>).detail;
      if (c.collection === "handoffs" || c.collection === "clients") load();
    };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => window.removeEventListener(LIVE_EVENT, onLive);
  }, [load]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    const res = await fetch(`/api/handoffs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason: action === "reject" ? reason : "" }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || !json.ok) return setError(json.error || "Could not update the request.");
    setRejecting(null);
    setReason("");
    await load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Client moves between Document Handlers, Tax Preparers and Reviewers wait here for your approval.</p>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <div className="card-head">
          <h2>
            Waiting for approval <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({pending.length})</span>
          </h2>
        </div>
        {loading ? (
          <div className="loading-row">
            <span className="spinner dark" /> Loading…
          </div>
        ) : pending.length === 0 ? (
          <div className="empty">
            <div className="big">✅</div>
            <p>Nothing waiting. New requests appear here instantly.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Note</th>
                  <th>Requested</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <a href={`/clients/${h.clientId}`}>
                        <strong>{h.clientName}</strong>
                      </a>
                      <br />
                      <small className="mono subtle">{h.clientCode}</small>
                    </td>
                    <td className="mono">{h.from}</td>
                    <td className="mono">
                      <strong>{h.to}</strong>
                    </td>
                    <td>{h.note || <span className="subtle">—</span>}</td>
                    <td>{fmt(h.createdAt)}</td>
                    <td>
                      {rejecting === h.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 280 }}>
                          <input
                            autoFocus
                            placeholder="Reason (shown to the employee)"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <button className="btn btn-secondary btn-sm" disabled={busy === h.id || !reason.trim()} onClick={() => decide(h.id, "reject")}>
                            Reject
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(null)}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="row-actions">
                          <button className="btn btn-primary btn-sm" disabled={busy === h.id} onClick={() => decide(h.id, "approve")}>
                            ✓ Approve
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setRejecting(h.id);
                              setReason("");
                            }}
                          >
                            Reject…
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <h2>History</h2>
        </div>
        {history.length === 0 ? (
          <div className="empty">
            <p>No moves yet.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Move</th>
                  <th>Result</th>
                  <th>By</th>
                  <th>Note / reason</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const [cls, label] = STATUS[h.status] ?? ["badge-muted", h.status];
                  return (
                    <tr key={h.id}>
                      <td>
                        <a href={`/clients/${h.clientId}`}>{h.clientName}</a> <small className="mono subtle">{h.clientCode}</small>
                      </td>
                      <td className="mono">
                        {h.from} → {h.to}
                      </td>
                      <td>
                        <span className={`badge ${cls}`}>{label}</span>
                      </td>
                      <td className="mono">
                        {h.requestedBy}
                        {h.decidedBy && h.decidedBy !== h.requestedBy ? ` / ${h.decidedBy}` : ""}
                      </td>
                      <td>{[h.note, h.reason].filter(Boolean).join(" — ") || <span className="subtle">—</span>}</td>
                      <td>{fmt(h.decidedAt || h.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
