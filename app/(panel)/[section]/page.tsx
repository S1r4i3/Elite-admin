import { notFound, redirect } from "next/navigation";
import { AdminPage, pageAccess } from "@/app/admin-layout";
import { DataTable } from "@/components/data-table";
import { SECTIONS, sectionBySlug } from "@/lib/sections";
import { getStaff } from "@/lib/workflow";
import { canSeeDocKind } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Every list page (clients, documents, drafts, leads, CMS…) is rendered from lib/sections.ts. */
export function generateStaticParams() {
  return SECTIONS.map((s) => ({ section: s.slug }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const section = sectionBySlug((await params).section);
  if (!section) notFound();
  const access = await pageAccess();
  if (section.superOnly && !access.isSuper) redirect("/");
  if (section.docKind && !canSeeDocKind(access, section.docKind)) redirect("/");

  // Staff list with queue codes (DH1, TP1…) for "Move to" and the Admin's assign field.
  const staff = section.collection === "clients" ? await getStaff() : [];
  const employees = access.isSuper ? staff.filter((s) => s.role !== "Admin").map((s) => s.email) : [];

  return (
    <AdminPage>
      <DataTable
        section={section}
        isSuper={access.isSuper}
        employees={employees}
        staff={staff}
        me={{ email: access.email, role: access.role, code: access.code, isSuper: access.isSuper }}
      />
    </AdminPage>
  );
}
