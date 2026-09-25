import { AdminPage, pageAccess } from "../admin-layout";
import { Approvals } from "@/components/approvals";

export const dynamic = "force-dynamic";

/** Manager view: every client move waiting for approval, plus the recent hand-off history. */
export default async function ApprovalsPage() {
  await pageAccess({ superOnly: true });
  return (
    <AdminPage>
      <Approvals />
    </AdminPage>
  );
}
