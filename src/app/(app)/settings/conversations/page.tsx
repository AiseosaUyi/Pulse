import { Inbox } from "lucide-react";
import { getCurrentTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSharedInboxConfig } from "@/lib/services/shared-inbox";
import { defaultSharedInboxConfig } from "@/lib/shared-inbox/types";
import { SharedInboxEditor } from "@/components/settings/SharedInboxEditor";
import { SettingsPageHeading } from "../_shared";

export default async function SharedInboxSettingsPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const config = tenantSlug
    ? await getSharedInboxConfig(await createClient(), tenantSlug)
    : defaultSharedInboxConfig();

  return (
    <div className="max-w-[720px]">
      <SettingsPageHeading
        icon={Inbox}
        title="AI inbox coverage"
        subtitle="Let AI draft — and, above a confidence bar you set, auto-send — replies to WhatsApp, Instagram, and LinkedIn messages when your team is away. Off by default; nothing sends until you turn this on."
      />
      <SharedInboxEditor tenantSlug={tenantSlug} initial={config} />
    </div>
  );
}
