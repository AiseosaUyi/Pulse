import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthClient } from "./types";

interface ClientRow {
  id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  created_at: string;
}

function rowTo(row: ClientRow): OAuthClient {
  return {
    id: row.id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    grantTypes: row.grant_types,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    createdAt: row.created_at,
  };
}

export interface RegisterClientInput {
  clientName?: string;
  redirectUris: string[];
}

export type RegisterClientResult = { ok: true; client: OAuthClient } | { ok: false; error: string };

/** RFC 7591 Dynamic Client Registration. Always registers a public client
 * (token_endpoint_auth_method: "none", PKCE-only) — no client secret is
 * ever minted, matching Cowork leaving Client ID/Secret blank. */
export async function registerClient(
  admin: SupabaseClient,
  input: RegisterClientInput
): Promise<RegisterClientResult> {
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
    return { ok: false, error: "redirect_uris is required and must be a non-empty array" };
  }
  for (const uri of input.redirectUris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: `redirect_uri must be http(s): ${uri}` };
      }
    } catch {
      return { ok: false, error: `redirect_uri is not a valid URL: ${uri}` };
    }
  }

  const id = `mcp_client_${randomBytes(16).toString("hex")}`;
  const { data, error } = await admin
    .from("oauth_clients")
    .insert({
      id,
      client_name: input.clientName?.trim() || null,
      redirect_uris: input.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };
  return { ok: true, client: rowTo(data as ClientRow) };
}

export async function getClient(
  admin: SupabaseClient,
  clientId: string
): Promise<OAuthClient | null> {
  const { data } = await admin.from("oauth_clients").select("*").eq("id", clientId).maybeSingle();
  if (!data) return null;
  return rowTo(data as ClientRow);
}

export function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}
