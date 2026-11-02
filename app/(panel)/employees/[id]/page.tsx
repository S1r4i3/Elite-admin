import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage, pageAccess } from "@/app/admin-layout";
import { decorateClients, employeeStats, listHandoffs } from "@/lib/workflow";
import { ROLE_LABEL, STAGE_LABEL, normalizeRole, staffLabel, type Stage } from "@/lib/workflow-shared";
import { get, listWhere } from "@/lib/db";
import { Badge } from "@/components/data-table";
import type { Client, Employee } from "@/lib/types";

export const dynamic = "force-dynamic";

const when = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** One employee: workload (current / total clients) and every move they were part of. Admin only. */
export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pageAccess({ superOnly: true });
  const emp = await get<Employee>("employees", id);
  if (!emp) notFound();
  const email = emp.email.toLowerCase();
  const [stats, clients, history] = await Promise.all([
    employeeStats(),
    listWhere<Client>("clients", [{ field: "assignedTo", value: email }]).then(decorateClients),
    listHandoffs({ email, limit: 300 }),
  ]);
  const s = stats.get(email) ?? { currentClients: 0, totalClients: 0, moves: 0 };
  const open = clients.filter((c) => c.stage !== "closed" && c.stage !== "filed");
  const role = ROLE_LABEL[normalizeRole(emp.role)];

  return (
    <AdminPage>
      <div className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>
            <Link href="/employees">← Employees</Link>
          </p>
          <h1>{emp.name}</h1>
          <p>
            {staffLabel(emp)} · {emp.email} · <Badge value={emp.status} />
          </p>
        </div>
      </div>

      <div className="grid grid-3">
        {[
          ["Current clients", s.currentClients, "Clients with this person right now"],
          ["Total clients", s.totalClients, "Different clients they have ever held"],
          ["Moves & actions", s.moves, "Hand-offs and workflow steps they made"],
        ].map(([label, n, hint]) => (
          <div className="card stat" key={String(label)}>
            <div>
              <b>{n}</b>
              <span>{label}</span>
              <br />
              <small className="subtle">{hint}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-2 mt-16">
        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>Current clients ({open.length})</h2>
          {open.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No open clients with this {role} right now.
            </p>
          ) : (
            open.map((c) => (
              <div className="list-row" key={c.id}>
                <span className="grow">
                  <Link href={`/clients/${c.id}`}>
                    <strong>
                      {c.firstName} {c.lastName}
                    </strong>
                  </Link>
                  <small>
                    {c.clientId} · {STAGE_LABEL[(c.stage || "unassigned") as Stage]}
                  </small>
                </span>
              </div>
            ))
          )}
        </div>

        <div className="card card-pad">
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>Move history ({history.length})</h2>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No moves yet.
            </p>
          ) : (
            history.map((h) => (
              <div className="list-row" key={h.id}>
                <span className="grow">
                  <Link href={`/clients/${h.clientId}`}>
                    <strong>
                      {h.clientName} {h.clientCode ? `(${h.clientCode})` : ""}
                    </strong>
                  </Link>
                  <small>
                    {h.from} → {h.to} · {h.actionLabel || (h.status === "admin" ? "Moved by Admin" : "Moved")} by {h.requestedBy}
                    {h.note ? ` · “${h.note}”` : ""}
                  </small>
                </span>
                <small className="subtle">{when(h.decidedAt || h.createdAt)}</small>
              </div>
            ))
          )}
        </div>
      </div>
    </AdminPage>
  );
}
