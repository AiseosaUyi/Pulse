import { getCurrentTenant } from "@/lib/auth";
import { listEngageCandidates } from "@/lib/services/engage";
import { EngageClient } from "./client";

export const metadata = { title: "Engage" };

export default async function EngagePage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const candidates = await listEngageCandidates(tenant.slug);
  return <EngageClient tenantSlug={tenant.slug} candidates={candidates} />;
}
