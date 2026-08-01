"use server";

// Brand audit server actions.
//
// Two entry points:
//
// 1. `runBrandAudit(url)` — sync, single AI call, writes voice +
//    positioning only. Used by the sidebar "Run audit" step where the
//    user wants quick basics.
//
// 2. `startFullAudit(url)` + `advanceFullAudit()` + `cancelFullAudit()`
//    — chunked state machine. Each step runs at most one AI operation
//    (<25s) to fit the Vercel Hobby 60s function cap. Client polls
//    advance until the phase is terminal (`ok` | `failed`). Populates:
//      • brand_voice + brand_positioning  (phase 1)
//      • 3-5 competitors                   (phase 2)
//      • 15-25 tracked keywords            (phase 3)
//      • 5 starter content briefs          (phase 4)
//
// State machine:
//
//   (null) ──start──► phase: "starting"
//   "starting"       ──advance──► voice + positioning saved
//                                 phase: "voice_done"
//   "voice_done"     ──advance──► competitors inserted
//                                 phase: "competitors_done"
//   "competitors_done" ──advance──► keywords inserted
//                                 phase: "keywords_done"
//   "keywords_done"  ──advance──► briefs inserted
//                                 phase: "ok"
//
// State lives in `tenants.settings.audit_state`. Matches the pattern
// from blog-regeneration.ts — terminal phases stop polling and the
// client clears the state on success.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import {
  scrapeSite,
  runBrandAuditAi,
  discoverCompetitorsAi,
  discoverKeywordsAi,
  generateStarterBriefsAi,
  type BrandAuditResult,
} from "@/lib/ai/brand-audit";
import { buildPositioningBlock } from "@/lib/ai/brand-positioning";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { getBrandPositioning } from "@/lib/ai/brand-positioning";
import { getTenant } from "@/lib/services/tenants";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

// Brand voice/positioning provenance. "placeholder" (skipBrandAudit's
// generic filler) is always safe to replace with a real audit result;
// "audit" (a completed AI audit) and unmarked/legacy rows are treated as
// user-owned content and must never be silently overwritten — only a
// blank slate gets filled.
function hasProtectedBrandContent(existing: Record<string, unknown>): boolean {
  const hasVoice = !!existing.brand_voice;
  const hasPositioning = !!existing.brand_positioning;
  if (!hasVoice && !hasPositioning) return false;
  if (existing.brand_audit_source === "placeholder") return false;
  return true;
}

export type AuditPhase =
  | "starting"
  | "voice_done"
  | "competitors_done"
  | "keywords_done"
  | "ok"
  | "failed";

export interface AuditState {
  phase: AuditPhase;
  url: string;
  summary: string | null;
  pages_fetched: string[];
  competitors_added: number;
  keywords_added: number;
  briefs_added: number;
  total_cost_usd: number;
  started_at: string;
  updated_at: string;
  error: string | null;
}

export interface RunBrandAuditOutput {
  summary: string;
  pagesFetched: string[];
  tenantSlug: string;
}

// ──────────────────────────────────────────────────────────
// Sync path: voice + positioning only (sidebar step)
// ──────────────────────────────────────────────────────────

export async function runBrandAudit(
  tenantSlug: string,
  rawUrl: string
): Promise<ActionResult<RunBrandAuditOutput>> {
  const url = rawUrl.trim();
  if (!url) return { success: false, error: "URL is required." };

  try {
    const supabase = await createClient();
    const { data: tenant, error: readErr } = await supabase
      .from("tenants")
      .select("settings")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (readErr) return { success: false, error: readErr.message };
    if (!tenant)
      return {
        success: false,
        error: "Tenant not found or you don't have access.",
      };

    const site = await scrapeSite(url);
    const audit: BrandAuditResult = await runBrandAuditAi(tenantSlug, site);

    const existing = (tenant.settings as Record<string, unknown>) ?? {};
    // Never clobber voice/positioning the user already has — fill only
    // when there's nothing there yet, or what's there is skipBrandAudit's
    // generic placeholder (safe to replace with a real audit result).
    const protectedContent = hasProtectedBrandContent(existing);
    const merged = {
      ...existing,
      ...(protectedContent
        ? {}
        : {
            brand_voice: audit.voice,
            brand_positioning: audit.positioning,
            brand_audit_source: "audit",
          }),
      brand_audit_meta: {
        url: site.url,
        pages_fetched: audit.pagesFetched,
        ran_at: new Date().toISOString(),
        cost_usd: audit.cost,
        duration_ms: audit.durationMs,
        voice_positioning_skipped: protectedContent,
      },
    };

    const { error: writeErr } = await supabase
      .from("tenants")
      .update({ settings: merged })
      .eq("slug", tenantSlug);

    if (writeErr) return { success: false, error: writeErr.message };

    revalidatePath("/settings/brand-voice");
    revalidatePath("/settings/brand-positioning");
    revalidatePath("/dashboard");

    return {
      success: true,
      summary: audit.summary,
      pagesFetched: audit.pagesFetched,
      tenantSlug,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ──────────────────────────────────────────────────────────
// Chunked path: full audit state machine
// ──────────────────────────────────────────────────────────

/**
 * Read-then-merge-write of `tenants.settings`. RLS-scoped via the
 * caller-provided supabase client.
 */
async function mergeSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantSlug: string,
  patch: Record<string, unknown>
): Promise<{ error: string | null }> {
  const { data, error: readErr } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  const existing = (data?.settings as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...patch };
  const { error } = await supabase
    .from("tenants")
    .update({ settings: merged })
    .eq("slug", tenantSlug);
  return { error: error?.message ?? null };
}

async function readAuditState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantSlug: string
): Promise<{ state: AuditState | null; settings: Record<string, unknown> }> {
  const { data } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  const state = (settings.audit_state as AuditState | null) ?? null;
  return { state, settings };
}

function makeInitialState(url: string): AuditState {
  const now = new Date().toISOString();
  return {
    phase: "starting",
    url,
    summary: null,
    pages_fetched: [],
    competitors_added: 0,
    keywords_added: 0,
    briefs_added: 0,
    total_cost_usd: 0,
    started_at: now,
    updated_at: now,
    error: null,
  };
}

/**
 * Kick off a chunked audit. Writes initial state only — returns
 * immediately so the client can start polling advanceFullAudit.
 */
export async function startFullAudit(
  tenantSlug: string,
  rawUrl: string
): Promise<ActionResult<{ state: AuditState }>> {
  const url = rawUrl.trim();
  if (!url) return { success: false, error: "URL is required." };

  const supabase = await createClient();

  const { state: existing } = await readAuditState(supabase, tenantSlug);

  // If a previous non-terminal audit is still running (another tab),
  // return that state so the caller polls the existing run instead
  // of starting a second one that would race the same AI calls.
  if (
    existing &&
    existing.phase !== "ok" &&
    existing.phase !== "failed"
  ) {
    return { success: true, state: existing };
  }

  const initial = makeInitialState(url);
  const { error } = await mergeSettings(supabase, tenantSlug, {
    audit_state: initial,
  });
  if (error) return { success: false, error };

  return { success: true, state: initial };
}

/**
 * Run ONE step of the audit state machine. The client calls this
 * repeatedly until state.phase is terminal. Each call runs at most
 * one AI operation to stay under the 60s cap.
 */
export async function advanceFullAudit(
  tenantSlug: string
): Promise<ActionResult<{ state: AuditState }>> {
  const supabase = await createClient();
  const { state } = await readAuditState(supabase, tenantSlug);

  if (!state) {
    return {
      success: false,
      error: "No audit in progress. Call startFullAudit first.",
    };
  }

  if (state.phase === "ok" || state.phase === "failed") {
    return { success: true, state };
  }

  try {
    let next: AuditState;
    if (state.phase === "starting") {
      next = await runVoicePhase(tenantSlug, state);
    } else if (state.phase === "voice_done") {
      next = await runCompetitorsPhase(tenantSlug, state);
    } else if (state.phase === "competitors_done") {
      next = await runKeywordsPhase(tenantSlug, state);
    } else if (state.phase === "keywords_done") {
      next = await runBriefsPhase(tenantSlug, state);
    } else {
      next = state;
    }

    const { error: writeErr } = await mergeSettings(supabase, tenantSlug, {
      audit_state: next,
    });
    if (writeErr) return { success: false, error: writeErr };

    if (next.phase === "ok") {
      revalidatePath("/dashboard");
      revalidatePath("/competition");
      revalidatePath("/seo-tracker");
      revalidatePath("/content-briefs");
    }

    return { success: true, state: next };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: AuditState = {
      ...state,
      phase: "failed",
      error: message,
      updated_at: new Date().toISOString(),
    };
    await mergeSettings(supabase, tenantSlug, { audit_state: failed });
    return { success: false, error: message };
  }
}

/**
 * Clear a stuck/aborted audit so the user can restart. Doesn't delete
 * already-written rows (voice, competitors, keywords, briefs are kept).
 */
export async function cancelFullAudit(
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { settings } = await readAuditState(supabase, tenantSlug);
  const next = { ...settings };
  delete next.audit_state;
  const { error } = await supabase
    .from("tenants")
    .update({ settings: next })
    .eq("slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ──────────────────────────────────────────────────────────
// Step runners
// ──────────────────────────────────────────────────────────

async function runVoicePhase(
  tenantSlug: string,
  state: AuditState
): Promise<AuditState> {
  const supabase = await createClient();
  const site = await scrapeSite(state.url);
  const audit = await runBrandAuditAi(tenantSlug, site);

  const { settings: existing } = await readAuditState(supabase, tenantSlug);
  // Same non-destructive rule as the sync path: fill empty fields only,
  // or replace skipBrandAudit's placeholder — never a value the user
  // (or a prior real audit) already saved.
  const protectedContent = hasProtectedBrandContent(existing);

  const { error } = await mergeSettings(supabase, tenantSlug, {
    ...(protectedContent
      ? {}
      : {
          brand_voice: audit.voice,
          brand_positioning: audit.positioning,
          brand_audit_source: "audit",
        }),
    brand_audit_meta: {
      url: site.url,
      pages_fetched: audit.pagesFetched,
      ran_at: new Date().toISOString(),
      cost_usd: audit.cost,
      duration_ms: audit.durationMs,
      voice_positioning_skipped: protectedContent,
    },
  });
  if (error) throw new Error(error);

  return {
    ...state,
    phase: "voice_done",
    summary: audit.summary,
    pages_fetched: audit.pagesFetched,
    total_cost_usd: state.total_cost_usd + audit.cost,
    updated_at: new Date().toISOString(),
  };
}

async function runCompetitorsPhase(
  tenantSlug: string,
  state: AuditState
): Promise<AuditState> {
  const tenant = await getTenant(tenantSlug);
  const positioning = await getBrandPositioning(tenantSlug);
  const positioningBlock = buildPositioningBlock(positioning);
  const brandName = tenant?.name ?? tenantSlug;

  const result = await discoverCompetitorsAi(
    tenantSlug,
    positioningBlock,
    brandName,
    { domain: tenant?.domain, primaryRegions: tenant?.audienceConfig?.primaryRegions }
  );

  // Skip any competitor whose name matches an existing row (case-
  // insensitive). Service-role client because we need to check
  // everything including rows the user didn't create themselves.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("competitors")
    .select("name")
    .eq("tenant_id", tenantSlug);
  const existingNames = new Set(
    ((existing ?? []) as Array<{ name: string }>).map((r) =>
      r.name.toLowerCase()
    )
  );

  const rows = result.competitors
    .filter((c) => !existingNames.has(c.name.toLowerCase()))
    .map((c) => ({
      tenant_id: tenantSlug,
      name: c.name,
      website: c.domain ? normalizeDomain(c.domain) : null,
      type: "direct" as const,
      threat_level: "medium" as const,
      strengths: [c.why],
      weaknesses: [] as string[],
      platforms: [] as unknown[],
    }));

  let added = 0;
  if (rows.length > 0) {
    const { error, count } = await admin
      .from("competitors")
      .insert(rows, { count: "exact" });
    if (error) throw new Error(error.message);
    added = count ?? rows.length;
  }

  return {
    ...state,
    phase: "competitors_done",
    competitors_added: added,
    total_cost_usd: state.total_cost_usd + result.cost,
    updated_at: new Date().toISOString(),
  };
}

function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function runKeywordsPhase(
  tenantSlug: string,
  state: AuditState
): Promise<AuditState> {
  const user = await requireUser();
  const positioning = await getBrandPositioning(tenantSlug);
  const positioningBlock = buildPositioningBlock(positioning);

  // Reuse competitors from this tenant (the ones we just inserted +
  // any pre-existing) to inform the keyword set.
  const admin = createAdminClient();
  const { data: competitorsRows } = await admin
    .from("competitors")
    .select("name, website")
    .eq("tenant_id", tenantSlug)
    .limit(10);
  const competitors = ((competitorsRows ?? []) as Array<{
    name: string;
    website: string | null;
  }>).map((c) => ({
    name: c.name,
    domain: c.website
      ? c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : null,
    why: "",
  }));

  const result = await discoverKeywordsAi(
    tenantSlug,
    positioningBlock,
    competitors
  );

  // Dedupe against existing tracked keywords.
  const { data: existing } = await admin
    .from("keyword_rankings")
    .select("keyword")
    .eq("tenant_slug", tenantSlug);
  const existingSet = new Set(
    ((existing ?? []) as Array<{ keyword: string }>).map((r) =>
      r.keyword.toLowerCase()
    )
  );

  const rows = result.keywords
    .filter((k) => !existingSet.has(k.keyword.toLowerCase()))
    .map((k) => ({
      tenant_slug: tenantSlug,
      keyword: k.keyword,
      url: null as string | null,
      position: null as number | null,
      previous_position: null as number | null,
      volume: 0,
      difficulty: k.difficulty,
      last_checked: null as string | null,
      notes: `Intent: ${k.intent}`,
      created_by: user.id,
    }));

  let added = 0;
  if (rows.length > 0) {
    const { error, count } = await admin
      .from("keyword_rankings")
      .insert(rows, { count: "exact" });
    if (error) throw new Error(error.message);
    added = count ?? rows.length;
  }

  return {
    ...state,
    phase: "keywords_done",
    keywords_added: added,
    total_cost_usd: state.total_cost_usd + result.cost,
    updated_at: new Date().toISOString(),
  };
}

async function runBriefsPhase(
  tenantSlug: string,
  state: AuditState
): Promise<AuditState> {
  const voice = await getBrandVoice(tenantSlug);
  const positioning = await getBrandPositioning(tenantSlug);
  const positioningBlock = buildPositioningBlock(positioning);
  const voiceBlock = voice
    ? [
        "Brand voice:",
        `- Tone: ${voice.tone}`,
        `- Audience: ${voice.audience}`,
        `- Do: ${voice.do_list.join(" | ")}`,
        `- Don't: ${voice.dont_list.join(" | ")}`,
      ].join("\n")
    : "No brand voice configured — keep prose neutral.";

  const admin = createAdminClient();

  // Pull freshly-inserted keywords to feed the brief generator.
  const { data: kwRows } = await admin
    .from("keyword_rankings")
    .select("keyword, notes")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(25);
  const keywordSeed = ((kwRows ?? []) as Array<{
    keyword: string;
    notes: string | null;
  }>).map((r) => ({
    keyword: r.keyword,
    intent: parseIntent(r.notes),
    difficulty: "medium" as const,
  }));

  // Competitors for counter-positioning context.
  const { data: compRows } = await admin
    .from("competitors")
    .select("name, website, strengths")
    .eq("tenant_id", tenantSlug)
    .limit(10);
  const competitors = ((compRows ?? []) as Array<{
    name: string;
    website: string | null;
    strengths: string[] | null;
  }>).map((c) => ({
    name: c.name,
    domain: c.website
      ? c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : null,
    why: c.strengths?.[0] ?? "",
  }));

  const result = await generateStarterBriefsAi(
    tenantSlug,
    voiceBlock,
    positioningBlock,
    keywordSeed,
    competitors
  );

  const rows = result.briefs.map((b) => ({
    tenant_id: tenantSlug,
    platform: b.platform,
    content_type: b.content_type,
    title: b.title,
    outline: b.outline,
    draft_content: b.draft_content,
    seo_keywords: b.seo_keywords,
    status: "draft" as const,
    triggered_by_type: "manual" as const,
  }));

  let added = 0;
  if (rows.length > 0) {
    const { error, count } = await admin
      .from("content_briefs")
      .insert(rows, { count: "exact" });
    if (error) throw new Error(error.message);
    added = count ?? rows.length;
  }

  return {
    ...state,
    phase: "ok",
    briefs_added: added,
    total_cost_usd: state.total_cost_usd + result.cost,
    updated_at: new Date().toISOString(),
  };
}

function parseIntent(
  notes: string | null
): "informational" | "commercial" | "transactional" | "navigational" {
  if (!notes) return "informational";
  const match = notes.match(
    /Intent:\s*(informational|commercial|transactional|navigational)/i
  );
  return (match?.[1]?.toLowerCase() as
    | "informational"
    | "commercial"
    | "transactional"
    | "navigational") ?? "informational";
}

// ──────────────────────────────────────────────────────────
// Skip audit path — sets default brand voice & positioning
// so the user can enter the dashboard immediately.
// ──────────────────────────────────────────────────────────

export async function skipBrandAudit(
  tenantSlug: string
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { data: tenant, error: readErr } = await supabase
      .from("tenants")
      .select("name, settings")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (readErr) return { success: false, error: readErr.message };
    if (!tenant) return { success: false, error: "Tenant not found." };

    const existing = (tenant.settings as Record<string, unknown>) ?? {};

    // Skip is meant to unblock onboarding with placeholder copy, not to
    // clobber real content — if this tenant already has a completed audit
    // or a manual edit, leave it alone and just clear any in-progress
    // audit state so the dashboard gate opens.
    if (hasProtectedBrandContent(existing)) {
      const next = { ...existing };
      delete next.audit_state;
      const { error: writeErr } = await supabase
        .from("tenants")
        .update({ settings: next })
        .eq("slug", tenantSlug);
      if (writeErr) return { success: false, error: writeErr.message };
      revalidatePath("/dashboard");
      revalidatePath("/settings");
      return { success: true };
    }

    const brandName = tenant.name || tenantSlug;

    const voice = {
      tone: `Clear, professional, and engaging voice for ${brandName}.`,
      audience: `Customers and audience interested in ${brandName}.`,
      do_list: [
        "Be clear, direct, and valuable",
        "Maintain an authentic brand tone",
      ],
      dont_list: [
        "Avoid overly dense jargon",
        "Don't post without clear value",
      ],
      example_posts: [
        `Welcome to ${brandName}! We're excited to share our latest updates with you.`,
      ],
    };

    const positioning = {
      mission: `Building value and audience engagement for ${brandName}.`,
      value_proposition: `Delivering consistent, valuable insights for ${brandName}'s audience.`,
      target_demographics: [
        {
          segment: "Target Audience",
          pain_points: ["Finding reliable information", "Staying updated"],
        },
      ],
      topics_to_cover: ["Product updates", "Industry insights", "Customer stories"],
      topics_to_avoid: [],
      competitors: [],
      differentiators: ["Clear value proposition", "Authentic perspective"],
    };

    const merged = {
      ...existing,
      brand_voice: voice,
      brand_positioning: positioning,
      brand_audit_skipped: true,
      brand_audit_source: "placeholder",
    };

    const { error: writeErr } = await supabase
      .from("tenants")
      .update({ settings: merged })
      .eq("slug", tenantSlug);

    if (writeErr) return { success: false, error: writeErr.message };

    revalidatePath("/dashboard");
    revalidatePath("/settings");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

