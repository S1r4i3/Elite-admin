import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage, pageAccess } from "../../admin-layout";
import { canSeeClient } from "@/lib/access";
import { decorateClients, listHandoffs } from "@/lib/workflow";
import { DOC_STATUS_LABEL, STAGE_LABEL, type DocStatus, type Stage } from "@/lib/workflow-shared";
import { get, list } from "@/lib/db";
import { Badge } from "@/components/data-table";
import { ClientDocuments } from "@/components/client-documents";
import type { Client, DocumentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const fmtDate = (v?: string) => (v ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await pageAccess();
  const client = await get<Client>("clients", id);
  // Employees can only open clients assigned to them.
  if (!client || !(await canSeeClient(access, client.id))) notFound();
  const [docs, [wf], history] = await Promise.all([
    list<DocumentRow>("documents").then((all) => all.filter((d) => d.clientId === id)),
    decorateClients([client]),
    listHandoffs({ clientId: id, limit: 50 }),
  ]);

  const facts: [string, string][] = [
    ["Client ID", client.clientId],
    ["Email", client.email],
    ["Phone", client.phone],
    ["Service", client.service],
    ["Tax year", client.taxYear],
    ["Date of birth", client.dob || "—"],
    ["State", client.state || "—"],
    ["Country", client.country || "—"],
    ["Address", client.address || "—"],
    ["Joined", fmtDate(client.createdAt)],
    ["Last login", fmtDate(client.lastLoginAt || undefined)],
  ];

  return (
    <AdminPage>
      <div className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>
            <Link href="/clients">← All clients</Link>
          </p>
          <h1>
            {client.firstName} {client.lastName}
          </h1>
          <p>
            <span className="mono">{client.clientId}</span> · <Badge value={client.status} />
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 14 }}>Client details</h2>
          <dl className="kv">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>Summary</h2>
          <div className="grid grid-3" style={{ gap: 10 }}>
            {[
              ["Uploads", docs.filter((d) => d.kind === "upload").length],
              ["Drafts", docs.filter((d) => d.kind === "draft").length],
              ["Finals", docs.filter((d) => d.kind === "final").length],
            ].map(([label, n]) => (
              <div key={String(label)} style={{ background: "var(--canvas)", borderRadius: 12, padding: "12px 14px" }}>
                <b style={{ fontSize: 22, display: "block" }}>{n}</b>
                <span className="muted" style={{ fontSize: 13 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2 mt-16">
        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 14 }}>Workflow</h2>
          <dl className="kv">
            <div>
              <dt>Stage</dt>
              <dd>{STAGE_LABEL[(wf.stage || "unassigned") as Stage]}</dd>
            </div>
            <div>
              <dt>Currently with</dt>
              <dd className="mono">{wf.holderCode || "Nobody"}</dd>
            </div>
            <div>
              <dt>Doc status</dt>
              <dd>{DOC_STATUS_LABEL[(wf.docStatus || "pending") as DocStatus]}</dd>
            </div>
            <div>
              <dt>Preparation status</dt>
              <dd>{wf.prepStatus}</dd>
            </div>
            {wf.pendingNote ? (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt>Note with the request</dt>
                <dd>{wf.pendingNote}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>Hand-off history</h2>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No moves yet.
            </p>
          ) : (
            history.map((h) => (
              <div className="list-row" key={h.id}>
                <span className="grow">
                  <strong className="mono">
                    {h.from} → {h.to}
                  </strong>
                  <small>
                    {h.status === "pending"
                      ? `Requested by ${h.requestedBy} — awaiting approval`
                      : h.status === "approved"
                        ? `Requested by ${h.requestedBy}, approved by ${h.decidedBy}`
                        : h.status === "rejected"
                          ? `Rejected by ${h.decidedBy}: ${h.reason}`
                          : h.status === "admin"
                            ? `Moved by ${h.requestedBy} (Admin)`
                            : `Cancelled — ${h.reason}`}
                    {h.note ? ` · “${h.note}”` : ""}
                  </small>
                </span>
                <small className="subtle">{new Date(h.decidedAt || h.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-16">
        <ClientDocuments clientId={client.id} initial={docs} />
      </div>
    </AdminPage>
  );
}
