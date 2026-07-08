"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  ACTIVE_EVENT_PLATFORMS,
  UNCONFIRMED_PLATFORM_IDS,
} from "@/lib/scrape/event-platforms";
import {
  runActiveEventPlatform,
  runUnconfirmedEventPlatform,
} from "@/lib/scrape/event-scraper-runner";
import { listRunProspects } from "@/lib/services/event-scraper-runs";
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

  const active = ACTIVE_EVENT_PLATFORMS.find((c) => c.id === platformId);
  const unconfirmed = UNCONFIRMED_PLATFORM_IDS.find((p) => p.id === platformId);

  if (!active && !unconfirmed) {
    return { success: false, error: `Unknown or unbuilt platform: ${platformId}` };
  }

  try {
    const result = active
      ? await runActiveEventPlatform(active, {
          tenantSlug,
          trigger: "manual",
          triggeredBy: user.id,
        })
      : await runUnconfirmedEventPlatform(unconfirmed!, {
          tenantSlug,
          trigger: "manual",
          triggeredBy: user.id,
        });

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
