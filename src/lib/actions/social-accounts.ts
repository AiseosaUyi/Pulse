"use server";

import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  saveSocialAccountMapping,
  removeSocialAccountMapping,
} from "@/lib/services/social-accounts";

async function requireAdminTenant() {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { tenant: null, error: "No tenant" as const };
  const role = (tenant as { role?: string }).role ?? "member";
  if (role !== "owner" && role !== "admin") {
    return { tenant: null, error: "Only owners and admins can manage social accounts" as const };
  }
  return { tenant, error: null };
}

export async function linkSocialAccount(
  platform: string,
  socialApiAccountId: string,
  username: string,
  name: string
): Promise<{ error?: string }> {
  const { tenant, error } = await requireAdminTenant();
  if (error || !tenant) return { error: error ?? "No tenant" };

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
  const { tenant, error } = await requireAdminTenant();
  if (error || !tenant) return { error: error ?? "No tenant" };

  try {
    await removeSocialAccountMapping(tenant.slug, platform);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
