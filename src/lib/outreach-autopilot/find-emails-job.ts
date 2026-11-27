// Daily email finding for every workspace, with or without a mailbox.
//
// findEmailsForTenant used to run only inside the Autopilot runner, which
// only runs for workspaces with an ENABLED mailbox. A workspace without one
// never got emails found for its leads. This job covers the rest.
//
// Who does what (so the two never search the same leads at once):
//   - mailbox enabled AND auto compose on: the runner keeps finding emails
//     right before it composes (same pass, freshest result). This job skips
//     that workspace.
//   - everyone else: this job.
// Even if both ran, it would only waste searches, not corrupt data: each lead
// is stamped with email_searched_at and not picked again for RETRY_DAYS, and
// the found-email write is guarded by `email_status is null`.
//
// Workspaces that switched the "autopilot" feature off are skipped too.

import type { SupabaseClient } from "@supabase/supabase-js";
import { findEmailsForTenant, type EnrichResult } from "./enrich";

export interface FindEmailsJobOptions {
  now?: Date;
  /** Stop starting new leads after this time (epoch ms). */
  deadlineMs: number;
  perTenantLimit: number;
  perTenantSearchBudget: number;
}

export interface TenantFindResult extends EnrichResult {
  tenantSlug: string;
  skipped?: "runner_handles" | "feature_off" | "out_of_time";
  error?: string;
}

/** Workspaces whose Autopilot runner already finds emails each day. */
async function tenantsHandledByRunner(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin
    .from("outreach_mailboxes")
    .select("tenant_slug")
    .eq("enabled", true)
    .eq("auto_compose", true);
  return new Set((data ?? []).map((r) => r.tenant_slug as string));
}

function featureOff(settings: unknown): boolean {
  const features = (settings as { features?: Record<string, unknown> } | null)?.features;
  return features?.autopilot === false;
}

export async function findEmailsForAllTenants(
  admin: SupabaseClient,
  opts: FindEmailsJobOptions
): Promise<TenantFindResult[]> {
  const now = opts.now ?? new Date();
  const { data: tenants, error } = await admin.from("tenants").select("slug, settings");
  if (error) throw new Error(`list tenants: ${error.message}`);
  const runnerHandles = await tenantsHandledByRunner(admin);

  const out: TenantFindResult[] = [];
  for (const t of (tenants ?? []) as Array<{ slug: string; settings: unknown }>) {
    const base: TenantFindResult = { tenantSlug: t.slug, checked: 0, found: 0, searches: 0 };
    if (runnerHandles.has(t.slug)) {
      out.push({ ...base, skipped: "runner_handles" });
      continue;
    }
    if (featureOff(t.settings)) {
      out.push({ ...base, skipped: "feature_off" });
      continue;
    }
    if (Date.now() > opts.deadlineMs) {
      out.push({ ...base, skipped: "out_of_time" });
      continue;
    }
    // One workspace's failure must not stop the others.
    try {
      const r = await findEmailsForTenant(admin, t.slug, {
        limit: opts.perTenantLimit,
        searchBudget: opts.perTenantSearchBudget,
        now,
        deadlineMs: opts.deadlineMs,
      });
      out.push({ ...base, ...r });
    } catch (err) {
      out.push({ ...base, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
