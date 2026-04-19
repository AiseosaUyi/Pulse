"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { testAyrshareKey } from "@/lib/integrations/ayrshare";
import { testWordpressConnection } from "@/lib/integrations/wordpress";
import { testGhostConnection } from "@/lib/integrations/ghost";
import { getIntegrationSecrets } from "@/lib/services/integrations";
import type { IntegrationProvider } from "@/lib/types/integrations";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface SaveInput {
  tenantSlug: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  /** Null = clear existing secret. Undefined = leave unchanged. */
  secretToken?: string | null;
  secretToken2?: string | null;
}

export async function saveIntegration(
  input: SaveInput
): Promise<ActionResult<{ tested: boolean }>> {
  await requireUser();
  const supabase = await createClient();

  const patch: Record<string, unknown> = {
    tenant_slug: input.tenantSlug,
    provider: input.provider,
    config: input.config,
    status: "connected",
    last_error: null,
  };
  if (input.secretToken !== undefined) patch.secret_token = input.secretToken;
  if (input.secretToken2 !== undefined)
    patch.secret_token_2 = input.secretToken2;

  const { error } = await supabase
    .from("tenant_integrations")
    .upsert(patch, { onConflict: "tenant_slug,provider" });
  if (error) return { success: false, error: error.message };

  // Fire-and-test so the UI immediately sees connected/error state.
  const test = await testIntegration(input.tenantSlug, input.provider);
  revalidatePath("/settings/integrations");
  return { success: true, tested: test.success };
}

export async function disconnectIntegration(
  tenantSlug: string,
  provider: IntegrationProvider
): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tenant_integrations")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("provider", provider);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { success: true };
}

export async function testIntegration(
  tenantSlug: string,
  provider: IntegrationProvider
): Promise<ActionResult<{ detail?: string }>> {
  await requireUser();
  const creds = await getIntegrationSecrets(tenantSlug, provider);
  if (!creds || !creds.secretToken) {
    return { success: false, error: "Missing credentials" };
  }

  const result = await runProviderTest(provider, creds);
  const supabase = await createClient();
  await supabase
    .from("tenant_integrations")
    .update({
      status: result.ok ? "connected" : "error",
      last_error: result.ok ? null : result.error ?? "Unknown error",
      last_tested_at: new Date().toISOString(),
    })
    .eq("tenant_slug", tenantSlug)
    .eq("provider", provider);

  revalidatePath("/settings/integrations");
  if (!result.ok) return { success: false, error: result.error ?? "Failed" };
  return { success: true, detail: result.detail };
}

async function runProviderTest(
  provider: IntegrationProvider,
  creds: {
    config: Record<string, unknown>;
    secretToken: string | null;
    secretToken2: string | null;
  }
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  switch (provider) {
    case "ayrshare": {
      if (!creds.secretToken) return { ok: false, error: "Missing API key" };
      const res = await testAyrshareKey(creds.secretToken);
      return {
        ok: res.ok,
        error: res.error,
        detail: res.platforms
          ? `${res.platforms.length} social account${
              res.platforms.length === 1 ? "" : "s"
            } connected`
          : undefined,
      };
    }
    case "wordpress": {
      const siteUrl = String(creds.config.site_url ?? "");
      const username = String(creds.config.username ?? "");
      if (!siteUrl || !username || !creds.secretToken) {
        return { ok: false, error: "Missing site URL, username, or password" };
      }
      const res = await testWordpressConnection({
        siteUrl,
        username,
        appPassword: creds.secretToken,
      });
      return { ok: res.ok, error: res.error, detail: res.siteName };
    }
    case "ghost": {
      const adminUrl = String(creds.config.admin_url ?? "");
      const id = creds.secretToken;
      const secret = creds.secretToken2;
      if (!adminUrl || !id || !secret) {
        return { ok: false, error: "Missing admin URL or key" };
      }
      const res = await testGhostConnection({
        adminUrl,
        adminKey: `${id}:${secret}`,
      });
      return { ok: res.ok, error: res.error, detail: res.siteTitle };
    }
    case "resend": {
      // Resend has no cheap test endpoint — we verify presence and
      // trust the first send to surface auth issues. Good enough.
      if (!creds.secretToken) {
        return { ok: false, error: "Missing API key" };
      }
      return { ok: true, detail: "Key stored (not tested)" };
    }
  }
}
