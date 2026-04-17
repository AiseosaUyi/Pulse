import { createClient } from "@/lib/supabase/server";

export interface Notification {
  id: string;
  type: "warning" | "opportunity" | "action" | "info";
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  actionUrl: string;
  actionLabel: string;
}

// Derived notifications — no table, computed fresh each load from
// engagement_items (unread), intel_cards (recent high-impact),
// content_briefs (approved waiting), and leads (cold too long).
// A real read/unread state would need a notifications table + RPC
// to mark-read; for now all derived items are "unread" by default.

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function getNotifications(tenantSlug: string): Promise<Notification[]> {
  const supabase = await createClient();
  const out: Notification[] = [];

  // 1. Unread engagement items (DMs, mentions, comments)
  const { data: engagementRows } = await supabase
    .from("engagement_items")
    .select("id, type, from_name, platform, received_at")
    .eq("tenant_slug", tenantSlug)
    .eq("read", false)
    .order("received_at", { ascending: false })
    .limit(5);

  if (engagementRows && engagementRows.length > 0) {
    const unreadCount = engagementRows.length;
    const types = engagementRows.map((r) => r.type);
    const mostCommon = types.sort(
      (a, b) =>
        types.filter((t) => t === b).length - types.filter((t) => t === a).length
    )[0];
    out.push({
      id: `engagement-${engagementRows[0].id}`,
      type: "opportunity",
      title: `${unreadCount} unread ${mostCommon}${unreadCount === 1 ? "" : "s"}`,
      description: `Latest from @${engagementRows[0].from_name} on ${engagementRows[0].platform}.`,
      timestamp: relativeTime(engagementRows[0].received_at),
      read: false,
      actionUrl: "/engagement",
      actionLabel: "Open inbox",
    });
  }

  // 2. Recent high-impact intel cards (last 3 days)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: intelRows } = await supabase
    .from("intel_cards")
    .select("id, competitor_name, summary, ai_recommendation, detected_at")
    .eq("tenant_id", tenantSlug)
    .gte("detected_at", threeDaysAgo)
    .order("detected_at", { ascending: false })
    .limit(10);

  const highImpact = (intelRows ?? []).filter((r) => {
    const rec = r.ai_recommendation as { impact?: string } | null;
    return rec?.impact === "high";
  });
  if (highImpact.length > 0) {
    const top = highImpact[0];
    out.push({
      id: `intel-${top.id}`,
      type: "warning",
      title: `${top.competitor_name}: new high-impact move`,
      description: top.summary.slice(0, 140),
      timestamp: relativeTime(top.detected_at),
      read: false,
      actionUrl: "/intel-feed",
      actionLabel: "Review",
    });
  }

  // 3. Content briefs ready to publish
  const { data: briefRows } = await supabase
    .from("content_briefs")
    .select("id, title, created_at, status")
    .eq("tenant_id", tenantSlug)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(5);

  if (briefRows && briefRows.length > 0) {
    out.push({
      id: `briefs-approved`,
      type: "action",
      title: `${briefRows.length} brief${briefRows.length === 1 ? "" : "s"} ready to publish`,
      description: `Latest: "${briefRows[0].title}"`,
      timestamp: relativeTime(briefRows[0].created_at),
      read: false,
      actionUrl: "/content-briefs",
      actionLabel: "Publish",
    });
  }

  // 4. Cold leads (no contact in 14 days)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: coldLeadRows } = await supabase
    .from("leads")
    .select("id, name, last_contact, status")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["new", "warm"])
    .or(`last_contact.is.null,last_contact.lt.${fourteenDaysAgo}`)
    .limit(10);

  if (coldLeadRows && coldLeadRows.length > 0) {
    const names = coldLeadRows
      .slice(0, 3)
      .map((l) => l.name)
      .join(", ");
    out.push({
      id: `leads-cold`,
      type: "action",
      title: `${coldLeadRows.length} lead${coldLeadRows.length === 1 ? "" : "s"} going cold`,
      description: `${names}${coldLeadRows.length > 3 ? ` +${coldLeadRows.length - 3} more` : ""} — no contact in 14+ days.`,
      timestamp: "",
      read: false,
      actionUrl: "/leads",
      actionLabel: "Follow up",
    });
  }

  // 5. Keyword wins (moved into top 10 in last 7 days)
  // This reads position_history from jsonb — simplified: just flag any
  // keyword currently in top 10 with a previousPosition > 10.
  const { data: keywordRows } = await supabase
    .from("keyword_rankings")
    .select("keyword, position, previous_position")
    .eq("tenant_slug", tenantSlug);

  const newTop10 = (keywordRows ?? []).filter(
    (k) =>
      k.position !== null &&
      k.position <= 10 &&
      k.previous_position !== null &&
      k.previous_position > 10
  );
  if (newTop10.length > 0) {
    out.push({
      id: `keyword-wins`,
      type: "opportunity",
      title: `${newTop10.length} keyword${newTop10.length === 1 ? "" : "s"} hit top 10`,
      description: `"${newTop10[0].keyword}" went from #${newTop10[0].previous_position} → #${newTop10[0].position}.`,
      timestamp: "This week",
      read: false,
      actionUrl: "/seo-tracker/keywords",
      actionLabel: "View keywords",
    });
  }

  return out;
}
