export interface OAuthClient {
  id: string;
  clientName: string | null;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  createdAt: string;
}

export interface OAuthAuthorizationCodeRow {
  id: string;
  clientId: string;
  userId: string;
  tenantSlug: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface OAuthAccessTokenClaims {
  sub: string; // user_id
  tenant_slug: string;
  scopes: string; // comma-separated, same convention as tenant_api_tokens.scope
  client_id: string;
  jti: string;
}
