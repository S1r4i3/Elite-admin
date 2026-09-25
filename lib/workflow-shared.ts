/**
 * Workflow vocabulary shared by the server and the browser.
 *
 *   Client registers → Admin assigns to a Document Handler (DH1)
 *   DH collects documents (Doc status: pending → partial → received)
 *   DH "Move to TP1" → awaiting manager approval → Admin approves → client moves to TP1
 *   TP prepares → "Move to Reviewer" → Admin approves → Reviewer → … → Filed
 *
 * A client is visible to exactly one employee at a time (the current holder) plus Admins.
 */

export const ROLES = ["Admin", "Document Handler", "Tax Preparer", "Reviewer"] as const;
export type Role = (typeof ROLES)[number];

/** Older role names still found in saved data. */
export const LEGACY_ROLE: Record<string, Role> = {
  "Super Admin": "Admin",
  Associate: "Document Handler",
  Preparer: "Tax Preparer",
};
export const normalizeRole = (r: unknown): Role => {
  const s = String(r ?? "");
  return (ROLES as readonly string[]).includes(s) ? (s as Role) : LEGACY_ROLE[s] ?? "Document Handler";
};
export const isAdminRole = (r: unknown) => normalizeRole(r) === "Admin";

/** Short code prefix per role: DH1, TP1, RV1, AD1. */
export const ROLE_PREFIX: Record<Role, string> = { Admin: "AD", "Document Handler": "DH", "Tax Preparer": "TP", Reviewer: "RV" };

export type Stage = "unassigned" | "documents" | "preparation" | "review" | "filed";
export type DocStatus = "pending" | "partial" | "received";

/** Which stage a client is in while a person with this role holds it. */
export const STAGE_FOR_ROLE: Partial<Record<Role, Stage>> = {
  "Document Handler": "documents",
  "Tax Preparer": "preparation",
  Reviewer: "review",
};

export const STAGE_LABEL: Record<Stage, string> = {
  unassigned: "Not assigned",
  documents: "Collecting documents",
  preparation: "In preparation",
  review: "In review",
  filed: "Filed",
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  pending: "Docs pending",
  partial: "Docs partially received",
  received: "Docs received",
};

/** Who each role may request to move a client to (before Admin approval). */
export const MOVE_TARGETS: Partial<Record<Role, { roles: Role[]; filed?: boolean }>> = {
  "Document Handler": { roles: ["Tax Preparer"] },
  "Tax Preparer": { roles: ["Reviewer", "Document Handler"] },
  Reviewer: { roles: ["Tax Preparer"], filed: true },
};

export type StaffMember = { email: string; name: string; role: Role; code: string };

/** The "Preparation status" text shown in the tables. */
export function prepLabel(c: {
  stage?: string | null;
  pendingTo?: string | null;
  pendingStage?: string | null;
  rejectReason?: string | null;
  assignedTo?: string | null;
}, codeOf: (email?: string | null) => string) {
  if (c.pendingTo || c.pendingStage === "filed") {
    const to = c.pendingStage === "filed" ? "Filed" : codeOf(c.pendingTo);
    return `Awaiting manager approval → ${to}`;
  }
  if (c.rejectReason) return `Move rejected: ${c.rejectReason}`;
  const stage = (c.stage || "unassigned") as Stage;
  if (stage === "unassigned") return "Not assigned";
  if (stage === "filed") return "Filed";
  if (stage === "documents") return `With ${codeOf(c.assignedTo)} — collecting documents`;
  return `Moved to ${codeOf(c.assignedTo)}`;
}
