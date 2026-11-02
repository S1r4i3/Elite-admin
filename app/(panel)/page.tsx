import Link from "next/link";
import { AdminPage, pageAccess } from "@/app/admin-layout";
import { stats } from "@/lib/db";

export const dynamic = "force-dynamic";

const fmtDate = (v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function DashboardPage() {
  const access = await pageAccess();
  const s = await stats(access);
  const max = Math.max(1, ...s.months.map((m) => m.n));

  const cards = [
    { ico: "👥", n: s.clients, label: "Total clients", href: "/clients" },
    { ico: "📄", n: s.uploads, label: "Client documents", href: "/documents" },
    { ico: "🧮", n: s.draftsAwaiting, label: "Drafts awaiting review", href: "/drafts" },
    { ico: "✅", n: s.finals, label: "Final documents", href: "/finals" },
  ];

  return (
    <AdminPage>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {s.companyName} — taxation year {s.taxYear}
          </p>
        </div>
      </div>

      <div className="grid grid-4">
        {cards.map((c) => (
          <Link key={c.label} className="card stat link-plain" href={c.href}>
            <span className="ico">{c.ico}</span>
            <span>
              <b>{c.n}</b>
              <span>{c.label}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-2 mt-16">
        <div className="card">
          <div className="card-head">
            <h2>Documents received</h2>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
              last 6 months
            </span>
          </div>
          <div className="chart">
            {s.months.map((m) => (
              <span className="bar" key={m.key}>
                <b>{m.n}</b>
                <i style={{ height: `${Math.round((m.n / max) * 100)}%` }} />
              </span>
            ))}
          </div>
          <div className="chart-labels">
            {s.months.map((m) => (
              <span key={m.key}>{m.label}</span>
            ))}
          </div>
        </div>

        {access.isSuper && (
        <div className="card">
          <div className="card-head">
            <h2>Recent website inquiries</h2>
            <Link href="/inquiries" style={{ marginLeft: "auto", fontSize: 13 }}>
              View all
            </Link>
          </div>
          <div className="card-pad" style={{ paddingTop: 4 }}>
            {s.recentInquiries.length === 0 ? (
              <p className="muted">No inquiries yet.</p>
            ) : (
              s.recentInquiries.map((i) => (
                <div className="list-row" key={i.id}>
                  <span className="grow">
                    <strong>{i.name}</strong>
                    <small>
                      {i.phone} · {i.message || "No message"}
                    </small>
                  </span>
                  <small className="subtle">{fmtDate(i.createdAt)}</small>
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>

      <div className="grid grid-2 mt-16">
        <div className="card">
          <div className="card-head">
            <h2>Newest clients</h2>
            <Link href="/clients" style={{ marginLeft: "auto", fontSize: 13 }}>
              View all
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Name</th>
                  <th>Service</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {s.recentClients.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.clientId}</td>
                    <td>
                      <Link href={`/clients/${c.id}`}>
                        {c.firstName} {c.lastName}
                      </Link>
                    </td>
                    <td>{c.service}</td>
                    <td>{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {access.isSuper && (
        <div className="card">
          <div className="card-head">
            <h2>Activity log</h2>
            <Link href="/logs" style={{ marginLeft: "auto", fontSize: 13 }}>
              View all
            </Link>
          </div>
          <div className="card-pad" style={{ paddingTop: 4 }}>
            {s.recentLogs.map((g) => (
              <div className="list-row" key={g.id}>
                <span className="grow">
                  <strong>{g.action}</strong>
                  <small>
                    {g.who}
                    {g.detail ? ` · ${g.detail}` : ""}
                  </small>
                </span>
                <small className="subtle">{fmtDateTime(g.createdAt)}</small>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>
    </AdminPage>
  );
}
