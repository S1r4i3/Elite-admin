import { redirect } from "next/navigation";
import { getAccess, type Access } from "@/lib/access";
import { getSettings, isLive } from "@/lib/db";
import { Shell } from "@/components/shell";

/** The signed-in admin for a page, or a redirect to login (clears a stale/invalid cookie first). */
export async function pageAccess(opts: { superOnly?: boolean } = {}): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/api/auth/logout?next=/login");
  if (opts.superOnly && !access.isSuper) redirect("/");
  return access;
}

/** Verifies the session, then renders the sidebar shell around a page. */
export async function AdminPage({ children }: { children: React.ReactNode }) {
  const access = await pageAccess();
  const settings = await getSettings();
  return (
    <Shell admin={{ email: access.email, name: access.name, role: access.role }} isSuper={access.isSuper} taxYear={settings.taxYear} live={isLive()}>
      {children}
    </Shell>
  );
}
