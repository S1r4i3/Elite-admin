import { NextResponse } from "next/server";
import { canSeeClient, requireAccess } from "@/lib/access";
import { listHandoffs, requestMove, WorkflowError } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/**
 * GET  /api/handoffs?status=pending&clientId=…   Admin: any. Employee: only for a client they hold.
 * POST /api/handoffs  { clientId, to, note }      to = employee email | "filed" | "unassigned" (Admin)
 *      Employee → hands the client on immediately (DH → TP, TP → TR, TP → DH).
 *      Admin    → reassigns the client.
 */
export async function GET(req: Request) {
  let a;
  try {
    a = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") || undefined;
  if (!a.isSuper && (!clientId || !(await canSeeClient(a, clientId)))) {
    return NextResponse.json({ ok: false, error: "You don't have access to this." }, { status: 403 });
  }
  const rows = await listHandoffs({ clientId, status: url.searchParams.get("status") || undefined });
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: Request) {
  let a;
  try {
    a = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  const body = (await req.json().catch(() => null)) as { clientId?: string; to?: string; note?: string } | null;
  if (!body?.clientId || body.to === undefined) return NextResponse.json({ ok: false, error: "Choose who to move the client to." }, { status: 400 });
  try {
    await requestMove(a, body.clientId, String(body.to), String(body.note ?? "").slice(0, 500));
    return NextResponse.json({ ok: true, pending: false });
  } catch (e) {
    const status = e instanceof WorkflowError ? e.status : 500;
    if (status === 500) console.error("[handoffs] move failed", e);
    return NextResponse.json({ ok: false, error: e instanceof WorkflowError ? e.message : "Could not move the client." }, { status });
  }
}
