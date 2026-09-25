import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { supabaseEnabled } from "./supabase";
import { remoteDeleteFiles, remoteReadFile, remoteSaveFile } from "./remote";

/**
 * Private file storage. Uses the website's Supabase bucket when configured
 * (so client uploads and admin drafts/finals are the same files), otherwise disk.
 */
const root = () => path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./data/uploads");

export async function saveFile(key: string, data: Buffer, contentType?: string) {
  if (supabaseEnabled()) return remoteSaveFile(key, data, contentType);
  const file = path.join(root(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { mode: 0o600 });
  return key;
}

export async function readFile(key: string) {
  if (supabaseEnabled()) return remoteReadFile(key);
  const file = path.join(root(), key);
  if (!file.startsWith(root())) throw new Error("Invalid key");
  return fs.readFile(file);
}

export async function deleteFile(key: string) {
  if (!key) return;
  if (supabaseEnabled()) return remoteDeleteFiles([key]).catch(() => {});
  await fs.rm(path.join(root(), key), { force: true }).catch(() => {});
}
