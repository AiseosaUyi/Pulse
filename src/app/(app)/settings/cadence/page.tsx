import { getCurrentTenant } from "@/lib/auth";
import { CalendarCheck } from "lucide-react";
import { getCadenceConfig } from "@/lib/cadence/config";
import { defaultCadenceConfig } from "@/lib/cadence/types";
import { CadenceEditor } from "@/components/settings/CadenceEditor";
import { SettingsPageHeading } from "../_shared";

export default async function CadenceSettingsPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";
  const config = (await getCadenceConfig(tenantSlug)) ?? defaultCadenceConfig();

  return (
    <div className="max-w-[720px]">
      <SettingsPageHeading
        icon={CalendarCheck}
        title="Posting cadence"
        subtitle="Set your posting windows, a daily target, and your timezone. The Composer and Today views track your beat and a daily digest nudges you when you're behind."
      />
      <CadenceEditor tenantSlug={tenantSlug} initial={config} />
    </div>
  );
}
