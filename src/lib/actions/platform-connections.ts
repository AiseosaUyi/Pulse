"use server";

import { requireUser, getCurrentTenant } from "@/lib/auth";
import { deletePlatformConnection } from "@/lib/services/platform-connections";
import type { OAuthPlatform } from "@/lib/services/platform-connections";

export async function disconnectPlatform(platform: OAuthPlatform): Promise<{ error?: string }> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant" };
  await deletePlatformConnection(tenant.slug, platform);
  return {};
}
