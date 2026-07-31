"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  ACTIVE_EVENT_PLATFORMS,
  UNCONFIRMED_PLATFORM_IDS,
  IG_MENTION_PLATFORMS,
} from "@/lib/scrape/event-platforms";
import {
  runActiveEventPlatform,
  runUnconfirmedEventPlatform,
  runIgMentionScan,
} from "@/lib/scrape/event-scraper-runner";
import { listRunProspects } from "@/lib/services/event-scraper-runs";
import { isEventScraperEnabledForTenant } from "@/lib/scrape/event-platforms/tenant-config";
import type { ProspectRecord } from "@/lib/types/outbound";

type ActionResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string };

// Manual "Run now" trigger for the Event Discovery UI. Mirrors
// runProspectSearchNow's shape (prospect-searches-runner.ts) so the two
// "Run now" buttons in Outbound feel consistent, even though they drive
// different underlying systems (SERP keyword search vs. platform crawl).
export async function runEventPlatformScraperNow(
  tenantSlug: string,
  platformId: string
): Promise<
  ActionResult<{ candidatesFound: number; prospectsCreated: number }>
> {
  const user = await requireUser();

  if (!isEventScraperEnabledForTenant(tenantSlug)) {
    return {
      success: false,
      error:
        "Event platform scraping isn't enabled for this tenant's ICP. Contact an admin if this brand should be added to the allowlist.",
    };
  }

  const active = ACTIVE_EVENT_PLATFORMS.find((c) => c.id === platformId);
  const unconfirmed = UNCONFIRMED_PLATFORM_IDS.find((p) => p.id === platformId);
  const igMention = IG_MENTION_PLATFORMS.find((p) => p.id === platformId);

  if (!active && !unconfirmed && !igMention) {
    return { success: false, error: `Unknown or unbuilt platform: ${platformId}` };
  }

  try {
    const runOpts = { tenantSlug, trigger: "manual" as const, triggeredBy: user.id };
    const result = active
      ? await runActiveEventPlatform(active, runOpts)
      : unconfirmed
        ? await runUnconfirmedEventPlatform(unconfirmed, runOpts)
        : await runIgMentionScan(igMention!.id, igMention!.label, igMention!.hashtags, runOpts);

    revalidatePath("/leads");
    return {
      success: true,
      candidatesFound: result.candidatesFound,
      prospectsCreated: result.prospectsCreated,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Run failed",
    };
  }
}

// Expand-a-run: fetch the prospects a specific run produced.
export async function getEventScraperRunProspects(
  tenantSlug: string,
  runId: string
): Promise<ProspectRecord[]> {
  await requireUser();
  return listRunProspects(tenantSlug, runId);
}
