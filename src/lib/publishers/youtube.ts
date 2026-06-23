import { getPlatformConnection, upsertPlatformConnection } from "@/lib/services/platform-connections";
import { publishYouTubeCommunityPost, refreshYouTubeToken } from "@/lib/integrations/platforms/youtube";

export async function publishToYouTube(
  tenantSlug: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const conn = await getPlatformConnection(tenantSlug, "youtube");
  if (!conn) throw new Error("YouTube not connected for this account");

  try {
    return await publishYouTubeCommunityPost(conn.accessToken, content);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 401 && conn.refreshToken) {
      const fresh = await refreshYouTubeToken(conn.refreshToken);
      await upsertPlatformConnection({
        tenantSlug,
        platform: "youtube",
        platformUserId: conn.platformUserId,
        platformHandle: conn.platformHandle,
        tokens: {
          accessToken: fresh.access_token,
          refreshToken: fresh.refresh_token ?? conn.refreshToken,
          expiresAt: fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000) : undefined,
          scopes: fresh.scope?.split(" "),
        },
      });
      return await publishYouTubeCommunityPost(fresh.access_token, content);
    }
    throw err;
  }
}
