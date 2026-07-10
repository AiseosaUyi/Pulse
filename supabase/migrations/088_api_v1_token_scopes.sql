-- /api/v1 token API — scopes. tenant_api_tokens.scope was a single
-- 4-value enum tag ('extension','cli','automation','other'), unchecked
-- by any route. The new /api/v1 API enforces real least-privilege
-- scopes, so scope becomes a comma-separated list of scope strings
-- (validated in the app layer — see src/lib/actions/api-tokens.ts —
-- not here, a CHECK can't cleanly express "each comma-separated part
-- must be one of N values").
--
-- Existing scope='extension' tokens are rewritten to the full v1 scope
-- list so they keep working on /api/v1 with no re-mint. /api/ext/*
-- behavior is untouched either way — it has never checked scope.

alter table tenant_api_tokens drop constraint if exists tenant_api_tokens_scope_check;

update tenant_api_tokens
set scope = 'sales:read,sales:write,content:read,content:write,seo:read,seo:write,intel:read,analytics:read,publish:read,publish:write,engage:read,engage:write'
where scope = 'extension';

alter table tenant_api_tokens alter column scope drop default;
alter table tenant_api_tokens alter column scope set default 'sales:read,content:read,seo:read,intel:read,analytics:read,publish:read,engage:read';
