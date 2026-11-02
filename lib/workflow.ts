import { cache } from "react";
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
  staffLabel,
  type Stage,
  type WfAction,
  type StaffMember,
} from "./workflow-shared";

/**
 * Client hand-offs between employees — immediate, no approval step.
 *
 *  New clients are assigned to a Document Handler automatically by the database (wf_assign_new_client).
 *  requestMove  — the current holder hands the client on (DH → TP, TP → TR, TP → DH). Applied at once.
 *  runAction    — review / client / filing decisions (database function wf_transition).
 *  adminMove    — an Admin moves any client to anyone. Admins are never in the automatic flow but can step in anytime.
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
/** Active staff, sorted by queue code. Deduplicated per request (React cache) — several helpers ask for it on one page. */
export const getStaff = cache(async (): Promise<StaffMember[]> => {
  const employees = await list<Employee>("employees");
  return employees
    .filter((e) => e.status === "active")
    .map((e) => ({ email: e.email.toLowerCase(), name: e.name, role: normalizeRole(e.role), code: e.code || "" }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
});

export function codeLookup(staff: StaffMember[]) {
  const map = new Map(staff.map((s) => [s.email, staffLabel(s)]));
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

/** An employee hands a client they hold on to the next person — applied immediately (no approval step). */
export async function requestMove(a: Access, clientId: string, to: string, note = "") {
  if (!supabaseEnabled()) throw new WorkflowError("Hand-offs need the live Supabase connection.", 503);
  if (a.isSuper) return adminMove(a, clientId, to, note);

  const client = await loadClient(clientId);
  if ((client.assigned_to ?? "").toLowerCase() !== a.email) throw new WorkflowError("Only the person currently holding this client can move it.", 403);

  const staff = await getStaff();
  const target = resolveTarget(to, staff);
  const rules = MOVE_TARGETS[a.role];
  const allowed = !!(target.member && rules?.roles.includes(target.member.role));
  if (!allowed) throw new WorkflowError(`A ${a.role} can't move a client there.`);
  if (a.role === "Document Handler" && target.member?.role === "Tax Preparer" && client.doc_status !== "received") {
    throw new WorkflowError('Set Doc status to "Docs received" before moving this client to a Tax Preparer.');
  }

  const now = new Date().toISOString();
  const { error: e1 } = await sb()
    .from("profiles")
    .update({ assigned_to: target.email, stage: target.stage, pending_to: null, pending_stage: null, pending_by: null, pending_note: null, pending_at: null, reject_reason: null })
    .eq("id", clientId);
  fail("move", e1);
  const { error: e2 } = await sb().from("client_handoffs").insert({
    client_id: clientId,
    from_email: a.email,
    to_email: target.email,
    from_stage: client.stage,
    to_stage: target.stage,
    status: "auto",
    action: "handoff",
    note: note || null,
    requested_by: a.email,
    decided_by: a.email,
    decided_at: now,
  });
  fail("record move", e2);
  const codeOf = codeLookup(staff);
  await log(a.email, "Moved client", `${clientName(client)} → ${codeOf(target.email)}`);
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
export async function listHandoffs(opts: { clientId?: string; status?: string; limit?: number; email?: string } = {}): Promise<HandoffView[]> {
  if (!supabaseEnabled()) return [];
  let q = sb().from("client_handoffs").select("*, profiles(first_name,last_name,email,client_id)").order("created_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.email) {
    const e = opts.email.toLowerCase().replace(/[^a-z0-9@._+-]/g, "");
    q = q.or(`from_email.eq.${e},to_email.eq.${e},requested_by.eq.${e}`);
  }
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
    actionLabel: h.action ? ACTION_LOG_LABEL[h.action] ?? h.action : "",
    note: h.note ?? "",
    reason: h.reason ?? "",
    requestedBy:
      h.requested_by === "system"
        ? "the system"
        : String(h.action ?? "").startsWith("client_")
          ? codeOf(h.requested_by) === h.requested_by ? "the client" : `${codeOf(h.requested_by)} (for the client)`
          : codeOf(h.requested_by),
    decidedBy: h.decided_by ? codeOf(h.decided_by) : "",
    createdAt: h.created_at,
    decidedAt: h.decided_at,
  }));
}

/* ── Decisions: review / client / filing ─────────────────────────────────────── */

const ACTION_LOG_LABEL: Record<string, string> = {
  handoff: "Handed over",
  auto_assign: "Assigned automatically",
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
  const onBehalf = a.isSuper && def.role === "client" ? " (recorded by Admin for the client)" : "";
  await log(a.email, ACTION_LOG_LABEL[action] + onBehalf, `${clientName(client)}${note.trim() ? ` — ${note.trim()}` : ""}`);
  return data as { ok: boolean; stage: string; assignedTo: string | null };
}

/* ── Employee workload ─────────────────────────────────────────────────────── */

export type EmployeeStats = { currentClients: number; totalClients: number; moves: number };

/**
 * Per employee (by email): clients they hold right now (not closed), how many different clients
 * they have ever held, and how many moves / actions they made.
 */
export async function employeeStats(): Promise<Map<string, EmployeeStats>> {
  const out = new Map<string, EmployeeStats>();
  if (!supabaseEnabled()) return out;
  const [{ data: clients, error: e1 }, { data: moves, error: e2 }] = await Promise.all([
    sb().from("profiles").select("id, assigned_to, stage"),
    sb().from("client_handoffs").select("client_id, to_email, requested_by").limit(20000),
  ]);
  fail("employee stats (clients)", e1);
  fail("employee stats (moves)", e2);
  const held = new Map<string, Set<string>>();
  const get = (email: string) => {
    if (!out.has(email)) out.set(email, { currentClients: 0, totalClients: 0, moves: 0 });
    return out.get(email)!;
  };
  const mark = (email: string | null | undefined, clientId: string) => {
    const e = String(email ?? "").toLowerCase();
    if (!e) return;
    if (!held.has(e)) held.set(e, new Set());
    held.get(e)!.add(clientId);
  };
  for (const c of clients ?? []) {
    mark(c.assigned_to, c.id);
    if (c.assigned_to && c.stage !== "closed" && c.stage !== "filed") get(String(c.assigned_to).toLowerCase()).currentClients++;
  }
  for (const m of moves ?? []) {
    mark(m.to_email, m.client_id);
    const by = String(m.requested_by ?? "").toLowerCase();
    if (by && by !== "system") get(by).moves++;
  }
  for (const [email, set] of held) get(email).totalClients = set.size;
  return out;
}
