// RFC 6749 §5.2-shaped error responses for the OAuth endpoints — distinct
// from src/lib/api/respond.ts's apiError() (a human message string), since
// OAuth clients parse `error` as one of a fixed set of machine-readable
// codes, not prose.

import { NextResponse } from "next/server";

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "access_denied"
  | "server_error";

export function oauthError(status: number, error: OAuthErrorCode, description?: string) {
  return NextResponse.json(
    description ? { error, error_description: description } : { error },
    { status, headers: { "cache-control": "no-store", pragma: "no-cache" } }
  );
}

export function oauthOk<T extends object>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", pragma: "no-cache" } });
}
