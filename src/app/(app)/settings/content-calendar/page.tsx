import { getCurrentTenant } from "@/lib/auth";
import { getContentCalendarConfig } from "@/lib/content-calendar/config";
import { ContentCalendarSettingsEditor } from "@/components/settings/ContentCalendarSettingsEditor";
import { SettingsPageHeading } from "../_shared";

export default async function ContentCalendarSettingsPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";
  const config = await getContentCalendarConfig(tenantSlug);

  return (
    <div className="max-w-[720px]">
      <SettingsPageHeading
        title="Content calendar"
        subtitle="Tell the AI what you actually want to talk about, so topic picks are personalized instead of generic trending news."
      />
      <ContentCalendarSettingsEditor tenantSlug={tenantSlug} initial={config} />
    </div>
  );
}
