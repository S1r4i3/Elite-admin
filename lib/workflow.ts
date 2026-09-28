import "server-only";
import { sb, supabaseEnabled } from "./supabase";
import { list, log } from "./db";
import type { Access } from "./access";
import type { Client, Employee } from "./types";
import {
  MOVE_TARGETS,
  STAGE_FOR_ROLE,
  normalizeRole,
  prepLabel,
  WF_ACTIONS,
  STAGE_LABEL,
  type Stage,
  type WfAction,
  type StaffMember,
} from "./workflow-shared";

/**
 * Client hand-offs between employees, approved by an Admin (manager).
 *
 *  requestMove  — the current holder asks to move a client on (DH → TP, TP → Reviewer, Reviewer → Filed, or back).
 *                 The client stays with them, marked "Awaiting manager approval".
 *  decideMove   — an Admin approves (client moves to the new person) or rejects (stays, reason shown).
 *  adminMove    — an Admin moves/assigns any client directly (recorded as an Admin move).
 *
 * Every step is written to public.client_handoffs — the audit trail.
 */

export class WorkflowError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const fail = (where: string, error: { message: string } | null) => {
  if (error) throw new Error(`[workflow] ${where}: ${error.message}`);
};

/** Active staff with their queue codes (DH1, TP1…). */
export async function getStaff(): Promise<StaffMember[]> {
  const employees = await list<Employee>("employees");
  return employees
    .filter((e) => e.status === "active")
    .map((e) => ({ email: e.email.toLowerCase(), name: e.name, role: normalizeRole(e.role), code: e.code || "" }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function codeLookup(staff: StaffMember[]) {
  const map = new Map(staff.map((s) => [s.email, s.code || s.name || s.email]));
  return (email?: string | null) => (email ? map.get(email.toLowerCase()) ?? email : "—");
}

/** Adds holderCode + prepStatus (the "Preparation status" column) to client rows. */
export async function decorateClients<T extends Client>(rows: T[]): Promise<T[]> {
  const codeOf = codeLookup(await getStaff());
  return rows.map((c) => ({ ...c, holderCode: c.assignedTo ? codeOf(c.assignedTo) : "", prepStatus: prepLabel(c, codeOf) }));
}

async function loadClient(clientId: string) {
  const { data, error } = await sb().from("profiles").select("*").eq("id", clientId).maybeSingle();
  fail("load client", error);
  if (!data) throw new WorkflowError("Client not found.", 404);
  return data as Record<string, string | null>;
}

const clientName = (c: Record<string, string | null>) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "client";

/** Resolve a target ("closed", "unassigned" or an employee email) to { email, stage, role }. */
function resolveTarget(to: string, staff: StaffMember[]) {
  const t = to.trim().toLowerCase();
  if (t === "closed" || t === "filed") return { email: null as string | null, stage: "closed" as Stage, member: null };
  if (t === "unassigned" || t === "") return { email: null, stage: "unassigned" as Stage, member: null };
  const member = staff.find((s) => s.email === t);
  if (!member) throw new WorkflowError("That employee doesn't exist or is inactive.");
  const stage = STAGE_FOR_ROLE[member.role];
  if (!stage) throw new WorkflowError("Clients can only be moved to a Document Handler, Tax Preparer, Tax Reviewer or Tax Filer.");
  return { email: member.email, stage, member };
}

/** An employee asks the manager to move a client they hold. */
export async function requestMove(a: Access, clientId: string, to: string, note = "") {
  if (!supabaseEnabled()) throw new WorkflowError("Hand-offs need the live Supabase connection.", 503);
  if (a.isSuper) return adminMove(a, clientId, to, note);

  const client = await loadClient(clientId);
  if ((client.assigned_to ?? "").toLowerCase() !== a.email) throw new WorkflowError("Only the person currently holding this client can move it.", 403);
  if (client.pending_to || client.pending_stage) throw new WorkflowError("A move for this client is already waiting for manager approval.");

  const staff = await getStaff();
  const target = resolveTarget(to, staff);
  const rules = MOVE_TARGETS[a.role];
  const allowed = !!(target.member && rules?.roles.includes(target.member.role));
  if (!allowed) throw new WorkflowError(`A ${a.role} can't move a client there.`);
  if (a.role === "Document Handler" && target.member?.role === "Tax Preparer" && client.doc_status !== "received") {
    throw new WorkflowError('Set Doc status to "Docs received" before moving this client to a Tax Preparer.');
  }

  const now = new Date().toISOString();
  const { error: e1 } = await sb().from("client_handoffs").insert({
    client_id: clientId,
    from_email: a.email,
    to_email: target.email,
    from_stage: client.stage,
    to_stage: target.stage,
    status: "pending",
    note: note || null,
    requested_by: a.email,
  });
  fail("request", e1);
  const { error: e2 } = await sb()
    .from("profiles")
    .update({ pending_to: target.email, pending_stage: target.stage, pending_by: a.email, pending_note: note || null, pending_at: now, reject_reason: null })
    .eq("id", clientId);
  fail("mark pending", e2);
  const codeOf = codeLookup(staff);
  await log(a.email, "Requested move", `${clientName(client)} → ${target.stage === "closed" ? "Closed" : codeOf(target.email)}`);
}

/** Admin approves or rejects a pending hand-off. */
export async function decideMove(a: Access, handoffId: string, approve: boolean, reason = "") {
  if (!a.isSuper) throw new WorkflowError("Only a manager (Admin) can approve moves.", 403);
  const { data: h, error } = await sb().from("client_handoffs").select("*").eq("id", handoffId).maybeSingle();
  fail("load handoff", error);
  if (!h) throw new WorkflowError("Request not found.", 404);
  if (h.status !== "pending") throw new WorkflowError("This request was already decided.");
  if (!approve && !reason.trim()) throw new WorkflowError("Please give a reason for rejecting.");

  const client = await loadClient(h.client_id);
  const now = new Date().toISOString();
  const clear = { pending_to: null, pending_stage: null, pending_by: null, pending_note: null, pending_at: null };

  if (approve) {
    const holder = h.to_stage === "closed" || h.to_stage === "filed" ? client.assigned_to : h.to_email; // a closed client stays visible to its last holder
    const { error: e1 } = await sb()
      .from("profiles")
      .update({ ...clear, assigned_to: holder, stage: h.to_stage, reject_reason: null })
      .eq("id", h.client_id);
    fail("apply move", e1);
  } else {
    const { error: e1 } = await sb().from("profiles").update({ ...clear, reject_reason: reason.trim() }).eq("id", h.client_id);
    fail("reject move", e1);
  }
  const { error: e2 } = await sb()
    .from("client_handoffs")
    .update({ status: approve ? "approved" : "rejected", decided_by: a.email, decided_at: now, reason: reason.trim() || null })
    .eq("id", handoffId);
  fail("close request", e2);
  await log(a.email, approve ? "Approved move" : "Rejected move", `${clientName(client)}${approve ? "" : ` — ${reason.trim()}`}`);
}

/** Admin assigns / moves a client directly (no approval needed). */
export async function adminMove(a: Access, clientId: string, to: string, note = "") {
  if (!a.isSuper) throw new WorkflowError("Only an Admin can move clients directly.", 403);
  if (!supabaseEnabled()) throw new WorkflowError("Hand-offs need the live Supabase connection.", 503);
  const client = await loadClient(clientId);
  const staff = await getStaff();
  const target = resolveTarget(to, staff);
  const now = new Date().toISOString();

  // Any request that was waiting is superseded by the Admin's decision.
  await sb().from("client_handoffs").update({ status: "cancelled", decided_by: a.email, decided_at: now, reason: "Superseded by an Admin move" }).eq("client_id", clientId).eq("status", "pending");

  const holder = target.stage === "closed" ? client.assigned_to : target.email;
  const { error: e1 } = await sb()
    .from("profiles")
    .update({ assigned_to: holder, stage: target.stage, pending_to: null, pending_stage: null, pending_by: null, pending_note: null, pending_at: null, reject_reason: null })
    .eq("id", clientId);
  fail("admin move", e1);
  const { error: e2 } = await sb().from("client_handoffs").insert({
    client_id: clientId,
    from_email: client.assigned_to,
    to_email: target.email,
    from_stage: client.stage,
    to_stage: target.stage,
    status: "admin",
    note: note || null,
    requested_by: a.email,
    decided_by: a.email,
    decided_at: now,
  });
  fail("record admin move", e2);
  const codeOf = codeLookup(staff);
  await log(a.email, "Moved client", `${clientName(client)} → ${target.stage === "closed" ? "Closed" : target.stage === "unassigned" ? "Unassigned" : codeOf(target.email)}`);
}

export type HandoffView = {
  id: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  from: string;
  to: string;
  toStage: string;
  status: string;
  action: string;
  actionLabel: string;
  note: string;
  reason: string;
  requestedBy: string;
  decidedBy: string;
  createdAt: string;
  decidedAt: string | null;
};

/** Hand-off history (optionally for one client, or only pending ones). */
export async function listHandoffs(opts: { clientId?: string; status?: string; limit?: number } = {}): Promise<HandoffView[]> {
  if (!supabaseEnabled()) return [];
  let q = sb().from("client_handoffs").select("*, profiles(first_name,last_name,email,client_id)").order("created_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  fail("list handoffs", error);
  const codeOf = codeLookup(await getStaff());
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((h: any) => ({
    id: h.id,
    clientId: h.client_id,
    clientName: [h.profiles?.first_name, h.profiles?.last_name].filter(Boolean).join(" ") || h.profiles?.email || "—",
    clientCode: h.profiles?.client_id ?? "",
    from: h.from_email ? codeOf(h.from_email) : "—",
    to: h.to_email ? codeOf(h.to_email) : STAGE_LABEL[h.to_stage as Stage] ?? h.to_stage,
    toStage: h.to_stage,
    status: h.status,
    action: h.action ?? "",
    actionLabel: h.action ? ACTION_LOG_LABEL[h.action as WfAction] ?? h.action : "",
    note: h.note ?? "",
    reason: h.reason ?? "",
    requestedBy: String(h.action ?? "").startsWith("client_") ? "the client" : codeOf(h.requested_by),
    decidedBy: h.decided_by ? codeOf(h.decided_by) : "",
    createdAt: h.created_at,
    decidedAt: h.decided_at,
  }));
}

/* ── Decisions: review / client / filing / IRS response ─────────────────────────── */

const ACTION_LOG_LABEL: Record<WfAction, string> = {
  review_approve: "Review approved",
  review_changes: "Reviewer requested changes",
  resubmit_review: "Corrections sent back to reviewer",
  client_approve: "Client approved the draft",
  client_reject: "Client requested changes",
  efile: "E-filed",
  irs_accept: "IRS / State accepted",
  irs_reject: "IRS / State rejected",
  close: "Case closed",
};

/**
 * Apply a workflow decision. The rules (who, from which stage, where it goes, who holds it next)
 * are enforced in the database by public.wf_transition — this just calls it and logs the result.
 */
export async function runAction(a: Access, clientId: string, action: WfAction, note = "") {
  if (!supabaseEnabled()) throw new WorkflowError("The workflow needs the live Supabase connection.", 503);
  const def = WF_ACTIONS.find((w) => w.action === action);
  if (!def) throw new WorkflowError("Unknown action.");
  if (def.noteLabel && !note.trim()) throw new WorkflowError("Please add a reason.");
  const client = await loadClient(clientId);
  const { data, error } = await sb().rpc("wf_transition", { p_client: clientId, p_action: action, p_actor: a.email, p_note: note.trim() || null });
  if (error) {
    const msg = error.message.startsWith("WF: ") ? error.message.slice(4) : null;
    if (msg) throw new WorkflowError(msg);
    throw new Error(`[workflow] ${action}: ${error.message}`);
  }
  await log(a.email, ACTION_LOG_LABEL[action], `${clientName(client)}${note.trim() ? ` — ${note.trim()}` : ""}`);
  return data as { ok: boolean; stage: string; assignedTo: string | null };
}
