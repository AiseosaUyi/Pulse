// Launch-readiness status for the dashboard banner. Checks the real state of
// each setup task (per tenant) so the banner ticks items off automatically as
// they're connected. Read-only; uses the admin client so checks don't depend on
// the viewer's RLS scope.

import { createAdminClient } from "@/lib/supabase/admin";
import { getDiscoveryConfig } from "@/lib/scrape/discovery-config";

export interface SetupItem {
  key: string;
  label: string;
  done: boolean;
  href?: string; // where to go to complete it (in-app)
  hint: string; // short how-to
}

export interface SetupStatus {
  items: SetupItem[];
  doneCount: number;
  total: number;
  allDone: boolean;
}

async function exists(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  filters: Record<string, string>,
  notFilter?: { col: string; val: string }
): Promise<boolean> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  if (notFilter) q = q.neq(notFilter.col, notFilter.val);
  const { count } = await q;
  return (count ?? 0) > 0;
}

export async function getSetupStatus(tenantSlug: string): Promise<SetupStatus> {
  const admin = createAdminClient();

  const [
    instagram,
    whatsapp,
    ga4,
    storefrontToken,
    tenantRow,
  ] = await Promise.all([
    exists(admin, "connected_accounts", {
      tenant_slug: tenantSlug,
      toolkit: "instagram",
      status: "active",
    }),
    exists(
      admin,
      "whatsapp_accounts",
      { tenant_slug: tenantSlug },
      { col: "status", val: "disconnected" }
    ),
    exists(
      admin,
      "tenant_integrations",
      { tenant_slug: tenantSlug, provider: "ga4" },
      { col: "status", val: "disconnected" }
    ),
    admin
      .from("tenant_api_tokens")
      .select("*", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .is("revoked_at", null)
      .then(({ count }) => (count ?? 0) > 0),
    admin
      .from("tenants")
      .select("slug, settings")
      .eq("slug", tenantSlug)
      .maybeSingle()
      .then(({ data }) => data),
  ]);

  const discovery = !!getDiscoveryConfig({
    slug: tenantSlug,
    settings: (tenantRow?.settings as Record<string, unknown> | null) ?? null,
  });
  const alertsEmail = Boolean(process.env.CRON_ALERT_EMAIL);

  const items: SetupItem[] = [
    {
      key: "instagram",
      label: "Connect Instagram",
      done: instagram,
      href: "/settings/integrations",
      hint: "Unlocks publishing + the comment/DM inbox.",
    },
    {
      key: "ga4",
      label: "Connect Google Analytics",
      done: ga4,
      href: "/settings/integrations",
      hint: "Shows website traffic in the weekly report.",
    },
    {
      key: "whatsapp",
      label: "Connect WhatsApp",
      done: whatsapp,
      href: "/settings/integrations",
      hint: "Lets you reply to customers + send broadcasts.",
    },
    {
      key: "storefront_token",
      label: "Create storefront API token",
      done: storefrontToken,
      href: "/settings/integrations",
      hint: "So website orders attribute automatically.",
    },
    {
      key: "discovery",
      label: "Set discovery sources",
      done: discovery,
      href: "/settings/discovery",
      hint: "Platforms to mine for leads (optional).",
    },
    {
      key: "alerts_email",
      label: "Set alert email",
      done: alertsEmail,
      hint: "Add CRON_ALERT_EMAIL in Vercel for failure alerts.",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    doneCount,
    total: items.length,
    allDone: doneCount === items.length,
  };
}
