import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { canSeeClient, requireAccess } from "@/lib/access";
import { create, get, log } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import type { Client, DocumentRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".csv"];

/**
 * POST /api/uploads  (multipart/form-data)
 * fields: file, clientId, kind=upload|draft|final, taxYear, type, note
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAccess("documents");
  } catch (r) {
    return r as Response;
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Invalid upload." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "File is larger than 15 MB." }, { status: 413 });

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return NextResponse.json({ ok: false, error: "Unsupported file type." }, { status: 415 });

  const clientId = String(form.get("clientId") || "");
  const client = await get<Client>("clients", clientId);
  if (!client || !(await canSeeClient(admin, client.id))) return NextResponse.json({ ok: false, error: "Choose a client." }, { status: 400 });

  const kindRaw = String(form.get("kind") || "draft");
  const kind = (["upload", "draft", "final"].includes(kindRaw) ? kindRaw : "draft") as DocumentRow["kind"];

  const id = randomUUID();
  const storageKey = `portal/${clientId}/${id}${ext}`; // same layout the website uses
  await saveFile(storageKey, Buffer.from(await file.arrayBuffer()), file.type || undefined);

  const row = await create<DocumentRow>("documents", {
    clientId,
    kind,
    name: file.name.slice(0, 200),
    type: String(form.get("type") || (kind === "final" ? "Final return" : kind === "draft" ? "Draft estimation" : "Client upload")),
    taxYear: String(form.get("taxYear") || ""),
    sizeKb: Math.round(file.size / 1024),
    sizeBytes: file.size,
    mimeType: file.type || "application/octet-stream",
    storageKey,
    note: String(form.get("note") || ""),
    status: kind === "draft" ? "awaiting_review" : "",
    uploadedBy: kind === "upload" ? "client" : "staff",
  });

  await log(admin.email, `Uploaded ${kind}`, `${client.firstName} ${client.lastName} — ${file.name}`);
  return NextResponse.json({ ok: true, row }, { status: 201 });
}
