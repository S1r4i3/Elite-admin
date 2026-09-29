import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAccess } from "@/lib/access";
import { BUCKET, sb, supabaseEnabled } from "@/lib/supabase";
import { checkUpload, storageKeyFor, UploadError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/uploads/sign  { clientId, name, size }
 * Step 1 of a staff upload: returns a one-time signed URL so the browser sends the file
 * straight to Supabase Storage. (Vercel functions reject request bodies over ~4.5 MB,
 * so large drafts / final returns can't pass through our own API.)
 * Step 2 is POST /api/uploads with JSON, which records the document.
 */
export async function POST(req: Request) {
  let a;
  try {
    a = await requireAccess("documents");
  } catch (r) {
    return r as Response;
  }
  if (!supabaseEnabled()) return NextResponse.json({ ok: false, direct: false }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { clientId?: string; name?: string; size?: number } | null;
  try {
    const { ext } = await checkUpload(a, String(body?.clientId || ""), String(body?.name || ""), Number(body?.size || 0));
    const id = randomUUID();
    const key = storageKeyFor(String(body!.clientId), id, ext);
    const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(key);
    if (error || !data) throw new Error(error?.message || "no signed url");
    return NextResponse.json({ ok: true, key, signedUrl: data.signedUrl });
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[uploads/sign] failed", e);
    return NextResponse.json({ ok: false, error: "Could not start the upload. Please try again." }, { status: 500 });
  }
}
