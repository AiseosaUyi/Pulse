import { getPlatformConnection } from "@/lib/services/platform-connections";
import { publishTikTokCaption } from "@/lib/integrations/platforms/tiktok";

export async function publishToTikTok(
  tenantSlug: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const conn = await getPlatformConnection(tenantSlug, "tiktok");
  if (!conn) throw new Error("TikTok not connected for this account");
  return await publishTikTokCaption(conn.accessToken, content);
}
