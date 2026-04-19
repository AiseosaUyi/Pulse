import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  IntegrationProvider,
  IntegrationRecord,
  IntegrationStatus,
} from "@/lib/types/integrations";

interface IntegrationRow {
  id: string;
  tenant_slug: string;
  provider: IntegrationProvider;
  config: Record<string, unknown> | null;
  secret_token: string | null;
  secret_token_2: string | null;
  status: IntegrationStatus;
  last_error: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowTo(row: IntegrationRow): IntegrationRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    provider: row.provider,
    config: row.config ?? {},
    status: row.status,
    hasSecret: Boolean(row.secret_token),
    lastError: row.last_error,
    lastTestedAt: row.last_tested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List integrations for the UI. Uses the user-scoped server client so
 * RLS enforces the owner/admin policy — members get back nothing.
 * Secrets are never included.
 */
export async function listIntegrations(
  tenantSlug: string
): Promise<IntegrationRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_integrations")
    .select(
      "id, tenant_slug, provider, config, secret_token, secret_token_2, status, last_error, last_tested_at, created_at, updated_at"
    )
    .eq("tenant_slug", tenantSlug)
    .order("provider");
  if (error || !data) return [];
  return (data as IntegrationRow[]).map(rowTo);
}

/**
 * Admin-scope read for use inside server actions that actually need
 * the secret material to call the provider API. Never return this
 * shape to a client component.
 */
export async function getIntegrationSecrets(
  tenantSlug: string,
  provider: IntegrationProvider
): Promise<{
  config: Record<string, unknown>;
  secretToken: string | null;
  secretToken2: string | null;
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_integrations")
    .select("config, secret_token, secret_token_2")
    .eq("tenant_slug", tenantSlug)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  return {
    config: (data.config ?? {}) as Record<string, unknown>,
    secretToken: data.secret_token,
    secretToken2: data.secret_token_2,
  };
}
