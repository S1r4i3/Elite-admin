import "server-only";
import path from "node:path";
import { canSeeClient, type Access } from "./access";
import { create, get, log } from "./db";
import type { Client, DocumentRow } from "./types";

/** Shared rules for staff uploads (drafts, final documents, client documents). */
export const MAX_BYTES = 15 * 1024 * 1024;
export const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".csv"];
export type UploadKind = DocumentRow["kind"];

export class UploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const toKind = (v: unknown): UploadKind => (["upload", "draft", "final"].includes(String(v)) ? (String(v) as UploadKind) : "draft");

/** Checks the file name / size and that this person may add files for the client. */
export async function checkUpload(a: Access, clientId: string, name: string, size: number) {
  if (!size) throw new UploadError("No file received.");
  if (size > MAX_BYTES) throw new UploadError("File is larger than 15 MB.", 413);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw new UploadError("Unsupported file type.", 415);
  const client = await get<Client>("clients", clientId);
  if (!client || !(await canSeeClient(a, client.id))) throw new UploadError("Choose a client.");
  return { client, ext };
}

/** Same layout the website uses for client uploads. */
export const storageKeyFor = (clientId: string, id: string, ext: string) => `portal/${clientId}/${id}${ext}`;

/** Creates the document record once the file is stored, and logs it. */
export async function recordUpload(
  a: Access,
  client: Client,
  f: { kind: UploadKind; name: string; size: number; mimeType: string; storageKey: string; type?: string; taxYear?: string; note?: string },
) {
  const row = await create<DocumentRow>("documents", {
    clientId: client.id,
    kind: f.kind,
    name: f.name.slice(0, 200),
    type: String(f.type || (f.kind === "final" ? "Final return" : f.kind === "draft" ? "Draft estimation" : "Client upload")).slice(0, 120),
    taxYear: String(f.taxYear || ""),
    sizeKb: Math.round(f.size / 1024),
    sizeBytes: f.size,
    mimeType: f.mimeType || "application/octet-stream",
    storageKey: f.storageKey,
    note: String(f.note || "").slice(0, 2000),
    status: f.kind === "draft" ? "awaiting_review" : "",
    uploadedBy: f.kind === "upload" ? "client" : "staff",
  });
  await log(a.email, `Uploaded ${f.kind}`, `${client.firstName} ${client.lastName} — ${f.name}`);
  return row;
}
