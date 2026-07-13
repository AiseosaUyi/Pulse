// OAuth consent page. Session-gated the normal way (NOT in PUBLIC_PATHS —
// an unauthenticated hit round-trips through /login?next=..., which now
// correctly preserves the full query string, see
// src/lib/supabase/middleware.ts). Validates the client + redirect_uri
// BEFORE rendering anything interactive — an unknown client or
// unregistered redirect_uri never gets a redirect target handed to it
// (the classic OAuth open-redirect mistake the exact-match rule exists
// to prevent).

import { requireUser, getUserTenants } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClient, validateRedirectUri } from "@/lib/oauth/clients";
import { PublicPageShell } from "@/components/layout/PublicPageShell";
import { AuthorizeConsent } from "./AuthorizeConsent";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const {
    response_type: responseType,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  } = params;

  if (!clientId || !redirectUri) {
    redirect("/oauth/authorize/invalid");
  }

  const admin = createAdminClient();
  const client = await getClient(admin, clientId);
  if (!client || !validateRedirectUri(client, redirectUri)) {
    redirect("/oauth/authorize/invalid");
  }

  // From here on redirectUri is validated — safe to send the user back to
  // it with an OAuth error instead of only ever showing an in-app page.
  if (responseType !== "code") {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "unsupported_response_type");
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "invalid_request");
    url.searchParams.set("error_description", "code_challenge (S256) is required");
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  }

  const user = await requireUser();
  const tenants = await getUserTenants();
  const eligibleTenants = tenants.filter((t) => t.role === "owner" || t.role === "admin");

  return (
    <PublicPageShell>
      <AuthorizeConsent
        clientName={client.clientName ?? client.id}
        userEmail={user.email}
        eligibleTenants={eligibleTenants.map((t) => ({ slug: t.slug, name: t.name, role: t.role }))}
        clientId={clientId}
        redirectUri={redirectUri}
        scope={scope ?? ""}
        state={state}
        codeChallenge={codeChallenge}
        codeChallengeMethod={codeChallengeMethod}
      />
    </PublicPageShell>
  );
}
