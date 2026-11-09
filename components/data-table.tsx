"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Field, Section } from "@/lib/sections";
import type { Client, Row } from "@/lib/types";
import { Modal, FormModal, confirmDialog } from "./modal";
import { UploadForm } from "./upload-form";
import { LIVE_EVENT, type LiveChange } from "./live-updates";
import { MoveModal } from "./move-modal";
import { apiJson } from "@/lib/api-client";
import { toast } from "./toaster";
import { LoadingButton } from "./loading-button";
import { availableActions, DOC_STATUS_LABEL, MOVE_TARGETS, normalizeRole, ROLE_LABEL, STAGE_FOR_ROLE, STAGE_LABEL, type DocStatus, type StaffMember } from "@/lib/workflow-shared";

const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const fmtDateTime = (v: unknown) => (v ? new Date(String(v)).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtSize = (kb: unknown) => (Number(kb) >= 1024 ? (Number(kb) / 1024).toFixed(1) + " MB" : Math.round(Number(kb) || 0) + " KB");

const BADGE: Record<string, string> = {
  active: "badge-ok",
  approved: "badge-ok",
  converted: "badge-ok",
  true: "badge-ok",
  pending: "badge-warn",
  changes_requested: "badge-warn",
  awaiting_review: "badge-brand",
  with_reviewer: "badge-warn",
  new: "badge-brand",
  contacted: "badge-info",
  qualified: "badge-info",
  inactive: "badge-muted",
  false: "badge-muted",
  closed: "badge-muted",
};
const LABEL: Record<string, string> = {
  received: "Docs received",
  unassigned: STAGE_LABEL.unassigned,
  documents: STAGE_LABEL.documents,
  preparation: STAGE_LABEL.preparation,
  review: STAGE_LABEL.review,
  client_review: STAGE_LABEL.client_review,
  filing: STAGE_LABEL.filing,
  accepted: STAGE_LABEL.accepted,
  filed: STAGE_LABEL.filed,
  awaiting_review: "Awaiting client review",
  with_reviewer: "With reviewer — not sent to client",
  changes_requested: "Changes requested",
  approved: "Approved by client",
  true: "Shown",
  false: "Hidden",
};

export function Badge({ value }: { value: unknown }) {
  const v = String(value ?? "");
  if (!v) return <span className="subtle">—</span>;
  return <span className={`badge ${BADGE[v] || "badge-muted"}`}>{LABEL[v] || v.replace(/_/g, " ")}</span>;
}

/**
 * Table page for one section: loads rows from /api/{collection}, with search,
 * filters, sorting, pagination, CSV export and add/edit/delete modals.
 */
export function DataTable({
  section: base,
  isSuper = false,
  employees = [],
  me = null,
  staff = [],
}: {
  section: Section;
  isSuper?: boolean;
  employees?: string[];
  me?: { email: string; role: string; code: string; isSuper: boolean } | null;
  staff?: StaffMember[];
}) {
  // Employees don't see Super-Admin-only columns/fields, and can't add or delete client accounts.
  const section = useMemo<Section>(() => {
    const fields = base.fields
      .filter((f) => isSuper || !f.superOnly)
      .map((f) => (f.optionsFrom === "employees" ? { ...f, options: ["Unassigned", ...employees] } : f));
    return {
      ...base,
      fields,
      columns: base.columns.filter((c) => isSuper || !c.superOnly),
      addLabel: !isSuper && base.collection === "clients" ? undefined : base.addLabel,
      title: !isSuper && base.collection === "clients" ? `My clients${me?.code ? ` — ${me.code}` : ""}` : base.title,
      subtitle: !isSuper && base.collection === "clients" ? "Clients currently with you. Hand a client on with “Move to” — it moves straight away." : base.subtitle,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, isSuper, employees.join(",")]);
  const canDelete = isSuper || base.collection === "documents";
  /** The holder (or an Admin) can move a client and update its Doc status. */
  const canWork = (row: Row) => isSuper || (!!me && String(row.assignedTo ?? "").toLowerCase() === me.email);
  const isPending = (row: Row) => Boolean(row.pendingTo || row.pendingStage);

  const [savingId, setSavingId] = useState<string | null>(null);
  const setDocStatus = async (row: Row, docStatus: string) => {
    // Show the new value at once; roll back if the server refuses.
    const before = row.docStatus;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, docStatus } : r)));
    try {
      await apiJson(`/api/clients/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ docStatus }) });
      toast.success("Doc status saved.");
      void load(true);
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, docStatus: before } : r)));
      toast.error((e as Error).message || "Could not update the doc status.");
    } finally {
      setSavingId(null);
    }
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const setNotice = (text: string) => toast.success(text);
  const [refreshing, setRefreshing] = useState(false);
  const perPage = 10;

  const clientsLoaded = useRef(false);

  // Only the newest request may update the table (an older, slower response must not overwrite a newer one).
  const reqSeq = useRef(0);
  const load = useCallback(async (silent = false, refreshClients = false) => {
    const seq = ++reqSeq.current;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const params = new URLSearchParams(section.query || {});
      const json = await apiJson<{ rows: Row[] }>(`/api/${section.collection}?${params}`, { cache: "no-store" });
      if (seq !== reqSeq.current) return;
      setRows(json.rows);
      setError(null);
      // Document rows now arrive with clientName from the API; only other collections need the client list.
      if (section.collection !== "documents" && section.collection !== "clients" && section.columns.some((c) => c.cell === "client") && (!clientsLoaded.current || refreshClients)) {
        const cr = await apiJson<{ rows: Client[] }>("/api/clients", { cache: "no-store" }).catch(() => null);
        if (cr && seq === reqSeq.current) {
          setClients(cr.rows);
          clientsLoaded.current = true;
        }
      }
    } catch (e) {
      if (seq !== reqSeq.current) return;
      // A quiet background refresh keeps the rows already on screen; only a visible load shows the error state.
      if (silent) toast.error((e as Error).message);
      else setError((e as Error).message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: reload quietly when the website changes this collection.
  // Debounced — one upload fires several row events, which used to trigger several full reloads.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let withClients = false;
    const onLive = (e: Event) => {
      const c = (e as CustomEvent<LiveChange>).detail;
      if (c.collection === section.collection || (c.collection === "handoffs" && section.collection === "clients") || (c.collection === "clients" && section.columns.some((col) => col.cell === "client"))) {
        withClients = withClients || c.collection === "clients";
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          load(true, withClients);
          withClients = false;
        }, 400);
      }
    };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => {
      window.removeEventListener(LIVE_EVENT, onLive);
      if (timer) clearTimeout(timer);
    };
  }, [load, section]);

  const clientName = (id: unknown) => {
    const c = clients.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : "—";
  };

  const view = useMemo(() => {
    let out = rows;
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter((r) => section.search.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)));
    }
    for (const [k, v] of Object.entries(filters)) if (v) out = out.filter((r) => String(r[k] ?? "") === v);
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key] ?? "";
        const y = b[sort.key] ?? "";
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [rows, q, filters, sort, section.search]);

  const pages = Math.max(1, Math.ceil(view.length / perPage));
  const pageRows = view.slice((Math.min(page, pages) - 1) * perPage, Math.min(page, pages) * perPage);

  const cell = (row: Row, key: string, kind?: string) => {
    const v = row[key];
    switch (kind) {
      case "strong":
        return <strong>{String(v ?? "—")}</strong>;
      case "fullname":
        return (
          <Link href={`/clients/${row.id}`}>
            <strong>
              {String(row.firstName ?? "")} {String(row.lastName ?? "")}
            </strong>
          </Link>
        );
      case "docstatus": {
        const ds = (String(v || "pending") as DocStatus);
        if (canWork(row))
          return (
            <select className="select-sm" value={ds} onChange={(e) => setDocStatus(row, e.target.value)} aria-label="Doc status" disabled={savingId === row.id} aria-busy={savingId === row.id}>
              {(Object.keys(DOC_STATUS_LABEL) as DocStatus[]).map((k) => (
                <option key={k} value={k}>
                  {DOC_STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          );
        return <span className={`badge ${ds === "received" ? "badge-ok" : "badge-warn"}`}>{DOC_STATUS_LABEL[ds] ?? ds}</span>;
      }
      case "prep": {
        const text = String(v || "—");
        const cls = text.startsWith("Awaiting") ? "badge-brand" : text.startsWith("Move rejected") ? "badge-warn" : text === "Filed" ? "badge-ok" : text.startsWith("Moved") ? "badge-info" : "badge-muted";
        return (
          <span className={`badge ${cls}`} title={row.pendingNote ? `Note: ${String(row.pendingNote)}` : undefined} style={{ whiteSpace: "normal" }}>
            {text}
          </span>
        );
      }
      case "mono":
        return <span className="mono">{String(v ?? "—")}</span>;
      case "employee":
        return (
          <Link href={`/employees/${row.id}`}>
            <strong>{String(v ?? "—")}</strong>
          </Link>
        );
      case "role": {
        const label = ROLE_LABEL[normalizeRole(v)];
        return row.code ? `${String(row.code)} · ${label}` : label;
      }
      case "count":
        return <b>{Number(v ?? 0)}</b>;
      case "badge":
        return <Badge value={v} />;
      case "date":
        return fmtDate(v);
      case "datetime":
        return fmtDateTime(v);
      case "size":
        return fmtSize(v);
      case "money":
        return `$${v ?? 0}`;
      case "tel":
        return v ? <a href={`tel:${String(v).replace(/[^\d+]/g, "")}`}>{String(v)}</a> : "—";
      case "client":
        return section.collection === "clients" ? (
          <>
            <strong>
              {String(row.firstName)} {String(row.lastName)}
            </strong>
            <br />
            <small className="subtle">{String(row.email)}</small>
          </>
        ) : (
          String(row.clientName ?? clientName(v))
        );
      default: {
        const text = String(v ?? "");
        return text.length > 60 ? text.slice(0, 60) + "…" : text || "—";
      }
    }
  };

  const save = async (data: Record<string, string>, row: Row | null) => {
    const url = row ? `/api/${section.collection}/${row.id}` : `/api/${section.collection}`;
    const body = { ...data, ...(row ? {} : section.query || {}) };
    // Throws with the server's message → FormModal shows it inline and restores the button.
    await apiJson(url, { method: row ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    toast.success(row ? "Changes saved." : "Added.");
    void load(true);
  };

  const del = (row: Row) =>
    confirmDialog("Delete this record? This can't be undone.", async () => {
      await apiJson(`/api/${section.collection}/${row.id}`, { method: "DELETE" });
      // Remove it from the table at once; the quiet reload confirms.
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      toast.success("Deleted.");
      void load(true);
    });

  const exportCsv = () => {
    const keys = section.columns.map((c) => c.key);
    const lines = [section.columns.map((c) => c.label).join(",")].concat(
      view.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `${section.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{section.title}</h1>
          <p>{section.subtitle}</p>
        </div>
        <div className="actions">
          {section.uploadKind && (
            <button className="btn btn-primary" onClick={() => setUploading(true)}>
              ⬆ Upload {section.uploadKind === "draft" ? "draft estimation" : section.uploadKind === "final" ? "final document" : "document"}
            </button>
          )}
          {section.addLabel && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              + {section.addLabel}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-tools">
          <input className="search" type="search" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          {(section.filters || []).map((f) => (
            <select
              key={f.key}
              className="select-sm"
              value={filters[f.key] || ""}
              onChange={(e) => { setFilters((s) => ({ ...s, [f.key]: e.target.value })); setPage(1); }}
            >
              <option value="">{f.label}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {LABEL[o] || o}
                </option>
              ))}
            </select>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <LoadingButton
              className="btn btn-secondary btn-sm"
              spinnerDark
              loading={refreshing}
              loadingText="Refreshing…"
              onClick={async () => {
                setRefreshing(true);
                await load(true);
                setRefreshing(false);
              }}
            >
              ↻ Refresh
            </LoadingButton>
            <button className="btn btn-secondary btn-sm" onClick={exportCsv}>
              ⬇ CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="page-skeleton" style={{ padding: 16, gap: 10 }} role="status" aria-busy="true">
            <span className="sr-only">Loading {section.title.toLowerCase()}…</span>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="sk sk-row" />
            ))}
          </div>
        ) : error ? (
          <div className="empty" role="alert">
            <div className="big">⚠️</div>
            <p>{error}</p>
            <button className="btn btn-secondary btn-sm" onClick={() => load()}>
              Try again
            </button>
          </div>
        ) : pageRows.length === 0 ? (
          <div className="empty">
            <div className="big">📭</div>
            {!isSuper && (base.collection === "clients" || base.collection === "documents") && rows.length === 0 ? (
              <p>
                No clients are assigned to you yet.
                <br />
                <small className="muted">A Super Admin assigns clients under All Clients → Edit → Assigned employee.</small>
              </p>
            ) : (
              <p>Nothing here yet.</p>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {section.columns.map((c) => (
                      <th
                        key={c.key}
                        className="sortable"
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                      >
                        {c.label}
                        {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      {section.columns.map((c) => (
                        <td key={c.key}>{cell(r, c.key, c.cell)}</td>
                      ))}
                      <td>
                        <div className="row-actions">
                          {section.collection === "clients" && (
                            <Link className="btn btn-secondary btn-sm" href={`/clients/${r.id}`}>
                              View
                            </Link>
                          )}
                          {section.collection === "clients" && me && canWork(r) && (isSuper || !isPending(r)) && (() => {
                            // DH and TP hand clients on with "Move to"; Reviewers and Tax Filers decide on the client page.
                            // Admins can do both: move anyone anywhere, and take any workflow action.
                            const role = normalizeRole(me.role);
                            const canMove = isSuper || (!!MOVE_TARGETS[role] && r.stage === STAGE_FOR_ROLE[role]);
                            const acts = canMove && !isSuper ? [] : availableActions(r as unknown as Client, me);
                            return (
                              <>
                                {acts.length > 0 && (
                                  <Link className="btn btn-primary btn-sm" href={`/clients/${r.id}#workflow`} title={acts.map((a) => a.label).join(" · ")}>
                                    {role === "Reviewer" ? "Review →" : "Take action →"}
                                  </Link>
                                )}
                                {canMove && (
                                  <button className={`btn btn-sm ${acts.length > 0 ? "btn-secondary" : "btn-primary"}`} onClick={() => setMoving(r)}>
                                    Move to →
                                  </button>
                                )}
                              </>
                            );
                          })()}
                          {section.collection === "documents" && (
                            <a className="btn btn-secondary btn-sm" href={`/api/files/${r.id}`}>
                              Download
                            </a>
                          )}
                          {section.fields.length > 0 && (
                            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(r)}>
                              Edit
                            </button>
                          )}
                          {section.collection !== "logs" && canDelete && (
                            <button className="btn btn-ghost btn-sm" onClick={() => del(r)} title="Delete">
                              🗑
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span>
                {view.length} record{view.length === 1 ? "" : "s"}
              </span>
              <span className="spacer" />
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <span>
                Page {Math.min(page, pages)} of {pages}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {adding && (
        <FormModal
          title={section.addLabel || "Add"}
          fields={section.fields}
          submitLabel="Create"
          onClose={() => setAdding(false)}
          onSubmit={async (data) => {
            await save(data, null);
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <FormModal
          title="Edit record"
          fields={section.fields.map((f: Field) =>
            f.type === "password"
              ? { ...f, required: false, value: "" }
              : f.optionsFrom === "employees"
                ? { ...f, value: String(editing[f.name] || "Unassigned") }
                : { ...f, value: String(editing[f.name] ?? "") },
          )}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            await save(data, editing);
            setEditing(null);
          }}
        />
      )}
      {uploading && (
        <UploadForm
          kind={section.uploadKind!}
          onClose={() => setUploading(false)}
          onDone={async () => {
            setUploading(false);
            await load();
          }}
        />
      )}
      {viewing && <Modal title="Record" onClose={() => setViewing(null)}>{JSON.stringify(viewing)}</Modal>}
      {moving && me && (
        <MoveModal
          client={{ id: moving.id, name: `${String(moving.firstName ?? "")} ${String(moving.lastName ?? "")}`.trim(), clientId: String(moving.clientId ?? ""), assignedTo: String(moving.assignedTo ?? "") }}
          me={me}
          staff={staff}
          onClose={() => setMoving(null)}
          onDone={async (pending) => {
            setMoving(null);
            setNotice("Client moved.");
            await load(true);
          }}
        />
      )}
    </>
  );
}
