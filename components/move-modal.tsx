"use client";

import { useMemo, useState } from "react";
import { Modal } from "./modal";
import { MOVE_TARGETS, normalizeRole, type StaffMember } from "@/lib/workflow-shared";

type Target = { value: string; label: string };

/**
 * "Move to" for one client.
 * Employees pick from the people their role may hand off to — the move then waits for manager approval.
 * Admins can move to anyone (or Filed / Unassigned) immediately.
 */
export function MoveModal({
  client,
  me,
  staff,
  onClose,
  onDone,
}: {
  client: { id: string; name: string; clientId?: string; assignedTo?: string | null };
  me: { email: string; role: string; isSuper: boolean };
  staff: StaffMember[];
  onClose: () => void;
  onDone: (pending: boolean) => void;
}) {
  const targets = useMemo<Target[]>(() => {
    const holder = String(client.assignedTo || "").toLowerCase();
    const label = (s: StaffMember) => `${s.code || "—"} · ${s.name} (${s.role})`;
    if (me.isSuper) {
      return [
        ...staff.filter((s) => s.role !== "Admin" && s.email !== holder).map((s) => ({ value: s.email, label: label(s) })),
        { value: "filed", label: "✔ Filed (complete)" },
        { value: "unassigned", label: "Unassigned" },
      ];
    }
    const rules = MOVE_TARGETS[normalizeRole(me.role)];
    const list: Target[] = staff.filter((s) => rules?.roles.includes(s.role) && s.email !== me.email).map((s) => ({ value: s.email, label: label(s) }));
    if (rules?.filed) list.push({ value: "filed", label: "✔ Filed (complete)" });
    return list;
  }, [client.assignedTo, me, staff]);

  const [to, setTo] = useState(targets[0]?.value ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/handoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: client.id, to, note }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.ok) return setError(json.error || "Could not move the client.");
    onDone(Boolean(json.pending));
  };

  return (
    <Modal title={`Move ${client.name}${client.clientId ? ` (${client.clientId})` : ""}`} onClose={onClose}>
      <form onSubmit={submit}>
        {targets.length === 0 ? (
          <p className="muted">There is nobody you can move this client to yet. Ask an Admin to add staff with the right role.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="move-to">Move to</label>
              <select id="move-to" value={to} onChange={(e) => setTo(e.target.value)} required>
                {targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="move-note">Note (optional)</label>
              <textarea id="move-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person or the manager should know" maxLength={500} />
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {me.isSuper
                ? "As an Admin, the client moves immediately. The move is recorded in the client's history."
                : "Your manager must approve this move. Until then the client stays with you as “Awaiting manager approval”."}
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || targets.length === 0}>
            {busy ? "…" : me.isSuper ? "Move now" : "Request move"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
