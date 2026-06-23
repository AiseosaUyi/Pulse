"use server";

import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  saveSocialAccountMapping,
  removeSocialAccountMapping,
} from "@/lib/services/social-accounts";

export async function linkSocialAccount(
  platform: string,
  socialApiAccountId: string,
  username: string,
  name: string
): Promise<{ error?: string }> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant" };

  try {
    await saveSocialAccountMapping({
      tenantSlug: tenant.slug,
      platform,
      socialApiAccountId,
      username,
      name,
    });
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function unlinkSocialAccount(platform: string): Promise<{ error?: string }> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant" };

  try {
    await removeSocialAccountMapping(tenant.slug, platform);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
