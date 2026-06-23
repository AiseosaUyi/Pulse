import { getPlatformConnection } from "@/lib/services/platform-connections";
import { publishXPost, refreshXToken } from "@/lib/integrations/platforms/x";
import { upsertPlatformConnection } from "@/lib/services/platform-connections";

export async function publishToX(
  tenantSlug: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const conn = await getPlatformConnection(tenantSlug, "x");
  if (!conn) throw new Error("X not connected for this account");

  try {
    return await publishXPost(conn.accessToken, content);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    // 401 → try refresh
    if (status === 401 && conn.refreshToken) {
      const fresh = await refreshXToken(conn.refreshToken);
      await upsertPlatformConnection({
        tenantSlug,
        platform: "x",
        platformUserId: conn.platformUserId,
        platformHandle: conn.platformHandle,
        tokens: {
          accessToken: fresh.access_token,
          refreshToken: fresh.refresh_token,
          expiresAt: fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000) : undefined,
          scopes: fresh.scope?.split(" "),
        },
      });
      return await publishXPost(fresh.access_token, content);
    }
    throw err;
  }
}
