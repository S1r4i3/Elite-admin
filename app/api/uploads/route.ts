import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAccess, type Access } from "@/lib/access";
import { saveFile } from "@/lib/storage";
import { BUCKET, sb, supabaseEnabled } from "@/lib/supabase";
import { checkUpload, recordUpload, storageKeyFor, toKind, UploadError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/uploads
 *  • JSON  { key, clientId, kind, name, taxYear, type, note } — records a file the browser already
 *    sent to storage through /api/uploads/sign (the normal path; works for files up to 15 MB).
 *  • multipart/form-data  file, clientId, kind, taxYear, type, note — small files / local dev.
 */
export async function POST(req: Request) {
  let a: Access;
  try {
    a = await requireAccess("documents");
  } catch (r) {
    return r as Response;
  }
  try {
    const row = (req.headers.get("content-type") || "").includes("application/json") ? await fromSignedUpload(a, req) : await fromForm(a, req);
    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[uploads] failed", e);
    return NextResponse.json({ ok: false, error: "Upload failed. Please try again." }, { status: 500 });
  }
}

async function fromSignedUpload(a: Access, req: Request) {
  if (!supabaseEnabled()) throw new UploadError("Direct uploads need the live Supabase connection.", 501);
  const b = (await req.json().catch(() => null)) as Record<string, string> | null;
  const clientId = String(b?.clientId || "");
  const key = String(b?.key || "");
  const name = String(b?.name || "");
  // The key must be one we signed for this client: portal/{clientId}/{uuid}{ext}
  const m = key.match(/^portal\/([^/]+)\/[0-9a-f-]{36}(\.[a-z]+)$/);
  if (!m || m[1] !== clientId) throw new UploadError("Invalid upload.");

  const { data: info, error } = await sb().storage.from(BUCKET).info(key);
  if (error || !info) throw new UploadError("The file didn't reach storage. Please upload it again.");
  const size = Number(info.size ?? 0);
  const { client, ext } = await checkUpload(a, clientId, name, size).catch(async (e) => {
    await sb().storage.from(BUCKET).remove([key]);
    throw e;
  });
  if (ext !== m[2]) throw new UploadError("Invalid upload.");
  return recordUpload(a, client, {
    kind: toKind(b?.kind),
    name,
    size,
    mimeType: String(info.contentType || "application/octet-stream"),
    storageKey: key,
    type: b?.type,
    taxYear: b?.taxYear,
    note: b?.note,
  });
}

async function fromForm(a: Access, req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) throw new UploadError("Invalid upload.");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UploadError("No file received.");
  const clientId = String(form.get("clientId") || "");
  const { client, ext } = await checkUpload(a, clientId, file.name, file.size);
  const storageKey = storageKeyFor(clientId, randomUUID(), ext);
  await saveFile(storageKey, Buffer.from(await file.arrayBuffer()), file.type || undefined);
  return recordUpload(a, client, {
    kind: toKind(form.get("kind")),
    name: file.name,
    size: file.size,
    mimeType: file.type,
    storageKey,
    type: String(form.get("type") || ""),
    taxYear: String(form.get("taxYear") || ""),
    note: String(form.get("note") || ""),
  });
}
