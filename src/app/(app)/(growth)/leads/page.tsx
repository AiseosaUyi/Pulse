// Slice 6 — Outbound. Reboots the old Leads table as an AI-powered
// prospect pipeline. Discovery (manual + search-driven) → qualify →
// draft DM → approve → send → inbox.
//
// The old mock-leads module is left intact in src/lib/data — a
// follow-up can delete it once the outbound flow has production data.

import { getCurrentTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listInbox,
  listProspects,
  listSearches,
  countOutboundKpis,
} from "@/lib/services/outbound";
import { listAllDmsByProspect } from "@/lib/services/outbound-dms-bulk";
import { listTemplates } from "@/lib/services/outbound-templates";
import { getOutreachToday } from "@/lib/services/outreach-intelligence";
import { listOutreachCampaigns } from "@/lib/services/outreach-campaigns";
import { listEventScraperRuns } from "@/lib/services/event-scraper-runs";
import {
  ACTIVE_EVENT_PLATFORMS,
  UNCONFIRMED_PLATFORM_IDS,
  IG_MENTION_PLATFORMS,
} from "@/lib/scrape/event-platforms";
import { OutboundClient } from "./client";
import type { OutboundDmRecord } from "@/lib/types/outbound";
import type { EventScraperPlatformOption } from "./event-platform-runs";

export default async function LeadsPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="p-4 md:p-8">
        <h1 className="text-2xl font-bold text-foreground">Outbound</h1>
        <p className="text-text-secondary text-sm mt-2">Select a tenant first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [
    prospectsResult,
    searches,
    inbox,
    kpis,
    dmsByProspect,
    templates,
    todayData,
    campaigns,
    eventScraperRuns,
  ] = await Promise.all([
      listProspects(supabase, tenant.slug, { page: 0, pageSize: 50 }),
      listSearches(tenant.slug),
      listInbox(tenant.slug, 30),
      countOutboundKpis(tenant.slug),
      listAllDmsByProspect(tenant.slug),
      listTemplates(supabase, tenant.slug),
      getOutreachToday(supabase, tenant.slug),
      listOutreachCampaigns(tenant.slug),
      listEventScraperRuns(tenant.slug),
    ]);

  // Flatten the Map into a serializable array for the client component.
  const dms: Array<[string, OutboundDmRecord[]]> = Array.from(
    dmsByProspect.entries()
  );

  // Plain-data platform list for the "Run now" buttons — deliberately NOT
  // importing the scraper configs themselves into client code (they pull in
  // cheerio + parser functions with no reason to ship to the browser).
  const eventScraperPlatforms: EventScraperPlatformOption[] = [
    ...ACTIVE_EVENT_PLATFORMS.map((p) => ({
      id: p.id,
      label: p.label,
      kind: "active" as const,
    })),
    ...UNCONFIRMED_PLATFORM_IDS.map((p) => ({
      id: p.id,
      label: p.label,
      kind: "unconfirmed" as const,
    })),
    ...IG_MENTION_PLATFORMS.map((p) => ({
      id: p.id,
      label: p.label,
      kind: "ig_mention" as const,
    })),
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Outbound</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            AI finds prospects, scores fit, drafts DMs. You approve each one
            before send. Replies show up in the inbox.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-6">
        <Kpi label="Prospects" value={kpis.total} />
        <Kpi label="Qualified" value={kpis.qualified} tone="primary" />
        <Kpi label="Ready to send" value={kpis.drafted} tone="yellow" />
        <Kpi label="Sent" value={kpis.sent} tone="green" />
        <Kpi
          label="Inbox"
          value={kpis.inboxUnread}
          tone={kpis.inboxUnread > 0 ? "primary" : "default"}
        />
      </div>

      <OutboundClient
        tenantSlug={tenant.slug}
        tenantName={tenant.name}
        initialProspects={prospectsResult.data}
        totalProspects={prospectsResult.total}
        initialInbox={inbox}
        searches={searches}
        initialDmsByProspect={dms}
        initialTemplates={templates}
        initialTodayData={todayData}
        campaigns={campaigns}
        initialEventScraperRuns={eventScraperRuns}
        eventScraperPlatforms={eventScraperPlatforms}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "yellow" | "green";
}) {
  const tones = {
    default: "text-foreground",
    primary: "text-primary-500",
    yellow: "text-status-yellow",
    green: "text-status-green",
  };
  return (
    <div className="bg-card rounded-xl p-4 border border-border/50">
      <p className="text-text-secondary text-xs">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
    </div>
  );
}
