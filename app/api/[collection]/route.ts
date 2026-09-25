import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { forbidden, normalizeAssignee, requireAccess, scopeRows } from "@/lib/access";
import { create, findEmployeeByEmail, list, log, nextClientId, nextEmployeeCode } from "@/lib/db";
import { normalizeRole } from "@/lib/workflow-shared";
import type { Client, Collection, Row } from "@/lib/types";
import { adminMove, decorateClients } from "@/lib/workflow";
import { supabaseEnabled } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ALLOWED: Collection[] = ["clients", "documents", "leads", "inquiries", "cmsPages", "banners", "services", "taxNotes", "employees", "logs"];
const isAllowed = (c: string): c is Collection => (ALLOWED as string[]).includes(c);

/**
 * GET  /api/{collection}?q=&limit=&kind=&status=
 * POST /api/{collection}
 *
 * Collections: clients, documents, leads, inquiries, cmsPages, banners,
 *              services, taxNotes, employees, logs
 */
export async function GET(req: Request, { params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!isAllowed(collection)) return NextResponse.json({ ok: false, error: "Unknown collection" }, { status: 404 });
  let access;
  try {
    access = await requireAccess(collection);
  } catch (r) {
    return r as Response;
  }

  const url = new URL(req.url);
  // Employees only ever receive their own assigned clients and those clients' documents.
  let rows = await scopeRows(access, collection, await list<Row>(collection));

  // Simple server-side filters — extend as needed.
  for (const key of ["kind", "status", "clientId", "taxYear", "role"]) {
    const v = url.searchParams.get(key);
    if (v) rows = rows.filter((r) => String(r[key] ?? "") === v);
  }
  const q = url.searchParams.get("q")?.toLowerCase();
  if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  const limit = Number(url.searchParams.get("limit") || 0);
  if (limit > 0) rows = rows.slice(0, limit);

  // Clients get their queue code (DH1…) and "Preparation status" text.
  if (collection === "clients") rows = await decorateClients(rows as Client[]);

  // Never send password hashes to the browser.
  if (collection === "employees") rows = rows.map(({ passwordHash: _ignored, ...rest }) => rest as Row);

  return NextResponse.json({ ok: true, rows, total: rows.length });
}

export async function POST(req: Request, { params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!isAllowed(collection) || collection === "logs") return NextResponse.json({ ok: false, error: "Unknown collection" }, { status: 404 });
  let admin;
  try {
    admin = await requireAccess(collection);
  } catch (r) {
    return r as Response;
  }
  // Only a Super Admin creates records here (employees work on the clients assigned to them;
  // documents are added through /api/uploads, which checks the client assignment).
  if (!admin.isSuper) return forbidden();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });

  if (collection === "clients") {
    if (!body.firstName || !body.lastName || !body.email) {
      return NextResponse.json({ ok: false, error: "First name, last name and email are required." }, { status: 400 });
    }
    body.clientId = body.clientId || (await nextClientId());
    body.assignedTo = normalizeAssignee(body.assignedTo);
  }

  if (collection === "employees") {
    const password = String(body.password ?? "");
    if (!body.name || !body.email) return NextResponse.json({ ok: false, error: "Name and email are required." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
    if (await findEmployeeByEmail(String(body.email))) {
      return NextResponse.json({ ok: false, error: "An employee with this email already exists." }, { status: 409 });
    }
    body.passwordHash = await hashPassword(password);
    body.role = normalizeRole(body.role);
    body.code = String(body.code || "").trim().toUpperCase() || (await nextEmployeeCode(String(body.role)));
  }
  delete body.password; // never store plain-text passwords

  const assignTo = collection === "clients" && supabaseEnabled() ? String(body.assignedTo || "") : "";
  if (assignTo) delete body.assignedTo; // set through the workflow so the stage + history are right
  const created = await create<Row>(collection, body);
  if (assignTo) await adminMove(admin, created.id, assignTo, "Assigned when the client was added").catch((e) => console.error("[clients] assign failed", e));
  // Copy without the hash — `created` is the live cached record.
  const { passwordHash: _h, ...row } = created as Record<string, unknown>;
  await log(admin.email, `Created ${collection.replace(/s$/, "")}`, String(body.name || body.title || body.clientId || ""));
  return NextResponse.json({ ok: true, row }, { status: 201 });
}

