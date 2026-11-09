"use client";

import { useState, useTransition } from "react";
import { apiJson } from "@/lib/api-client";
import { toast } from "./toaster";
import { useRouter } from "next/navigation";
import { UploadForm } from "./upload-form";
import { availableActions, REWORK_LABEL, STAGES, STAGE_LABEL, type Stage, type WfActionDef } from "@/lib/workflow-shared";

type WfClient = {
  id: string;
  stage?: string | null;
  assignedTo?: string | null;
  pendingTo?: string | null;
  pendingStage?: string | null;
  reworkSource?: string | null;
  reworkReason?: string | null;
  correction?: boolean;
  filingCycle?: number;
};

/** Main (happy) path, in order — the loops are shown as a banner, not as extra steps. */
const PATH: { stage: Stage; short: string; who: string }[] = [
  { stage: "documents", short: "Documents", who: "DH" },
  { stage: "preparation", short: "Preparation", who: "TP" },
  { stage: "review", short: "Tax review", who: "TR" },
  { stage: "client_review", short: "Client approval", who: "Client" },
  { stage: "filing", short: "E-file", who: "TF" },
  { stage: "accepted", short: "Final docs", who: "TF" },
  { stage: "closed", short: "Closed", who: "" },
];

export function WorkflowPath({ client }: { client: WfClient }) {
  const stage = (client.stage === "filed" ? "closed" : client.stage === "irs_pending" ? "accepted" : client.stage || "unassigned") as Stage;
  const at = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <div>
      <ol className="wf-path" aria-label="Workflow progress">
        {PATH.map((p) => {
          const i = STAGES.indexOf(p.stage as (typeof STAGES)[number]);
          const state = i < at ? "done" : i === at ? "current" : "todo";
          return (
            <li key={p.stage} className={`wf-step wf-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="wf-dot">{state === "done" ? "✓" : ""}</span>
              <span className="wf-name">{p.short}</span>
              {p.who && <span className="wf-who">{p.who}</span>}
            </li>
          );
        })}
      </ol>
      {client.reworkSource && (
        <div className="wf-banner wf-banner-warn" role="status">
          <strong>↺ {REWORK_LABEL[client.reworkSource] ?? "Rework"}</strong>
          {client.reworkReason && <span>“{client.reworkReason}”</span>}
          <small>Rework loop: Tax Preparer fixes → same Tax Reviewer checks again.</small>
        </div>
      )}
    </div>
  );
}

export function WorkflowActions({
  client,
  me,
  hasDraft = true,
}: {
  client: WfClient;
  me: { email: string; role: string; isSuper: boolean };
  /** A draft estimation is shared and waiting for the client (needed before "Approve return"). */
  hasDraft?: boolean;
}) {
  const router = useRouter();
  const actions = availableActions(client, me);
  const [open, setOpen] = useState<WfActionDef | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  // Upload that opens by itself: the draft before approving, the final documents after e-filing.
  const [upload, setUpload] = useState<null | { kind: "draft" | "final"; intro: string; then?: WfActionDef }>(null);

  const run = async (def: WfActionDef) => {
    if (def.noteLabel && !note.trim()) return setError("Please add a reason.");
    if (busy) return;
    setBusy(true);
    setRunning(def.action);
    setError(null);
    let json: { stage?: string };
    try {
      json = await apiJson<{ stage?: string }>("/api/workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: client.id, action: def.action, note }),
      });
    } catch (e) {
      const msg = (e as Error).message || "Could not update the workflow.";
      setError(msg);
      toast.error(msg);
      return;
    } finally {
      setBusy(false);
      setRunning(null);
    }
    toast.success(`${def.label} — done.`);
    setOpen(null);
    setNote("");
    setDone(`Done — now: ${STAGE_LABEL[json.stage as Stage] ?? json.stage}`);
    startRefresh(() => router.refresh());
    if (def.action === "efile") {
      setUpload({ kind: "final", intro: "E-filed ✓ — now upload the final documents for the client. Then you can close the case." });
    }
  };

  /** Approve needs a shared draft: if there isn't one, say so and open the draft upload first. */
  const start = (def: WfActionDef) => {
    if (def.action === "review_approve" && !hasDraft && !client.correction) {
      setUpload({
        kind: "draft",
        intro: "No draft estimation yet. Upload it here — the return is approved right after and the client receives it.",
        then: def,
      });
      return;
    }
    if (confirm(`${def.label}?\n\n${def.hint}`)) void run(def);
  };
  const working = busy || refreshing;

  const waitingForClient =
    client.stage === "client_review" ? (
      <p className="hint">
        Waiting for the client to approve or reject the draft in their dashboard. Their decision moves the case automatically.
        {me.isSuper ? " If the client answered by phone or email, record it below." : ""}
      </p>
    ) : null;
  const uploadModal = upload ? (
        <UploadForm
          kind={upload.kind}
          clientId={client.id}
          intro={upload.intro}
          onClose={() => setUpload(null)}
          onDone={async () => {
            const then = upload.then;
            setUpload(null);
            if (then) await run(then); // draft shared → approve the return now
            else startRefresh(() => router.refresh());
          }}
        />
  ) : null;

  if (actions.length === 0)
    return (
      <>
        {done ? <p className="hint">{done}</p> : waitingForClient}
        {uploadModal}
      </>
    );

  return (
    <div className="wf-actions">
      {waitingForClient}
      {me.isSuper && <p className="hint" style={{ marginTop: 0 }}>Admin: you can take any of these actions for the person holding this client.</p>}
      <div className="actions">
        {actions.map((a) => (
          <button
            key={a.action}
            type="button"
            className={`btn btn-sm ${a.tone === "danger" ? "btn-danger" : a.tone === "primary" ? "btn-primary" : "btn-secondary"}`}
            disabled={working}
            aria-busy={running === a.action}
            onClick={() => {
              setError(null);
              if (a.noteLabel) setOpen(open?.action === a.action ? null : a);
              else start(a);
            }}
          >
            {running === a.action && !open ? <span className={`spinner${a.tone === "danger" || a.tone === "primary" ? "" : " dark"}`} aria-hidden /> : null} {a.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="wf-note">{open.noteLabel}</label>
          <textarea id="wf-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={open.hint} />
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(null)} disabled={working}>
              Cancel
            </button>
            <button type="button" className={`btn btn-sm ${open.tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={() => run(open)} disabled={working}>
              {working ? <span className="spinner" /> : null} {busy ? "Saving…" : refreshing ? "Updating…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="hint">{refreshing ? "Saved — updating the page…" : done}</p>}
      {uploadModal}
    </div>
  );
}
