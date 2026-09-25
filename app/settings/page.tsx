import { AdminPage, pageAccess } from "../admin-layout";
import { getSettings } from "@/lib/db";
import { SettingsForms } from "@/components/settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await pageAccess({ superOnly: true });
  const settings = await getSettings();
  return (
    <AdminPage>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Company details, social links and SEO text</p>
        </div>
      </div>
      <SettingsForms initial={settings} />
    </AdminPage>
  );
}
