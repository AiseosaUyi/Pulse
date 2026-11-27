import type { SupabaseClient } from "@supabase/supabase-js";

export interface RunReportStats {
  runId: string;
  researched: number;
  skipped: number;
  upserted: number;
  emailsKept: number;
  emailsDropped: number;
  dropReasons: Record<string, number>;
  emailsUnverified: number;
}

export async function generateRunReport(
  client: SupabaseClient,
  workspace: string,
  runId: string
): Promise<{ report: string; report_line: string; stats: RunReportStats; sent: false }> {
  // Query prospects in this run
  const { data: prospects } = await client
    .from("prospects")
    .select("id, email, email_status, unverified_email")
    .eq("tenant_slug", workspace)
    .eq("run_id", runId);

  // Query ledger entries in this run
  const { data: ledgerEntries } = await client
    .from("outreach_ledger")
    .select("key_type, kind, reason")
    .eq("workspace", workspace)
    .eq("run_id", runId);

  const prospectList = prospects || [];
  const ledgerList = ledgerEntries || [];

  const upserted = prospectList.length;

  // Skipped rows recorded in ledger for this run
  const skippedRows = ledgerList.filter(
    (l) => l.reason?.toLowerCase().includes("skip") || l.reason?.toLowerCase().includes("ledger")
  );
  // Total skipped by ledger
  const skipped = skippedRows.length;

  const researched = upserted + skipped;

  const emailsKept = prospectList.filter(
    (p) => Boolean(p.email) && p.email_status === "verified"
  ).length;

  const emailsUnverified = prospectList.filter(
    (p) => Boolean(p.unverified_email) || p.email_status === "unverified"
  ).length;

  // Dropped emails recorded in ledger
  const droppedEmailRows = ledgerList.filter(
    (l) => l.key_type === "EMAIL" && l.kind === "DROPPED"
  );
  const emailsDropped = droppedEmailRows.length;

  const dropReasons: Record<string, number> = {};
  for (const row of droppedEmailRows) {
    const r = row.reason || "unknown";
    dropReasons[r] = (dropReasons[r] || 0) + 1;
  }

  const reasonsList = Object.entries(dropReasons)
    .map(([r, count]) => `${r}: ${count}`)
    .join(", ");
  const reasonsStr = reasonsList || "none";

  // Exact required line format:
  // "Run <run_id>: researched X, skipped Y (ledger), upserted Z. Emails: kept A, dropped B (reasons), unverified C. Nothing was sent."
  const reportLine = `Run ${runId}: researched ${researched}, skipped ${skipped} (ledger), upserted ${upserted}. Emails: kept ${emailsKept}, dropped ${emailsDropped} (${reasonsStr}), unverified ${emailsUnverified}. Nothing was sent.`;

  return {
    report: reportLine,
    report_line: reportLine,
    stats: {
      runId,
      researched,
      skipped,
      upserted,
      emailsKept,
      emailsDropped,
      dropReasons,
      emailsUnverified,
    },
    sent: false,
  };
}
