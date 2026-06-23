import { getPlatformConnection } from "@/lib/services/platform-connections";
import { createInstagramContainer } from "@/lib/integrations/platforms/instagram";

export interface InstagramPublishInit {
  tenantSlug: string;
  content: string;
  scheduledPostId: string;
}

// Step 1 — called from the QStash publish webhook.
// Creates the IG media container and enqueues a second QStash message to poll + publish.
export async function initInstagramPost(
  params: InstagramPublishInit
): Promise<{ creationId: string; igUserId: string }> {
  const conn = await getPlatformConnection(params.tenantSlug, "instagram");
  if (!conn) throw new Error("Instagram not connected for this account");
  const creationId = await createInstagramContainer(
    conn.accessToken,
    conn.platformUserId,
    params.content
  );
  return { creationId, igUserId: conn.platformUserId };
}
