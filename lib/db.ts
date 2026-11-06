import { docKindAllowed } from "./workflow-shared";
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth";
import type { Client, Collection, DB, DocumentRow, Row, Settings } from "./types";
import { supabaseEnabled } from "./supabase";
import {
  isRemote,
  remoteCount,
  remoteCountWhere,
  remoteListWhere,
  remoteClientIdsFor,
  remoteClientNames,
  type Where,
  remoteCreate,
  remoteFindEmployee,
  remoteGet,
  remoteGetSettings,
  remoteImport,
  remoteList,
  remoteRemove,
  remoteSaveSettings,
  remoteUpdate,
  type RemoteCollection,
} from "./remote";

/**
 * With Supabase configured (always on Vercel) EVERYTHING lives in Supabase: clients and documents
 * (shared with the website) and the admin's own data — employees, settings, CMS, logs.
 * The local data/db.json is only used when Supabase isn't configured (offline development).
 * Vercel's filesystem is read-only, so a file database can't work there.
 */
const live = (coll: Collection) => supabaseEnabled() && isRemote(coll);
export const isLive = () => supabaseEnabled();

/* ── One-time bootstrap of the admin tables in Supabase ───────────────────────
 * If Supabase has no employees yet:
 *  • a local data/db.json exists (your dev machine) → copy staff, settings, CMS, banners,
 *    notes and logs into Supabase, so the deployed admin has the same logins;
 *  • otherwise (a fresh Vercel deploy) → create the first Admin from ADMIN_EMAIL / ADMIN_PASSWORD.
 */
let bootstrapped: Promise<void> | null = null;
function ready() {
  if (!supabaseEnabled()) return Promise.resolve();
  bootstrapped ??= bootstrap().catch((e) => {
    bootstrapped = null; // retry on the next request
    throw e;
  });
  return bootstrapped;
}

async function bootstrap() {
  if ((await remoteCount("employees")) > 0) return;
  let local: DB | null = null;
  try {
    local = JSON.parse(await fs.readFile(DB_FILE, "utf8")) as DB;
  } catch {
    local = null;
  }
  if (local?.employees?.length) {
    const copy = async (coll: RemoteCollection, rows: Row[] | undefined) => {
      if ((await remoteCount(coll)) === 0) await remoteImport(coll, (rows ?? []).map(({ id: _id, ...r }) => r));
    };
    // Data from db.json can contain duplicate queue codes (e.g. two "TP1") or emails,
    // which violate the unique constraints in Supabase. Keep the first email, renumber codes.
    const seenEmail = new Set<string>();
    const seenCode = new Set<string>();
    const allCodes = new Set((local.employees as Row[]).map((e) => String(e.code ?? "").toUpperCase()));
    const staff = (local.employees as Row[]).filter((e) => {
      const em = String(e.email ?? "").trim().toLowerCase();
      if (!em || seenEmail.has(em)) return false;
      seenEmail.add(em);
      return true;
    }).map((e) => {
      let code = String(e.code ?? "").toUpperCase();
      if (code && seenCode.has(code)) {
        const prefix = code.replace(/\d+$/, "");
        let n = 1;
        while (seenCode.has(`${prefix}${n}`) || allCodes.has(`${prefix}${n}`)) n++;
        code = `${prefix}${n}`;
      }
      if (code) seenCode.add(code);
      return { ...e, code };
    });
    await copy("employees", staff);
    await copy("cmsPages", local.cmsPages);
    await copy("banners", local.banners);
    await copy("taxNotes", local.taxNotes);
    await copy("logs", local.logs?.slice(0, 500));
    if (local.settings) await remoteSaveSettings(local.settings);
    console.info(`[db] Copied ${local.employees.length} employees and the admin content from data/db.json into Supabase.`);
    return;
  }
  const email = (process.env.ADMIN_EMAIL || "admin@elitebtax.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password && process.env.NODE_ENV === "production") {
    throw new Error("No employees exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment to create the first Admin.");
  }
  await remoteImport("employees", [
    { name: "Admin", email, role: "Admin", status: "active", code: "AD1", passwordHash: await hashPassword(password || "admin123") },
  ]);
  console.info(`[db] Created the first Admin account (${email}).`);
}

const DEFAULT_SETTINGS = (): Settings => ({
  companyName: "Elite B Tax Services",
  taxYear: String(new Date().getFullYear()),
  phoneUs: "+1 (302) 202-2139",
  phoneIn: "+91 99127 62149",
  whatsapp: "+91 99127 62149",
  email: "support@elitebtax.com",
  address: "8 The Green, Ste A, Dover, Delaware 19901, US",
  facebook: "",
  instagram: "",
  linkedin: "",
  youtube: "",
  seoTitle: "Elite B Tax Services — U.S. & India Tax Filing",
  seoDescription: "Individual, business and U.S. + India tax services, explained in plain language.",
});

/**
 * JSON-file data store.
 *
 * This is the ONLY file that touches storage. To move to PostgreSQL / MySQL / an
 * external API, rewrite the exported functions below — the API routes and the UI
 * never read the file directly. See README.md → "Swapping in your own backend".
 */

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let cache: DB | null = null;
let queue: Promise<unknown> = Promise.resolve();

const iso = (daysAgo: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, (daysAgo * 7) % 60, 0, 0);
  return d.toISOString();
};

async function seed(): Promise<DB> {
  const YEAR = new Date().getFullYear();

  const adminEmail = process.env.ADMIN_EMAIL || "admin@elitebtax.com";
  const adminHash = await hashPassword(process.env.ADMIN_PASSWORD || "admin123");

  return {
    settings: {
      companyName: "Elite B Tax Services",
      taxYear: String(YEAR),
      phoneUs: "+1 (302) 202-2139",
      phoneIn: "+91 99127 62149",
      whatsapp: "+91 99127 62149",
      email: "support@elitebtax.com",
      address: "8 The Green, Ste A, Dover, Delaware 19901, US",
      facebook: "",
      instagram: "",
      linkedin: "",
      youtube: "",
      seoTitle: "Elite B Tax Services — U.S. & India Tax Filing",
      seoDescription: "Individual, business and U.S. + India tax services, explained in plain language.",
    },
    // Clients, documents, leads and inquiries come from the website (Supabase) — no sample data.
    clients: [],
    documents: [],
    leads: [],
    inquiries: [],
    cmsPages: [
      { id: randomUUID(), title: "Welcome to Elite B Tax", slug: "/", body: "Your taxes. Done right. Without the stress.", createdAt: iso(60) },
      { id: randomUUID(), title: "Federal Refund Status", slug: "/refund-status/federal", body: "Check your federal refund with the IRS.", createdAt: iso(60) },
      { id: randomUUID(), title: "State Refund Status", slug: "/refund-status/state", body: "State-by-state refund trackers.", createdAt: iso(60) },
      { id: randomUUID(), title: "Pay Federal Taxes Online", slug: "/pay/federal", body: "IRS Direct Pay and EFTPS.", createdAt: iso(59) },
      { id: randomUUID(), title: "Pay State Taxes Online", slug: "/pay/state", body: "State payment portals.", createdAt: iso(59) },
      { id: randomUUID(), title: "Client Tax Questionnaire", slug: "/questionnaire", body: "What we ask before preparing a return.", createdAt: iso(58) },
    ],
    banners: [
      { id: randomUUID(), title: "Your Taxes. Done Right.", subtitle: "Professional tax preparation without the stress.", cta: "Get Started", link: "/get-started", active: "true", createdAt: iso(20) },
      { id: randomUUID(), title: "U.S. + India Tax Under One Roof", subtitle: "One team for both countries.", cta: "Indian Tax Services", link: "/indian-tax-services", active: "true", createdAt: iso(30) },
    ],
    taxNotes: [
      { id: randomUUID(), title: "Standard deduction", body: "Confirm the current year's figures against IRS Pub 501 before filing.", createdAt: iso(12) },
      { id: randomUUID(), title: "FBAR deadline", body: "April 15, with an automatic extension to October 15.", createdAt: iso(25) },
      { id: randomUUID(), title: "ITIN renewals", body: "ITINs unused on a return for 3 years expire.", createdAt: iso(38) },
    ],
    employees: [
      { id: randomUUID(), name: "Admin", email: adminEmail, phone: "+1 302 202 2139", role: "Admin", code: "AD1", status: "active", passwordHash: adminHash, createdAt: iso(300) },
    ],
    logs: [{ id: randomUUID(), who: "system", action: "Database created", detail: "Initial setup", createdAt: new Date().toISOString() }],
  };
}

async function read(): Promise<DB> {
  if (cache) return cache;
  if (process.env.VERCEL) {
    // Vercel's filesystem is read-only and wiped on every deploy — a JSON file can't be the database there.
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to this Vercel project's environment variables, then redeploy.");
  }
  try {
    cache = JSON.parse(await fs.readFile(DB_FILE, "utf8")) as DB;
  } catch {
    cache = await seed();
    await write(cache);
  }
  return cache;
}

async function write(db: DB) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_FILE);
  cache = db;
}

/** Serializes writes so concurrent requests can't clobber each other. */
function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await read();
    const result = await fn(db);
    await write(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/* ── Public API ─────────────────────────────────────────── */

// Settings change rarely but are read on every page: keep them for a minute per server instance.
let settingsCache: { at: number; value: Promise<Settings> } | null = null;
const SETTINGS_TTL = 60_000;

export async function getSettings(): Promise<Settings> {
  if (supabaseEnabled()) {
    if (!settingsCache || Date.now() - settingsCache.at > SETTINGS_TTL) {
      const value = ready().then(() => remoteGetSettings(DEFAULT_SETTINGS()));
      settingsCache = { at: Date.now(), value };
      value.catch(() => (settingsCache = null));
    }
    return settingsCache.value;
  }
  return (await read()).settings;
}

export async function saveSettings(patch: Partial<Settings>) {
  settingsCache = null;
  if (supabaseEnabled()) return remoteSaveSettings({ ...(await getSettings()), ...patch });
  return mutate((db) => {
    Object.assign(db.settings, patch);
    return db.settings;
  });
}

export async function list<T extends Row>(coll: Collection): Promise<T[]> {
  if (live(coll) && isRemote(coll)) {
    await ready();
    return (await remoteList(coll)) as T[];
  }
  const db = await read();
  return [...(db[coll] as unknown as T[])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** List with filters pushed to the database (falls back to filtering the local file in dev). */
export async function listWhere<T extends Row>(coll: Collection, where: Where, opts: { limit?: number; columns?: string } = {}): Promise<T[]> {
  if (live(coll) && isRemote(coll)) {
    await ready();
    return (await remoteListWhere(coll, where, opts)) as T[];
  }
  const rows = await list<T>(coll);
  return rows.filter((r) =>
    where.every((w) => {
      const v = (r as Record<string, unknown>)[w.field];
      if (w.op === "in") return (w.value as unknown[]).includes(v);
      if (w.op === "gte") return String(v) >= String(w.value);
      return String(v ?? "").toLowerCase() === String(w.value ?? "").toLowerCase();
    }),
  ).slice(0, opts.limit ?? 2000);
}

/** Count with filters, transferring no rows when live. */
export async function countWhere(coll: Collection, where: Where = []): Promise<number> {
  if (live(coll) && isRemote(coll)) {
    await ready();
    return remoteCountWhere(coll, where);
  }
  return (await listWhere(coll, where)).length;
}

/** Ids of the clients an employee holds. */
export async function clientIdsFor(email: string): Promise<string[]> {
  if (supabaseEnabled()) {
    await ready();
    return remoteClientIdsFor(email);
  }
  return (await listWhere<Client>("clients", [{ field: "assignedTo", value: email }])).map((c) => c.id);
}

/** Display names for a set of client ids. */
export async function clientNames(ids: string[]): Promise<Map<string, string>> {
  if (supabaseEnabled()) return remoteClientNames(ids);
  const set = new Set(ids);
  return new Map((await list<Client>("clients")).filter((c) => set.has(c.id)).map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
}

export async function get<T extends Row>(coll: Collection, id: string): Promise<T | null> {
  if (live(coll) && isRemote(coll)) {
    await ready();
    return (await remoteGet(coll, id)) as T | null;
  }
  const db = await read();
  return ((db[coll] as unknown as T[]).find((r) => r.id === id) as T) ?? null;
}

export function create<T extends Row>(coll: Collection, data: Record<string, unknown>): Promise<T> {
  if (live(coll) && isRemote(coll)) return remoteCreate(coll, data) as Promise<T>;
  return mutate((db) => {
    const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...data } as unknown as T;
    (db[coll] as unknown as T[]).unshift(row);
    return row;
  });
}

export function update<T extends Row>(coll: Collection, id: string, patch: Record<string, unknown>): Promise<T | null> {
  if (live(coll) && isRemote(coll)) return remoteUpdate(coll, id, patch) as Promise<T | null>;
  return mutate((db) => {
    const row = (db[coll] as unknown as T[]).find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    return row;
  });
}

export function remove(coll: Collection, id: string): Promise<boolean> {
  if (live(coll) && isRemote(coll)) return remoteRemove(coll, id);
  return mutate((db) => {
    const before = (db[coll] as Row[]).length;
    (db[coll] as Row[]) = (db[coll] as Row[]).filter((r) => r.id !== id);
    return (db[coll] as Row[]).length < before;
  });
}

/** Writes an entry to the admin activity log. */
export function log(who: string, action: string, detail = "") {
  if (supabaseEnabled()) return remoteCreate("logs", { who, action, detail }).then(() => undefined).catch((e) => console.error("[log]", e));
  return mutate((db) => {
    db.logs.unshift({ id: randomUUID(), who, action, detail, createdAt: new Date().toISOString() });
    db.logs = db.logs.slice(0, 1000);
  });
}

/** Next client number for the current taxation year, e.g. EBT-2026-0011. */
export function nextClientId(): Promise<string> {
  if (supabaseEnabled()) return Promise.resolve(""); // the database assigns EBT-YYYY-NNNN itself
  return mutate((db) => {
    const prefix = `EBT-${db.settings.taxYear}-`;
    const max = db.clients.reduce((m, c) => (c.clientId?.startsWith(prefix) ? Math.max(m, parseInt(c.clientId.slice(prefix.length), 10) || 0) : m), 0);
    return prefix + String(max + 1).padStart(4, "0");
  });
}

export async function findEmployeeByEmail(email: string) {
  if (supabaseEnabled()) {
    await ready();
    return (await remoteFindEmployee(email)) as DB["employees"][number] | null;
  }
  const db = await read();
  return db.employees.find((e) => e.email.toLowerCase() === email.toLowerCase()) ?? null;
}

type Scope = { isSuper: boolean; email: string; role?: string };
export type Counts = { clients: number; uploads: number; draftsAwaiting: number; finals: number; newLeads: number; inquiries: number };
export type Stats = Counts & {
  pendingApprovals: number;
  months: { label: string; key: string; n: number }[];
  recentClients: DB["clients"];
  recentInquiries: DB["inquiries"];
  recentLogs: DB["logs"];
  taxYear: string;
  companyName: string;
};

/**
 * Sidebar counters only. Live: six COUNT queries in parallel that transfer no rows
 * (previously every page navigation downloaded every client, document, lead, inquiry and log row).
 */
export async function counts(scope: Scope): Promise<Counts> {
  if (!supabaseEnabled()) {
    const s: Stats = await stats(scope);
    return { clients: s.clients, uploads: s.uploads, draftsAwaiting: s.draftsAwaiting, finals: s.finals, newLeads: s.newLeads, inquiries: s.inquiries };
  }
  const ids = scope.isSuper ? null : await clientIdsFor(scope.email);
  const docs = (w: Where): Promise<number> => (ids && !ids.length ? Promise.resolve(0) : countWhere("documents", ids ? [...w, { field: "clientId", op: "in", value: ids }] : w));
  const [uploads, draftsAwaiting, finals, newLeads, inquiries, clients] = await Promise.all([
    docs([{ field: "kind", value: "upload" }]),
    docs([{ field: "kind", value: "draft" }, { field: "status", value: "awaiting_review" }]),
    docs([{ field: "kind", value: "final" }]),
    scope.isSuper ? countWhere("leads", [{ field: "status", value: "new" }]) : Promise.resolve(0),
    scope.isSuper ? countWhere("inquiries") : Promise.resolve(0),
    ids ? Promise.resolve(ids.length) : countWhere("clients"),
  ]);
  return { clients, uploads, draftsAwaiting, finals, newLeads, inquiries };
}

/** Dashboard counters + the last 6 months of document activity. */
export async function stats(scope?: Scope): Promise<Stats> {
  if (supabaseEnabled() && scope) return remoteStats(scope);
  const local = supabaseEnabled()
    ? ({ settings: await getSettings(), logs: await list<DB["logs"][number]>("logs") } as Pick<DB, "settings" | "logs">)
    : await read();
  const limited = scope && !scope.isSuper;
  let [clients, documents, leads, inquiries] = await Promise.all([
    list<DB["clients"][number]>("clients"),
    list<DB["documents"][number]>("documents"),
    limited ? Promise.resolve([] as DB["leads"]) : list<DB["leads"][number]>("leads"),
    limited ? Promise.resolve([] as DB["inquiries"]) : list<DB["inquiries"][number]>("inquiries"),
  ]);
  if (limited) {
    // Employees only count the clients assigned to them.
    clients = clients.filter((c) => String(c.assignedTo ?? "").toLowerCase() === scope.email.toLowerCase());
    const ids = new Set(clients.map((c) => c.id));
    documents = documents.filter((d) => ids.has(d.clientId));
  }
  const db = { ...local, clients, documents, leads, inquiries, logs: limited ? [] : local.logs };
  const months: { label: string; key: string; n: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    months.push({ label: d.toLocaleString("en-US", { month: "short" }), key: `${d.getFullYear()}-${d.getMonth()}`, n: 0 });
  }
  for (const doc of db.documents) {
    const d = new Date(doc.createdAt);
    const m = months.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (m) m.n++;
  }
  return {
    clients: db.clients.length,
    uploads: db.documents.filter((d) => d.kind === "upload").length,
    draftsAwaiting: db.documents.filter((d) => d.kind === "draft" && d.status === "awaiting_review").length,
    pendingApprovals: limited ? 0 : db.clients.filter((c) => c.pendingTo || c.pendingStage).length,
    finals: db.documents.filter((d) => d.kind === "final").length,
    newLeads: db.leads.filter((l) => l.status === "new").length,
    inquiries: db.inquiries.length,
    months,
    recentClients: [...db.clients].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    recentInquiries: [...db.inquiries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    recentLogs: db.logs.slice(0, 6),
    taxYear: db.settings.taxYear,
    companyName: db.settings.companyName,
  };
}

/** Next free queue code for a role, e.g. "TP3". */
export async function nextEmployeeCode(role: string) {
  const { ROLE_PREFIX, normalizeRole } = await import("./workflow-shared");
  const prefix = ROLE_PREFIX[normalizeRole(role)];
  const employees = supabaseEnabled() ? await list<DB["employees"][number]>("employees") : (await read()).employees;
  const used = employees.map((e) => String(e.code || "").toUpperCase());
  let n = 1;
  while (used.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Live dashboard: counts + only the rows the page shows (6 recent clients, 5 inquiries, 6 log lines,
 * document dates for the 6-month chart), all in parallel. Previously this loaded every row of six tables,
 * including the whole activity log.
 */
async function remoteStats(scope: Scope): Promise<Stats> {
  const months: { label: string; key: string; n: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    months.push({ label: d.toLocaleString("en-US", { month: "short" }), key: `${d.getFullYear()}-${d.getMonth()}`, n: 0 });
  }
  const from = new Date();
  from.setMonth(from.getMonth() - 5, 1);
  from.setHours(0, 0, 0, 0);
  const ids = scope.isSuper ? null : await clientIdsFor(scope.email);
  const own = (w: Where): Where => (ids ? [...w, { field: "clientId", op: "in", value: ids }] : w);
  const none = ids !== null && ids.length === 0;
  const [settings, c, recentClients, chartDocs, recentInquiries, recentLogs] = await Promise.all([
    getSettings(),
    counts(scope),
    ids ? (none ? Promise.resolve([]) : listWhere<DB["clients"][number]>("clients", [{ field: "id", op: "in", value: ids }], { limit: 6 })) : listWhere<DB["clients"][number]>("clients", [], { limit: 6 }),
    none ? Promise.resolve([]) : listWhere<DB["documents"][number]>("documents", own([{ field: "createdAt", op: "gte", value: from.toISOString() }]), { columns: "id, created_at, customer_id, kind" }),
    scope.isSuper ? listWhere<DB["inquiries"][number]>("inquiries", [], { limit: 5 }) : Promise.resolve([] as DB["inquiries"]),
    scope.isSuper ? listWhere<DB["logs"][number]>("logs", [], { limit: 6 }) : Promise.resolve([] as DB["logs"]),
  ]);
  for (const doc of chartDocs) {
    if (!docKindAllowed(scope.role, scope.isSuper, doc.kind)) continue; // role-hidden kinds (e.g. Tax Preparer: drafts/finals)
    const d = new Date(doc.createdAt);
    const m = months.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (m) m.n++;
  }
  return {
    ...c,
    pendingApprovals: 0,
    months,
    recentClients,
    recentInquiries,
    recentLogs,
    taxYear: settings.taxYear,
    companyName: settings.companyName,
  };
}
