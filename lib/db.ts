import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth";
import type { Client, Collection, DB, DocumentRow, Row, Settings } from "./types";
import { SERVICES } from "./types";
import { supabaseEnabled } from "./supabase";
import { isRemote, remoteCreate, remoteGet, remoteList, remoteRemove, remoteUpdate } from "./remote";

/** Clients, documents, leads and inquiries come from the website's Supabase when configured. */
const live = (coll: Collection) => supabaseEnabled() && isRemote(coll);
export const isLive = () => supabaseEnabled();

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
    services: SERVICES.map((name, i) => ({
      id: randomUUID(),
      name,
      price: [149, 99, 199, 129, 179, 299, 349, 279, 499, 249, 199, 229][i] ?? 199,
      active: "true",
      createdAt: iso(40 + i),
    })),
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

export const getSettings = async (): Promise<Settings> => (await read()).settings;

export const saveSettings = (patch: Partial<Settings>) =>
  mutate((db) => {
    Object.assign(db.settings, patch);
    return db.settings;
  });

export async function list<T extends Row>(coll: Collection): Promise<T[]> {
  if (live(coll) && isRemote(coll)) return (await remoteList(coll)) as T[];
  const db = await read();
  return [...(db[coll] as unknown as T[])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function get<T extends Row>(coll: Collection, id: string): Promise<T | null> {
  if (live(coll) && isRemote(coll)) return (await remoteGet(coll, id)) as T | null;
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
  const db = await read();
  return db.employees.find((e) => e.email.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Dashboard counters + the last 6 months of document activity. */
export async function stats(scope?: { isSuper: boolean; email: string }) {
  const local = await read();
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
  const db = await read();
  const used = db.employees.map((e) => String(e.code || "").toUpperCase());
  let n = 1;
  while (used.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
