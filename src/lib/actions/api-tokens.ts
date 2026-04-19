"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import {
  generateToken,
  hashToken,
  type ApiTokenRecord,
} from "@/lib/api-tokens";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function listApiTokens(
  tenantSlug: string
): Promise<ApiTokenRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_api_tokens")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    tokenPrefix: row.token_prefix,
    tokenLast4: row.token_last4,
    scope: row.scope,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export async function createApiToken(
  tenantSlug: string,
  input: { name: string; scope?: string }
): Promise<ActionResult<{ token: string; record: ApiTokenRecord }>> {
  const user = await requireUser();
  const name = input.name.trim();
  if (!name) return { success: false, error: "Name is required" };

  const token = generateToken();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_api_tokens")
    .insert({
      tenant_slug: tenantSlug,
      name,
      token_hash: hashToken(token),
      token_prefix: token.slice(0, 14),
      token_last4: token.slice(-4),
      scope: input.scope ?? "extension",
      created_by: user.id,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Token creation failed" };
  }

  revalidatePath("/settings/integrations");
  return {
    success: true,
    token,
    record: {
      id: data.id,
      tenantSlug: data.tenant_slug,
      name: data.name,
      tokenPrefix: data.token_prefix,
      tokenLast4: data.token_last4,
      scope: data.scope,
      lastUsedAt: data.last_used_at,
      createdAt: data.created_at,
      revokedAt: data.revoked_at,
    },
  };
}

export async function revokeApiToken(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tenant_api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { success: true };
}
