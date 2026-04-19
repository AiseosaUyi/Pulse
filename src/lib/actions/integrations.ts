"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { testGa4Connection } from "@/lib/integrations/ga4";
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
    case "ga4": {
      const propertyId = String(creds.config.property_id ?? "");
      if (!propertyId || !creds.secretToken) {
        return {
          ok: false,
          error: "Missing property ID or service-account JSON",
        };
      }
      const res = await testGa4Connection({
        propertyId,
        serviceAccountJson: creds.secretToken,
      });
      return {
        ok: res.ok,
        error: res.error,
        detail:
          res.ok && res.totalUsers != null
            ? `${res.totalUsers.toLocaleString()} users in last 7 days`
            : undefined,
      };
    }
  }
}
