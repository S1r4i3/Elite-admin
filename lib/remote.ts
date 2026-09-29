import "server-only";
import { BUCKET, sb } from "./supabase";
import type { Client, Collection, DocumentRow, Inquiry, Lead, Row, Settings } from "./types";

/**
 * Live website data (Supabase). Clients, their documents, leads and inquiries
 * belong to the website — the admin reads and writes them here so both apps
 * always see the same rows. Everything else stays in data/db.json.
 */

export const REMOTE_COLLECTIONS = ["clients", "documents", "leads", "inquiries", "employees", "cmsPages", "banners", "services", "taxNotes", "logs"] as const;
export type RemoteCollection = (typeof REMOTE_COLLECTIONS)[number];
export const isRemote = (c: Collection): c is RemoteCollection => (REMOTE_COLLECTIONS as readonly string[]).includes(c);

const TABLE: Record<RemoteCollection, string> = {
  clients: "profiles",
  documents: "portal_documents",
  leads: "leads",
  inquiries: "inquiries",
  employees: "employees",
  cmsPages: "cms_pages",
  banners: "banners",
  services: "service_prices",
  taxNotes: "tax_notes",
  logs: "admin_logs",
};

const fail = (where: string, error: { message: string } | null) => {
  if (error) throw new Error(`[supabase] ${where}: ${error.message}`);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const toClient = (r: any): Client => ({
  id: r.id,
  clientId: r.client_id ?? "",
  firstName: r.first_name ?? "",
  lastName: r.last_name ?? "",
  email: r.email ?? "",
  phone: r.phone ?? "",
  dob: r.dob ?? "",
  address: r.address ?? "",
  state: r.state ?? "",
  country: r.country ?? "",
  service: r.service ?? "",
  taxYear: r.tax_year ?? "",
  assignedTo: r.assigned_to ?? "",
  docStatus: r.doc_status ?? "pending",
  stage: r.stage ?? "unassigned",
  pendingTo: r.pending_to ?? null,
  pendingStage: r.pending_stage ?? null,
  pendingBy: r.pending_by ?? null,
  pendingNote: r.pending_note ?? null,
  pendingAt: r.pending_at ?? null,
  rejectReason: r.reject_reason ?? null,
  preparerEmail: r.preparer_email ?? null,
  reviewerEmail: r.reviewer_email ?? null,
  filerEmail: r.filer_email ?? null,
  reworkSource: r.rework_source ?? null,
  reworkReason: r.rework_reason ?? null,
  correction: Boolean(r.correction),
  filingCycle: Number(r.filing_cycle ?? 0),
  efiledAt: r.efiled_at ?? null,
  irsDecidedAt: r.irs_decided_at ?? null,
  closedAt: r.closed_at ?? null,
  status: r.status ?? "active",
  lastLoginAt: r.last_login_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toDocument = (r: any): DocumentRow => ({
  id: r.id,
  clientId: r.customer_id,
  kind: r.kind,
  name: r.original_name ?? "",
  type: r.category ?? (r.kind === "upload" ? "Client upload" : r.kind === "draft" ? "Draft estimation" : "Final return"),
  taxYear: r.tax_year ?? "",
  sizeKb: Math.round(Number(r.size ?? 0) / 1024),
  storageKey: r.storage_key ?? "",
  note: r.note ?? "",
  status: r.status ?? "",
  clientComment: r.client_comment ?? "",
  uploadedBy: r.kind === "upload" ? "client" : "staff",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toLead = (r: any): Lead => ({
  id: r.id,
  name: [r.first_name, r.last_name].filter(Boolean).join(" "),
  email: r.email ?? "",
  phone: r.phone ?? "",
  service: r.service ?? "",
  taxYear: r.tax_year ?? "",
  message: r.message ?? "",
  status: r.status ?? "new",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toInquiry = (r: any): Inquiry => ({
  id: r.id,
  name: r.name ?? "",
  phone: r.phone ?? "",
  email: r.email ?? "",
  message: r.message ?? "",
  page: r.page ?? "",
  createdAt: r.created_at,
});

const stamps = (r: any) => ({ id: r.id, createdAt: r.created_at, updatedAt: r.updated_at ?? undefined });
const MAP: Record<RemoteCollection, (r: any) => Row> = {
  clients: toClient,
  documents: toDocument,
  leads: toLead,
  inquiries: toInquiry,
  employees: (r) => ({ ...stamps(r), name: r.name, email: r.email, phone: r.phone ?? "", role: r.role, status: r.status, code: r.code ?? "", passwordHash: r.password_hash ?? undefined }),
  cmsPages: (r) => ({ ...stamps(r), title: r.title, slug: r.slug, body: r.body ?? "" }),
  banners: (r) => ({ ...stamps(r), title: r.title, subtitle: r.subtitle ?? "", cta: r.cta ?? "", link: r.link ?? "", active: String(r.active) }),
  services: (r) => ({ ...stamps(r), name: r.name, price: Number(r.price ?? 0), active: String(r.active) }),
  taxNotes: (r) => ({ ...stamps(r), title: r.title, body: r.body ?? "" }),
  logs: (r) => ({ ...stamps(r), who: r.who, action: r.action, detail: r.detail ?? "" }),
};

/** Simple one-to-one column maps for the admin-owned tables. */
const SIMPLE: Partial<Record<RemoteCollection, Record<string, string>>> = {
  employees: { name: "name", email: "email", phone: "phone", role: "role", status: "status", code: "code", passwordHash: "password_hash" },
  cmsPages: { title: "title", slug: "slug", body: "body" },
  banners: { title: "title", subtitle: "subtitle", cta: "cta", link: "link", active: "active" },
  services: { name: "name", price: "price", active: "active" },
  taxNotes: { title: "title", body: "body" },
  logs: { who: "who", action: "action", detail: "detail" },
};

/** App-shape patch → table columns (only the fields each table actually has). */
function toColumns(coll: RemoteCollection, p: Record<string, any>) {
  const out: Record<string, unknown> = {};
  const simple = SIMPLE[coll];
  if (simple) {
    for (const [key, col] of Object.entries(simple)) {
      if (p[key] === undefined) continue;
      let v = p[key];
      if (col === "active") v = v === true || String(v) === "true";
      else if (col === "price") v = Number(v) || 0;
      else if (col === "email") v = String(v).trim().toLowerCase();
      else if (typeof v === "string" && v === "" && col !== "body") v = null;
      out[col] = v;
    }
    return out;
  }
  const set = (col: string, v: unknown) => {
    if (v !== undefined) out[col] = v === "" ? null : v;
  };
  if (coll === "clients") {
    set("first_name", p.firstName);
    set("last_name", p.lastName);
    set("phone", p.phone);
    set("dob", p.dob);
    set("address", p.address);
    set("state", p.state);
    set("country", p.country);
    set("status", p.status);
    set("service", p.service);
    set("tax_year", p.taxYear);
    if (p.docStatus !== undefined && ["pending", "received"].includes(String(p.docStatus))) out.doc_status = p.docStatus;
    if (p.assignedTo !== undefined) {
      const v = String(p.assignedTo ?? "").trim().toLowerCase();
      out.assigned_to = !v || v === "unassigned" ? null : v;
    }
    if (p.clientId) out.client_id = p.clientId;
  } else if (coll === "documents") {
    if (p.clientId !== undefined) out.customer_id = p.clientId;
    if (p.kind !== undefined) out.kind = p.kind;
    if (p.name !== undefined) out.original_name = p.name;
    set("category", p.type);
    set("tax_year", p.taxYear);
    set("note", p.note);
    set("status", p.status);
    set("client_comment", p.clientComment);
    if (p.storageKey !== undefined) out.storage_key = p.storageKey;
    if (p.mimeType !== undefined) out.mime_type = p.mimeType;
    if (p.sizeBytes !== undefined) out.size = p.sizeBytes;
  } else if (coll === "leads") {
    if (p.name !== undefined) {
      const [first, ...rest] = String(p.name).trim().split(/\s+/);
      out.first_name = first || "";
      out.last_name = rest.join(" ");
    }
    set("email", p.email);
    set("phone", p.phone);
    set("service", p.service);
    set("tax_year", p.taxYear);
    set("message", p.message);
    set("status", p.status);
  } else {
    set("name", p.name);
    set("phone", p.phone);
    set("email", p.email);
    set("message", p.message);
    set("page", p.page);
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function remoteList(coll: RemoteCollection): Promise<Row[]> {
  const { data, error } = await sb().from(TABLE[coll]).select("*").order("created_at", { ascending: false }).limit(2000);
  fail(`list ${coll}`, error);
  return (data ?? []).map(MAP[coll]);
}

export async function remoteGet(coll: RemoteCollection, id: string): Promise<Row | null> {
  const { data, error } = await sb().from(TABLE[coll]).select("*").eq("id", id).maybeSingle();
  if (error && /invalid input syntax for type uuid/i.test(error.message)) return null;
  fail(`get ${coll}`, error);
  return data ? MAP[coll](data) : null;
}

export async function remoteCreate(coll: RemoteCollection, body: Record<string, unknown>): Promise<Row> {
  if (coll === "clients") {
    // Clients are Supabase Auth users; the on_auth_user_created trigger makes the profile + client ID.
    const email = String(body.email || "").trim().toLowerCase();
    const { data, error } = await sb().auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: body.firstName ?? "",
        last_name: body.lastName ?? "",
        phone: body.phone ?? "",
        dob: body.dob ?? "",
        state: body.state ?? "",
        country: body.country ?? "",
        address: body.address ?? "",
      },
    });
    fail("create client", error);
    const id = data.user!.id;
    const patch = toColumns("clients", { status: body.status, service: body.service, taxYear: body.taxYear, assignedTo: body.assignedTo });
    if (Object.keys(patch).length) await sb().from("profiles").update(patch).eq("id", id);
    return (await remoteGet("clients", id))!;
  }
  const { data, error } = await sb().from(TABLE[coll]).insert(toColumns(coll, body)).select("*").single();
  fail(`create ${coll}`, error);
  return MAP[coll](data);
}

export async function remoteUpdate(coll: RemoteCollection, id: string, patch: Record<string, unknown>): Promise<Row | null> {
  const row = toColumns(coll, patch);
  if (coll === "clients") delete row.client_id; // client IDs are assigned by the database
  if (Object.keys(row).length === 0) return remoteGet(coll, id);
  const { data, error } = await sb().from(TABLE[coll]).update(row).eq("id", id).select("*").maybeSingle();
  fail(`update ${coll}`, error);
  return data ? MAP[coll](data) : null;
}

export async function remoteRemove(coll: RemoteCollection, id: string): Promise<boolean> {
  if (coll === "clients") {
    // Remove their files first, then the auth user (profile + documents cascade).
    const docs = await sb().from("portal_documents").select("storage_key").eq("customer_id", id);
    const keys = (docs.data ?? []).map((d) => d.storage_key).filter(Boolean);
    if (keys.length) await remoteDeleteFiles(keys);
    const { error } = await sb().auth.admin.deleteUser(id);
    if (error) {
      const r = await sb().from("profiles").delete().eq("id", id).select("id");
      fail("delete client", r.error);
      return (r.data ?? []).length > 0;
    }
    return true;
  }
  const { data, error } = await sb().from(TABLE[coll]).delete().eq("id", id).select("id");
  fail(`delete ${coll}`, error);
  return (data ?? []).length > 0;
}

/* ── Storage (the website's private bucket) ─────────────── */


export async function remoteSaveFile(key: string, data: Buffer, contentType = "application/octet-stream") {
  const { error } = await sb().storage.from(BUCKET).upload(key, data, { contentType, upsert: true });
  fail("upload file", error);
  return key;
}

export async function remoteReadFile(key: string) {
  const { data, error } = await sb().storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`[supabase] download: ${error?.message ?? "not found"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function remoteDeleteFiles(keys: string[]) {
  await sb().storage.from(BUCKET).remove(keys);
}

/* ── Admin settings (single row, id = 1) ─────────────────── */


export async function remoteGetSettings(defaults: Settings): Promise<Settings> {
  const { data, error } = await sb().from("settings").select("*").eq("id", 1).maybeSingle();
  fail("get settings", error);
  if (!data) return defaults;
  return {
    ...defaults,
    ...((data.data as Partial<Settings>) ?? {}),
    companyName: data.company_name ?? defaults.companyName,
    taxYear: data.tax_year ?? defaults.taxYear,
  };
}

export async function remoteSaveSettings(next: Settings) {
  const { error } = await sb()
    .from("settings")
    .upsert({ id: 1, company_name: next.companyName, tax_year: next.taxYear, email: next.email || null, phone: next.phoneUs || null, address: next.address || null, data: next });
  fail("save settings", error);
  return next;
}

export async function remoteFindEmployee(email: string) {
  const { data, error } = await sb().from("employees").select("*").ilike("email", email.trim()).maybeSingle();
  fail("find employee", error);
  return data ? MAP.employees(data) : null;
}

export async function remoteCount(coll: RemoteCollection) {
  const { count, error } = await sb().from(TABLE[coll]).select("id", { count: "exact", head: true });
  fail(`count ${coll}`, error);
  return count ?? 0;
}

/** Bulk insert (used once to move the local data/db.json into Supabase). */
export async function remoteImport(coll: RemoteCollection, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const payload = rows.map((r) => ({ ...toColumns(coll, r), ...(r.createdAt ? { created_at: r.createdAt } : {}) }));
  const { error } = await sb().from(TABLE[coll]).insert(payload);
  fail(`import ${coll}`, error);
}
