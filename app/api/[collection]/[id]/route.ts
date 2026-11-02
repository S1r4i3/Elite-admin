import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { canSeeRow, forbidden, normalizeAssignee, requireAccess } from "@/lib/access";
import { get, log, nextEmployeeCode, remove, update } from "@/lib/db";
import { normalizeRole, ROLE_PREFIX } from "@/lib/workflow-shared";
import { deleteFile } from "@/lib/storage";
import type { Client, Collection, DocumentRow, Row } from "@/lib/types";
import { adminMove, WorkflowError } from "@/lib/workflow";
import { supabaseEnabled } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ALLOWED: Collection[] = ["clients", "documents", "leads", "inquiries", "cmsPages", "banners", "taxNotes", "employees", "logs"];
const isAllowed = (c: string): c is Collection => (ALLOWED as string[]).includes(c);

/** GET / PATCH / DELETE  /api/{collection}/{id} */
export async function GET(_req: Request, { params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection, id } = await params;
  if (!isAllowed(collection)) return NextResponse.json({ ok: false, error: "Unknown collection" }, { status: 404 });
  let access;
  try {
    access = await requireAccess(collection);
  } catch (r) {
    return r as Response;
  }
  const found = await get<Row>(collection, id);
  if (!found || !(await canSeeRow(access, collection, found))) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  // Copy without the hash — `found` is the live cached record, so never mutate it.
  const { passwordHash: _h, ...row } = found as Record<string, unknown>;
  return NextResponse.json({ ok: true, row });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection, id } = await params;
  if (!isAllowed(collection)) return NextResponse.json({ ok: false, error: "Unknown collection" }, { status: 404 });
  let admin;
  try {
    admin = await requireAccess(collection);
  } catch (r) {
    return r as Response;
  }
  const existing = await get<Row>(collection, id);
  if (!existing || !(await canSeeRow(admin, collection, existing))) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const patch = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!patch) return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  if (collection === "clients") {
    // Only an Admin can (re)assign a client, and it goes through the workflow (stage + history).
    const wanted = "assignedTo" in patch ? normalizeAssignee(patch.assignedTo) : null;
    delete patch.assignedTo;
    // Workflow fields can't be edited directly.
    for (const k of ["stage", "pendingTo", "pendingStage", "pendingBy", "pendingNote", "pendingAt", "rejectReason"]) delete patch[k];
    if (admin.isSuper && wanted !== null && wanted !== String((existing as Client).assignedTo || "").toLowerCase()) {
      if (supabaseEnabled()) {
        try {
          await adminMove(admin, id, wanted || "unassigned", "Assigned by Admin");
        } catch (e) {
          return NextResponse.json({ ok: false, error: e instanceof WorkflowError ? e.message : "Could not assign the client." }, { status: 400 });
        }
      } else patch.assignedTo = wanted;
    }
  }
  // Never accept identity / storage fields from the browser. Changing storageKey or clientId on a
  // document would let someone with access to one client read or move another client's file.
  for (const k of ["id", "createdAt", "updatedAt"]) delete patch[k];
  if (collection === "documents") for (const k of ["storageKey", "mimeType", "sizeBytes", "clientId", "kind"]) delete patch[k];
  if (collection === "clients" && !admin.isSuper) delete patch.clientId;
  delete patch.passwordHash; // never accept a raw hash from the client
  const password = String(patch.password ?? "");
  delete patch.password; // never store plain-text passwords
  if (collection === "employees") {
    if ("role" in patch) patch.role = normalizeRole(patch.role);
    const want = String(patch.code ?? "").trim().toUpperCase();
    const prefix = ROLE_PREFIX[normalizeRole(patch.role ?? existing.role)];
    // Keep the code in step with the role (DH → TP etc.) unless one was typed in.
    patch.code = want || (String(existing.code || "").startsWith(prefix) ? existing.code : await nextEmployeeCode(prefix === "AD" ? "Admin" : String(patch.role ?? existing.role)));
  }
  if (collection === "employees" && password) {
    if (password.length < 8) return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
    patch.passwordHash = await hashPassword(password);
  }
  const updated = await update<Row>(collection, id, patch);
  if (!updated) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const { passwordHash: _h, ...row } = updated as Record<string, unknown>;
  await log(admin.email, `Updated ${collection.replace(/s$/, "")}`, String(row.name || row.title || row.clientId || id));
  return NextResponse.json({ ok: true, row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection, id } = await params;
  if (!isAllowed(collection)) return NextResponse.json({ ok: false, error: "Unknown collection" }, { status: 404 });
  let admin;
  try {
    admin = await requireAccess(collection);
  } catch (r) {
    return r as Response;
  }
  // Employees may delete documents of their own clients, but never client accounts.
  if (!admin.isSuper && collection !== "documents") return forbidden();
  const target = await get<Row>(collection, id);
  if (!target || !(await canSeeRow(admin, collection, target))) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (collection === "documents") {
    const doc = await get<DocumentRow>("documents", id);
    if (doc?.storageKey) await deleteFile(doc.storageKey);
  }
  const ok = await remove(collection, id);
  if (!ok) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  await log(admin.email, `Deleted from ${collection}`, id);
  return NextResponse.json({ ok: true });
}
