import "server-only";
import { cache } from "react";
import { currentAdmin } from "./auth";
import { clientIdsFor, findEmployeeByEmail } from "./db";
import type { Client, Collection, DocumentRow, Row } from "./types";
import { isAdminRole, normalizeRole, type Role } from "./workflow-shared";

/**
 * Who is signed in and what they may see.
 *  • Admin — everything (manager: approves every hand-off).
 *  • Any other employee — only the clients assigned to them (Client → "Assigned employee"),
 *    plus those clients' documents, draft estimations and final documents.
 */
export type Access = { id: string; email: string; name: string; role: Role; code: string; isSuper: boolean };

/** Collections an employee (non Super Admin) can use. */
export const EMPLOYEE_COLLECTIONS: Collection[] = ["clients", "documents"];

/** Cached per request, so a page and its layout share one lookup. */
export const getAccess = cache(async function getAccess(): Promise<Access | null> {
  const session = await currentAdmin();
  if (!session) return null;
  const emp = await findEmployeeByEmail(session.email);
  if (!emp || emp.status !== "active") return null;
  const role = normalizeRole(emp.role);
  return { id: emp.id, email: emp.email.toLowerCase(), name: emp.name, role, code: emp.code || "", isSuper: isAdminRole(role) };
});

/** Like getAccess() but throws a 401/403 Response for API routes. */
export async function requireAccess(coll?: Collection): Promise<Access> {
  const a = await getAccess();
  if (!a) throw new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  if (coll && !canUseCollection(a, coll)) throw forbidden();
  return a;
}

export const forbidden = () =>
  new Response(JSON.stringify({ ok: false, error: "You don't have access to this." }), { status: 403, headers: { "content-type": "application/json" } });

export const canUseCollection = (a: Access, coll: Collection) => a.isSuper || EMPLOYEE_COLLECTIONS.includes(coll);

/** Client ids this admin may see — null means "all" (Super Admin). */
/** Ids of the clients this person holds (one indexed, ids-only query; cached per request). */
const idsForRequest = cache(async (email: string) => new Set(await clientIdsFor(email)));
export async function allowedClientIds(a: Access): Promise<Set<string> | null> {
  if (a.isSuper) return null;
  return idsForRequest(a.email);
}

/** Uncached variant for long-lived streams (assignments change while the stream is open). */
export async function freshClientIds(a: Access): Promise<Set<string> | null> {
  if (a.isSuper) return null;
  return new Set(await clientIdsFor(a.email));
}

export async function canSeeClient(a: Access, clientId: string) {
  const ids = await allowedClientIds(a);
  return ids === null || ids.has(clientId);
}

/** Filters rows of clients/documents down to what this admin may see. */
export async function scopeRows<T extends Row>(a: Access, coll: Collection, rows: T[]): Promise<T[]> {
  if (a.isSuper) return rows;
  if (!canUseCollection(a, coll)) return [];
  const ids = await allowedClientIds(a);
  if (!ids) return rows;
  if (coll === "clients") return rows.filter((r) => ids.has(r.id));
  if (coll === "documents") return rows.filter((r) => ids.has(String((r as unknown as DocumentRow).clientId)));
  return rows;
}

/** Can this admin see / change this one row? */
export async function canSeeRow(a: Access, coll: Collection, row: Row) {
  if (a.isSuper) return true;
  if (!canUseCollection(a, coll)) return false;
  if (coll === "clients") return canSeeClient(a, row.id);
  if (coll === "documents") return canSeeClient(a, String((row as unknown as DocumentRow).clientId));
  return false;
}

/** "Unassigned" / blank → "", otherwise a lower-cased employee email. */
export function normalizeAssignee(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || s === "unassigned" ? "" : s;
}
