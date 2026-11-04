import type { SupabaseClient } from "@supabase/supabase-js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const MONEY_KEYWORDS = /\b(payout|payouts|withdrawal|withdrawals|refund|refunds|money|fee|fees|paid|balance|funds|charge|charges|unpaid|stolen)\b/i;

const DATE_START_REGEX = /^((\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)|(\d{4}-\d{2}-\d{2})|((monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2})|((morning|midday|afternoon|evening|night)\s+sweep)|sweep\b)/i;

const BATCH_OR_SWEEP_KEYWORD = /\b(batch|sweep)\b/i;

export function isMoneyRelated(text: string): boolean {
  return MONEY_KEYWORDS.test(text);
}

export function isSweepOrBatchCandidate(title: string, kind: string, body?: string | null, why?: string | null): boolean {
  // 1. Guard against archiving anything tied to money
  const fullText = `${title} ${body ?? ""} ${why ?? ""}`;
  if (isMoneyRelated(fullText)) {
    return false;
  }

  // 2. Must be an applicable operational kind
  const eligibleKinds = new Set(["chore", "follow_up", "decision", "escalation"]);
  if (!eligibleKinds.has(kind)) {
    return false;
  }

  // 3. Must match title pattern: starts with date/sweep or contains "batch"/"sweep"
  const trimmed = title.trim();
  const startsWithDateOrSweep = DATE_START_REGEX.test(trimmed);
  const containsBatchOrSweep = BATCH_OR_SWEEP_KEYWORD.test(trimmed);

  return startsWithDateOrSweep || containsBatchOrSweep;
}

export interface ArchiveSweepResult {
  tenantSlug: string;
  archivedCount: number;
  archivedTitles: string[];
  skippedMoneyCount: number;
}

export async function archiveOldSweepRows(
  client: SupabaseClient,
  tenantSlug: string,
  options: { nowMs?: number; dryRun?: boolean } = {}
): Promise<ArchiveSweepResult> {
  const now = options.nowMs ?? Date.now();
  const cutoffIso = new Date(now - SEVEN_DAYS_MS).toISOString();

  // Fetch open action items older than 7 days
  const { data: actionRows, error: actionErr } = await client
    .from("action_items")
    .select("id, title, kind, body, why, created_at, status, meta")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["open", "snoozed"])
    .lte("created_at", cutoffIso);

  if (actionErr) {
    throw new Error(`Failed to query action items for archive: ${actionErr.message}`);
  }

  const toArchive: Array<{ id: string; title: string }> = [];
  let skippedMoneyCount = 0;

  for (const row of actionRows ?? []) {
    const fullText = `${row.title} ${row.body ?? ""} ${row.why ?? ""}`;
    if (isMoneyRelated(fullText)) {
      skippedMoneyCount++;
      continue;
    }

    if (isSweepOrBatchCandidate(row.title, row.kind, row.body, row.why)) {
      toArchive.push({ id: row.id, title: row.title });
    }
  }

  if (toArchive.length > 0 && !options.dryRun) {
    const ids = toArchive.map((r) => r.id);
    const nowIso = new Date(now).toISOString();

    // Update status to dismissed (with meta.archived = true) so they remain visible under Archived
    for (const item of toArchive) {
      await client
        .from("action_items")
        .update({
          status: "dismissed",
          resolved_at: nowIso,
          resolution_note: "Auto-archived sweep summary older than 7 days",
          meta: { archived: true, autoArchivedAt: nowIso },
        })
        .eq("tenant_slug", tenantSlug)
        .eq("id", item.id);
    }
  }

  return {
    tenantSlug,
    archivedCount: toArchive.length,
    archivedTitles: toArchive.map((r) => r.title),
    skippedMoneyCount,
  };
}
