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

/**
 * The sidebar shell for every signed-in page, rendered once by app/(panel)/layout.tsx.
 * Because it lives in a layout it stays mounted between pages: the sidebar never flashes,
 * and app/(panel)/loading.tsx can show a skeleton inside it the instant a link is clicked.
 */
export async function PanelShell({ children }: { children: React.ReactNode }) {
  const [access, settings] = await Promise.all([pageAccess(), getSettings()]);
  return (
    <Shell admin={{ email: access.email, name: access.name, role: access.role, code: access.code }} isSuper={access.isSuper} taxYear={settings.taxYear} live={isLive()}>
      {children}
    </Shell>
  );
}

/** Kept so pages can stay unchanged; the shell itself now comes from the (panel) layout. */
export function AdminPage({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
