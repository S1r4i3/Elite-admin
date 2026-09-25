import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/access";
import { decideMove, WorkflowError } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/** PATCH /api/handoffs/{id}  { action: "approve" | "reject", reason? } — Admin (manager) only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let a;
  try {
    a = await requireAccess();
  } catch (r) {
    return r as Response;
  }
  const body = (await req.json().catch(() => null)) as { action?: string; reason?: string } | null;
  if (body?.action !== "approve" && body?.action !== "reject") return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  try {
    await decideMove(a, (await params).id, body.action === "approve", String(body.reason ?? "").slice(0, 500));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof WorkflowError ? e.status : 500;
    if (status === 500) console.error("[handoffs] decide failed", e);
    return NextResponse.json({ ok: false, error: e instanceof WorkflowError ? e.message : "Could not update the request." }, { status });
  }
}
