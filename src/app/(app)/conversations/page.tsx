import { getCurrentTenant } from "@/lib/auth";
import { getEngagementItems, summarize } from "@/lib/services/engagement";
import { listEngageCandidates } from "@/lib/services/engage";
import { ConversationsClient } from "./ConversationsClient";

export const metadata = { title: "Conversations" };

export default async function ConversationsPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;

  const [items, candidates] = await Promise.all([
    getEngagementItems(tenant.slug),
    listEngageCandidates(tenant.slug),
  ]);

  const summary = summarize(items);

  return (
    <ConversationsClient
      accountType={tenant.accountType}
      tenantSlug={tenant.slug}
      inboxItems={items}
      inboxSummary={summary}
      candidates={candidates}
    />
  );
}
