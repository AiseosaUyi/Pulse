import { EngagementInbox } from "@/components/engagement/EngagementInbox";
import { getCurrentTenant } from "@/lib/auth";
import { getEngagementItems, summarize } from "@/lib/services/engagement";
import { AddEngagementButton } from "./client";

export default async function EngagementPage() {
  const tenant = await getCurrentTenant();
  const items = tenant ? await getEngagementItems(tenant.slug) : [];
  const summary = summarize(items);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Engagement Inbox</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Comments, DMs, and mentions across all platforms
          </p>
        </div>
        <AddEngagementButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Unread</p>
          <p className="text-2xl font-bold text-status-red mt-1">{summary.unread}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Needs Reply</p>
          <p className="text-2xl font-bold text-status-yellow mt-1">{summary.unreplied}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">DMs</p>
          <p className="text-2xl font-bold text-foreground mt-1">{summary.dms}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Mentions</p>
          <p className="text-2xl font-bold text-primary-500 mt-1">{summary.mentions}</p>
        </div>
      </div>

      <EngagementInbox items={items} />
    </div>
  );
}
