"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SECTIONS, NAV_GROUPS } from "@/lib/sections";
import { LiveUpdates } from "./live-updates";

type Counts = Partial<Record<string, number>>;

/** Sidebar + topbar shell used by every admin page. */
export function Shell({
  children,
  admin,
  isSuper = false,
  taxYear,
  live = false,
}: {
  children: React.ReactNode;
  admin: { email: string; name?: string; role?: string };
  isSuper?: boolean;
  taxYear: string;
  live?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({});
  const [busy, setBusy] = useState(false);

  const loadCounts = useCallback(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.stats && setCounts(j.stats))
      .catch(() => {});
  }, []);

  useEffect(loadCounts, [pathname, loadCounts]);

  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="shell">
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">
          <img className="logo-mark" src="/brand/ebt-mark.png" alt="Elite B Tax Services" width={320} height={162} />
          <span className="brand-text">
            <strong>
              ELITE <em>B</em> TAX
            </strong>
            <small>Admin Panel</small>
          </span>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            ✕
          </button>
        </div>

        <nav className="nav" aria-label="Admin sections">
          <div className="nav-group">
            <p className="nav-group-title">Overview</p>
            <Link href="/" className={isActive("/") ? "active" : ""}>
              <span className="ico">🏠</span>Dashboard
            </Link>
          </div>

          {isSuper && (
            <div className="nav-group">
              <p className="nav-group-title">Workflow</p>
              <Link href="/approvals" className={isActive("/approvals") ? "active" : ""}>
                <span className="ico">✅</span>
                <span style={{ flex: 1 }}>Approvals</span>
                {!!counts.pendingApprovals && <span className="count">{counts.pendingApprovals}</span>}
              </Link>
            </div>
          )}

          {NAV_GROUPS.filter((group) => SECTIONS.some((s) => s.group === group && (isSuper || !s.superOnly))).map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-group-title">{group}</p>
              {SECTIONS.filter((s) => s.group === group && (isSuper || !s.superOnly)).map((s) => {
                const n = s.countKey ? counts[s.countKey] : undefined;
                return (
                  <Link key={s.slug} href={`/${s.slug}`} className={isActive(`/${s.slug}`) ? "active" : ""}>
                    <span className="ico">{s.icon}</span>
                    <span style={{ flex: 1 }}>{s.label}</span>
                    {!!n && <span className="count">{n}</span>}
                  </Link>
                );
              })}
            </div>
          ))}

          {isSuper && (
            <div className="nav-group">
              <p className="nav-group-title">Settings</p>
              <Link href="/settings" className={isActive("/settings") ? "active" : ""}>
                <span className="ico">⚙️</span>Settings
              </Link>
            </div>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="avatar">{admin.email.slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-user">
            <strong>{admin.name || "Signed in"}</strong>
            <small>
              {admin.role ? `${admin.role} · ` : ""}
              {admin.email}
            </small>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <Clocks />
          <div className="topbar-right">
            {live && <LiveUpdates onChange={loadCounts} />}
            <span className="pill">Taxation Year {taxYear}</span>
            <button className="btn btn-ghost" onClick={logout} disabled={busy}>
              {busy ? "…" : "Logout"}
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="foot">© {new Date().getFullYear()} Elite B Tax Services. All rights reserved.</footer>
      </div>
    </div>
  );
}

const ZONES: [string, string][] = [
  ["EST", "America/New_York"],
  ["CST", "America/Chicago"],
  ["MST", "America/Denver"],
  ["PST", "America/Los_Angeles"],
  ["AKST", "America/Anchorage"],
  ["India", "Asia/Kolkata"],
];

function Clocks() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="clocks" />;
  return (
    <div className="clocks">
      {ZONES.map(([label, tz]) => (
        <span key={label}>
          <b>{label}</b>{" "}
          {now.toLocaleString("en-US", {
            timeZone: tz,
            month: "numeric",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      ))}
    </div>
  );
}
