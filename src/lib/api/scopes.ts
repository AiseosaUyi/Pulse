// Scope catalog for tenant_api_tokens under /api/v1. `scope` is stored
// as a comma-separated string (see migration 088) — this is the single
// source of truth for which strings are valid, both for token-minting
// validation and for grouping the settings UI's scope picker.

export const API_V1_SCOPES = [
  "sales:read",
  "sales:write",
  "content:read",
  "content:write",
  "seo:read",
  "seo:write",
  "intel:read",
  "analytics:read",
  "publish:read",
  "publish:write",
  "engage:read",
  "engage:write",
  "admin",
] as const;

export type ApiV1Scope = (typeof API_V1_SCOPES)[number];

export const DEFAULT_API_V1_SCOPES: ApiV1Scope[] = [
  "sales:read",
  "content:read",
  "seo:read",
  "intel:read",
  "analytics:read",
  "publish:read",
  "engage:read",
];

export const API_V1_SCOPE_GROUPS: Array<{ label: string; scopes: ApiV1Scope[] }> = [
  { label: "Sales", scopes: ["sales:read", "sales:write"] },
  { label: "Content", scopes: ["content:read", "content:write"] },
  { label: "SEO", scopes: ["seo:read", "seo:write"] },
  { label: "Intel", scopes: ["intel:read"] },
  { label: "Analytics", scopes: ["analytics:read"] },
  { label: "Publish", scopes: ["publish:read", "publish:write"] },
  { label: "Engage", scopes: ["engage:read", "engage:write"] },
  { label: "Admin", scopes: ["admin"] },
];

/** `admin` implies every other scope. */
export function hasScope(scopes: string[], required?: ApiV1Scope | null): boolean {
  if (!required) return true;
  return scopes.includes(required) || scopes.includes("admin");
}
