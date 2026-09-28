import { NextResponse } from "next/server";
import { canSeeClient, requireAccess } from "@/lib/access";
import { runAction, WorkflowError } from "@/lib/workflow";
import { WF_ACTIONS, type WfAction } from "@/lib/workflow-shared";

export const dynamic = "force-dynamic";

/** POST /api/workflow  { clientId, action, note? } — review / filing / IRS decisions for a client you hold (or any client, Admin). */
export async function POST(req: Request) {
  let a;
  try {
    a = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  const body = (await req.json().catch(() => null)) as { clientId?: string; action?: string; note?: string } | null;
  const action = WF_ACTIONS.find((w) => w.action === body?.action)?.action as WfAction | undefined;
  if (!body?.clientId || !action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  if (a.isSuper) return NextResponse.json({ ok: false, error: "Admins monitor the workflow — the staff member holding the client takes this action." }, { status: 403 });
  if (!(await canSeeClient(a, body.clientId))) return NextResponse.json({ ok: false, error: "You don't have access to this client." }, { status: 403 });
  try {
    const result = await runAction(a, body.clientId, action, String(body.note ?? "").slice(0, 1000));
    return NextResponse.json({ ok: true, stage: result.stage, assignedTo: result.assignedTo });
  } catch (e) {
    const status = e instanceof WorkflowError ? e.status : 500;
    if (status === 500) console.error("[workflow] action failed", e);
    return NextResponse.json({ ok: false, error: e instanceof WorkflowError ? e.message : "Could not update the workflow." }, { status });
  }
}
