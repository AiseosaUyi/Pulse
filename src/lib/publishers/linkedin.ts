import { getPlatformConnection } from "@/lib/services/platform-connections";
import { publishLinkedInPost } from "@/lib/integrations/platforms/linkedin";

export async function publishToLinkedIn(
  tenantSlug: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const conn = await getPlatformConnection(tenantSlug, "linkedin");
  if (!conn) throw new Error("LinkedIn not connected for this account");
  // platformUserId is the LinkedIn member URN
  return await publishLinkedInPost(conn.accessToken, conn.platformUserId, content);
}
