import { NextResponse } from "next/server";
import { canSeeRow, requireAccess } from "@/lib/access";
import { get } from "@/lib/db";
import { readFile } from "@/lib/storage";
import type { DocumentRow } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/files/{documentId} — downloads the stored file (?view=1 opens inline). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let access;
  try {
    access = await requireAccess("documents");
  } catch (r) {
    return r as Response;
  }
  const doc = await get<DocumentRow>("documents", (await params).id);
  if (!doc || !(await canSeeRow(access, "documents", doc))) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (!doc.storageKey) return NextResponse.json({ ok: false, error: "This sample record has no stored file." }, { status: 410 });

  try {
    const data = await readFile(doc.storageKey);
    const inline = new URL(req.url).searchParams.get("view") === "1";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "File missing from storage" }, { status: 410 });
  }
}
