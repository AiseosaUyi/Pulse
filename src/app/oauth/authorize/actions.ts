"use server";

// Approve/deny actions for the OAuth consent page. Both re-validate
// everything server-side against the current session — the form fields
// are a UI convenience, never trusted blindly (a tampered tenant_slug or
// client_id must still fail the same checks the page itself already ran).

import { redirect } from "next/navigation";
import { requireUser, getUserTenants } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClient, validateRedirectUri } from "@/lib/oauth/clients";
import { mintAuthorizationCode } from "@/lib/oauth/codes";
import { DEFAULT_API_V1_SCOPES } from "@/lib/api/scopes";

function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const user = await requireUser();

  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = formData.get("state") ? String(formData.get("state")) : undefined;
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const codeChallengeMethod = String(formData.get("code_challenge_method") ?? "S256");
  const scopeParam = formData.get("scope") ? String(formData.get("scope")) : "";
  const tenantSlug = String(formData.get("tenant_slug") ?? "");

  const admin = createAdminClient();
  const client = await getClient(admin, clientId);
  // Client or redirect_uri invalid — cannot safely redirect anywhere
  // (redirecting to an unvalidated redirect_uri is the exact SSRF/open-
  // redirect mistake OAuth's redirect_uri exact-match rule exists to
  // prevent). Render an in-app error instead of bouncing.
  if (!client || !validateRedirectUri(client, redirectUri)) {
    redirect("/oauth/authorize/invalid");
  }

  const tenants = await getUserTenants();
  const membership = tenants.find(
    (t) => t.slug === tenantSlug && (t.role === "owner" || t.role === "admin")
  );
  if (!membership) {
    redirect(buildRedirect(redirectUri, { error: "access_denied", error_description: "no_eligible_tenant", state }));
  }

  const scopes = scopeParam.trim() ? scopeParam.trim().split(/\s+/) : [...DEFAULT_API_V1_SCOPES];
  const code = await mintAuthorizationCode(admin, {
    clientId,
    userId: user.id,
    tenantSlug,
    scopes,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
  });

  redirect(buildRedirect(redirectUri, { code, state }));
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  await requireUser();
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = formData.get("state") ? String(formData.get("state")) : undefined;

  const admin = createAdminClient();
  const clientId = String(formData.get("client_id") ?? "");
  const client = await getClient(admin, clientId);
  if (!client || !validateRedirectUri(client, redirectUri)) {
    redirect("/oauth/authorize/invalid");
  }

  redirect(buildRedirect(redirectUri, { error: "access_denied", state }));
}
