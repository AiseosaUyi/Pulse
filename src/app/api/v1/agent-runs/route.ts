// Open an agent run — so "new since the last run" is answerable
// server-side instead of guessed in a chat window. Shared with the
// pulse_start_run MCP tool.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { startAgentRun } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "POST";

const startSchema = z.object({
  agent: z.string().min(1),
  surface: z.string().optional(),
});

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "engage:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const result = await startAgentRun(admin, tenantSlug, parsed.data);
  return apiOk(result, headers);
}
