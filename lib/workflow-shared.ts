/**
 * Workflow vocabulary shared by the server and the browser.
 *
 *  HAPPY PATH
 *    Client → DH (collect & verify docs) → TP (prepare) → TR (review) → Client review → TF (e-file)
 *      → Accepted (final documents) → Closed
 *
 *  REWORK LOOPS (always back to the same preparer, then the same reviewer)
 *    TR "Request changes"      → TP → TR
 *    Client "Request changes"  → TP → TR → Client review
 *
 * New clients go straight to a Document Handler (least busy). Hand-offs are immediate — no approvals.
 * Admins are never part of the automatic flow, but can step in at any point: every workflow button
 * (including recording the client's decision) and moving any client to anyone.
 * Decisions (review, client, filing, IRS response) are applied by the database function
 * public.wf_transition, which enforces the rules in public.workflow_transitions.
 * A client is visible to exactly one employee at a time (the current holder) plus Admins.
 */

export const ROLES = ["Admin", "Document Handler", "Tax Preparer", "Reviewer", "Tax Filer"] as const;
export type Role = (typeof ROLES)[number];

/** Older role names still found in saved data. */
export const LEGACY_ROLE: Record<string, Role> = {
  "Super Admin": "Admin",
  Associate: "Document Handler",
  Preparer: "Tax Preparer",
  "Tax Reviewer": "Reviewer",
  Filer: "Tax Filer",
};
export const normalizeRole = (r: unknown): Role => {
  const s = String(r ?? "");
  return (ROLES as readonly string[]).includes(s) ? (s as Role) : LEGACY_ROLE[s] ?? "Document Handler";
};
export const isAdminRole = (r: unknown) => normalizeRole(r) === "Admin";

/** Short code prefix per role: DH1, TP1, RV1 (Tax Reviewer), TF1, AD1. */
export const ROLE_PREFIX: Record<Role, string> = { Admin: "AD", "Document Handler": "DH", "Tax Preparer": "TP", Reviewer: "RV", "Tax Filer": "TF" };

/** "DH1 · Document Handler" — code plus full role name, used everywhere a person is shown. */
export const staffLabel = (s: { code?: string | null; role: string; name?: string | null; email?: string | null }) => {
  const role = ROLE_LABEL[normalizeRole(s.role)];
  return s.code ? `${s.code} · ${role}` : `${s.name || s.email || "—"} · ${role}`;
};

/** Friendly role names for screens. */
export const ROLE_LABEL: Record<Role, string> = {
  Admin: "Admin",
  "Document Handler": "Document Handler",
  "Tax Preparer": "Tax Preparer",
  Reviewer: "Tax Reviewer",
  "Tax Filer": "Tax Filer",
};

export const STAGES = ["unassigned", "documents", "preparation", "review", "client_review", "filing", "irs_pending", "accepted", "closed"] as const;
export type Stage = (typeof STAGES)[number] | "filed";
export type DocStatus = "pending" | "received";

/** Which stage a client is in while a person with this role holds it. */
export const STAGE_FOR_ROLE: Partial<Record<Role, Stage>> = {
  "Document Handler": "documents",
  "Tax Preparer": "preparation",
  Reviewer: "review",
  "Tax Filer": "filing",
};

export const STAGE_LABEL: Record<Stage, string> = {
  unassigned: "Not assigned",
  documents: "Collecting documents",
  preparation: "In preparation",
  review: "In tax review",
  client_review: "Waiting for client approval",
  filing: "Ready to e-file",
  irs_pending: "E-filed — send final documents",
  accepted: "E-filed — send final documents",
  closed: "Closed",
  filed: "Closed",
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  pending: "Docs pending",
  received: "Docs received",
};

/** Forward hand-offs an employee may request (manager approves). Decisions are in WF_ACTIONS. */
export const MOVE_TARGETS: Partial<Record<Role, { roles: Role[] }>> = {
  "Document Handler": { roles: ["Tax Preparer"] },
  "Tax Preparer": { roles: ["Reviewer", "Document Handler"] },
};

/** Decision actions — must match public.workflow_transitions. */
export type WfAction =
  | "review_approve"
  | "review_changes"
  | "resubmit_review"
  | "client_approve"
  | "client_reject"
  | "efile"
  | "close";

export type WfActionDef = {
  action: WfAction;
  stage: Stage;
  role: Role | "client";
  label: string;
  hint: string;
  tone: "primary" | "danger" | "secondary";
  noteLabel?: string; // present = a reason is required
  when?: (c: { rework_source?: string | null; reworkSource?: string | null; correction?: boolean | null }) => boolean;
};

export const WF_ACTIONS: WfActionDef[] = [
  {
    action: "resubmit_review",
    stage: "preparation",
    role: "Tax Preparer",
    label: "Corrections done → back to reviewer",
    hint: "Sends the client straight back to the same Tax Reviewer (no manager approval needed).",
    tone: "primary",
    when: (c) => Boolean(c.reworkSource ?? c.rework_source),
  },
  {
    action: "review_approve",
    stage: "review",
    role: "Reviewer",
    label: "Approve return",
    hint: "Goes to the client for approval. Share the draft with the client first (Drafts → Upload).",
    tone: "primary",
  },
  {
    action: "review_changes",
    stage: "review",
    role: "Reviewer",
    label: "Request changes → preparer",
    hint: "Returns the client to the same Tax Preparer with your notes.",
    tone: "danger",
    noteLabel: "What needs to change?",
  },
  {
    action: "client_approve",
    stage: "client_review",
    role: "client",
    label: "Client approved (record for client)",
    hint: "Use when the client approved by phone or email. Moves the case to a Tax Filer.",
    tone: "primary",
  },
  {
    action: "client_reject",
    stage: "client_review",
    role: "client",
    label: "Client wants changes (record for client)",
    hint: "Returns the client to the same Tax Preparer with the client's notes.",
    tone: "danger",
    noteLabel: "What does the client want changed?",
  },
  {
    action: "efile",
    stage: "filing",
    role: "Tax Filer",
    label: "Mark as e-filed",
    hint: "The return has been transmitted. Next: upload the final documents for the client, then close.",
    tone: "primary",
  },
  {
    action: "close",
    stage: "accepted",
    role: "Tax Filer",
    label: "Close case",
    hint: "Needs at least one final document shared with the client.",
    tone: "primary",
  },
];

/** Actions this person can take on this client right now. */
export function availableActions(
  c: { stage?: string | null; assignedTo?: string | null; pendingTo?: string | null; pendingStage?: string | null; reworkSource?: string | null; correction?: boolean | null },
  me: { email: string; role: string; isSuper: boolean },
) {
  if (c.pendingTo || c.pendingStage) return [];
  // Admins can take every action at the client's current stage, whoever holds it.
  if (me.isSuper) return WF_ACTIONS.filter((a) => a.stage === c.stage && (!a.when || a.when(c)));
  const holder = String(c.assignedTo ?? "").toLowerCase() === me.email.toLowerCase();
  if (!me.isSuper && !holder) return [];
  const role = normalizeRole(me.role);
  return WF_ACTIONS.filter((a) => a.stage === c.stage && a.role !== "client" && (me.isSuper || a.role === role) && (!a.when || a.when(c)));
}

export const REWORK_LABEL: Record<string, string> = {
  review: "Returned by Tax Reviewer",
  client: "Client requested changes",
};

export type StaffMember = { email: string; name: string; role: Role; code: string };

/** The "Preparation status" text shown in the tables. */
export function prepLabel(
  c: {
    stage?: string | null;
    pendingTo?: string | null;
    pendingStage?: string | null;
    rejectReason?: string | null;
    assignedTo?: string | null;
    reworkSource?: string | null;
    correction?: boolean | null;
  },
  codeOf: (email?: string | null) => string,
) {
  if (c.pendingTo || c.pendingStage) {
    const to = c.pendingStage === "closed" || c.pendingStage === "filed" ? "Closed" : codeOf(c.pendingTo);
    return `Awaiting manager approval → ${to}`;
  }
  if (c.rejectReason) return `Move rejected: ${c.rejectReason}`;
  const stage = (c.stage || "unassigned") as Stage;
  const who = codeOf(c.assignedTo);
  const rework = c.reworkSource ? ` — ${REWORK_LABEL[c.reworkSource] ?? "Rework"}` : "";
  switch (stage) {
    case "unassigned":
      return "Not assigned";
    case "documents":
      return `With ${who} — collecting documents`;
    case "preparation":
      return `With ${who} — preparing${rework}`;
    case "review":
      return `With ${who} — tax review`;
    case "client_review":
      return "Waiting for client to approve the draft";
    case "filing":
      return c.assignedTo ? `With ${who} — ready to e-file` : "Ready to e-file — assign a Tax Filer";
    case "irs_pending":
    case "accepted":
      return `E-filed — ${who} to send final documents`;
    default:
      return "Closed";
  }
}
