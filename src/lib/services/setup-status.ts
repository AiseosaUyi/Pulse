// "Needs You" detection engine — computes each tenant's outstanding setup
// items at runtime by inspecting that tenant's own live state. Nothing here
// is hardcoded per tenant: every check reads config/connections generic to
// any tenant, so a new tenant sees exactly its own gaps and nothing is
// authored by hand. Read-only; uses the admin client so checks don't depend
// on the viewer's RLS scope.
//
// Registering a new blocker type = adding one entry to CHECK_DEFINITIONS.
// It then runs for every tenant automatically.

import { createAdminClient } from "@/lib/supabase/admin";
import { getDiscoveryConfig } from "@/lib/scrape/discovery-config";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { getBrandPositioning } from "@/lib/ai/brand-positioning";
import { getBrandVoiceHealth } from "@/lib/services/brand-voice-health";
import { getOutboundFilters } from "@/lib/server/outbound-filters";

export type SetupItemKind = "key" | "sign-in" | "info" | "decision" | "access";
export type SetupItemPriority = "P0" | "P1" | "P2";

export interface SetupItem {
  key: string;
  label: string;
  done: boolean;
  href?: string; // where to go to complete it (in-app)
  hint: string; // short how-to
  /** What breaks / stays generic without this. */
  unblocks: string;
  priority: SetupItemPriority;
  kind: SetupItemKind;
}

export interface SetupStatus {
  items: SetupItem[];
  doneCount: number;
  total: number;
  allDone: boolean;
}

interface CheckContext {
  tenantSlug: string;
  accountType: "startup" | "individual";
  admin: ReturnType<typeof createAdminClient>;
  tenantSettings: Record<string, unknown> | null;
}

interface CheckDefinition {
  key: string;
  label: string;
  hint: string;
  unblocks: string;
  priority: SetupItemPriority;
  kind: SetupItemKind;
  href?: string;
  /** Which persona(s) this check applies to. Omitted = both. */
  surfaces?: Array<"startup" | "individual">;
  detect: (ctx: CheckContext) => Promise<boolean>;
}

async function rowExists(
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

// ── Registry ─────────────────────────────────────────────────────────────
// Every tenant runs every applicable check. Priority is deliberately biased
// toward "first real value" (brand voice/ICP + primary channel) over
// nice-to-have integrations — see Activation module plan for why.

const CHECK_DEFINITIONS: CheckDefinition[] = [
  {
    key: "brand_voice",
    label: "Set your brand voice",
    hint: "Every AI draft, DM, and analysis reads generic until this is filled in.",
    unblocks: "On-brand AI output everywhere (outreach, content, replies).",
    priority: "P0",
    kind: "info",
    href: "/settings/brand-voice",
    detect: async (ctx) => !!(await getBrandVoice(ctx.tenantSlug)),
  },
  {
    key: "brand_voice_authored",
    label: "Actually write your brand voice",
    hint: "A brand voice is set, but it still reads like the onboarding placeholder — every AI-drafted reply is currently generic voice wearing your name.",
    unblocks: "Real on-brand DM/comment replies instead of placeholder copy an agent could send without noticing.",
    priority: "P0",
    kind: "info",
    href: "/settings/brand-voice",
    // Deliberately separate from the "brand_voice" existence check above:
    // Gruve's case is "exists but was never actually authored," which that
    // check can't catch (it only asks whether the jsonb key is present).
    detect: async (ctx) => !(await getBrandVoiceHealth(ctx.tenantSlug)).unauthored,
  },
  {
    key: "brand_positioning",
    label: "Set your brand positioning",
    hint: "Who you're for and why you're different — grounds every AI call that argues your case.",
    unblocks: "Accurate ICP framing in qualification, DMs, and content.",
    priority: "P0",
    kind: "info",
    href: "/settings/brand-positioning",
    detect: async (ctx) => !!(await getBrandPositioning(ctx.tenantSlug)),
  },
  {
    key: "whatsapp",
    label: "Connect WhatsApp",
    hint: "Connect your WhatsApp Business number.",
    unblocks: "Replying to customers and sending broadcasts.",
    priority: "P0",
    kind: "key",
    href: "/broadcasts",
    surfaces: ["startup"],
    detect: (ctx) =>
      rowExists(
        ctx.admin,
        "whatsapp_accounts",
        { tenant_slug: ctx.tenantSlug },
        { col: "status", val: "disconnected" }
      ),
  },
  {
    key: "service_area",
    label: "Set your service area",
    hint: "Add the cities/states you actually serve in outbound filters.",
    unblocks: "Discovered leads outside your service area get flagged instead of clogging the pipeline.",
    priority: "P0",
    kind: "info",
    href: "/settings/outbound-filters",
    surfaces: ["startup"],
    detect: async (ctx) => {
      const filters = await getOutboundFilters(ctx.tenantSlug);
      return filters.geoScope.length > 0;
    },
  },
  {
    key: "instagram",
    label: "Connect Instagram",
    hint: "Connect via Settings → Integrations.",
    unblocks: "Publishing + the comment/DM inbox.",
    priority: "P1",
    kind: "sign-in",
    href: "/settings/integrations",
    detect: (ctx) =>
      rowExists(ctx.admin, "connected_accounts", {
        tenant_slug: ctx.tenantSlug,
        toolkit: "instagram",
        status: "active",
      }),
  },
  {
    key: "ga4",
    label: "Connect Google Analytics",
    hint: "Connect via Settings → Integrations.",
    unblocks: "Website traffic in the weekly report.",
    priority: "P1",
    kind: "key",
    href: "/settings/integrations",
    detect: (ctx) =>
      rowExists(
        ctx.admin,
        "tenant_integrations",
        { tenant_slug: ctx.tenantSlug, provider: "ga4" },
        { col: "status", val: "disconnected" }
      ),
  },
  {
    key: "storefront_token",
    label: "Create storefront API token",
    hint: "Create one via Settings → Integrations.",
    unblocks: "Website orders attributing automatically.",
    priority: "P1",
    kind: "key",
    href: "/settings/integrations",
    surfaces: ["startup"],
    detect: async (ctx) => {
      const { count } = await ctx.admin
        .from("tenant_api_tokens")
        .select("*", { count: "exact", head: true })
        .eq("tenant_slug", ctx.tenantSlug)
        .is("revoked_at", null);
      return (count ?? 0) > 0;
    },
  },
  {
    key: "discovery",
    label: "Set discovery sources",
    hint: "Configure which platforms to mine for leads.",
    unblocks: "Autonomous lead discovery beyond manual search.",
    priority: "P2",
    kind: "info",
    href: "/settings/discovery",
    surfaces: ["startup"],
    detect: async (ctx) =>
      !!getDiscoveryConfig({ slug: ctx.tenantSlug, settings: ctx.tenantSettings }),
  },
  {
    key: "alerts_email",
    label: "Set alert email",
    hint: "A developer needs to add CRON_ALERT_EMAIL to the deployment environment.",
    unblocks: "Failure alerts for cron jobs (discovery, publishing, sync).",
    priority: "P2",
    kind: "access",
    detect: async () => Boolean(process.env.CRON_ALERT_EMAIL),
  },
];

export async function getSetupStatus(
  tenantSlug: string,
  accountType: "startup" | "individual" = "startup"
): Promise<SetupStatus> {
  const admin = createAdminClient();
  const { data: tenantRow } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();

  const ctx: CheckContext = {
    tenantSlug,
    accountType,
    admin,
    tenantSettings: (tenantRow?.settings as Record<string, unknown> | null) ?? null,
  };

  const applicable = CHECK_DEFINITIONS.filter(
    (def) => !def.surfaces || def.surfaces.includes(accountType)
  );

  const items: SetupItem[] = await Promise.all(
    applicable.map(async (def) => ({
      key: def.key,
      label: def.label,
      done: await def.detect(ctx).catch(() => false),
      href: def.href,
      hint: def.hint,
      unblocks: def.unblocks,
      priority: def.priority,
      kind: def.kind,
    }))
  );

  // P0 first, then P1/P2; within a tier, not-done before done.
  const priorityRank: Record<SetupItemPriority, number> = { P0: 0, P1: 1, P2: 2 };
  items.sort((a, b) => {
    if (a.priority !== b.priority) return priorityRank[a.priority] - priorityRank[b.priority];
    if (a.done !== b.done) return a.done ? 1 : -1;
    return 0;
  });

  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    doneCount,
    total: items.length,
    allDone: doneCount === items.length,
  };
}
