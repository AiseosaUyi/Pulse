// Read-side service for content_format_templates. Merges platform
// rows + tenant forks so callers see exactly one row per "logical
// template": the fork takes precedence when present.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ContentFormatTemplate,
  ContentMedium,
} from "@/lib/types/content-engine";

interface RawRow {
  id: string;
  scope: "platform" | "tenant";
  tenant_slug: string | null;
  parent_template_id: string | null;
  medium: ContentMedium;
  name: string;
  description: string | null;
  category: string | null;
  duration_min: number;
  duration_max: number;
  structure: unknown;
  tone: string | null;
  default_scenes: number;
  example_hook: string | null;
  example_script: string | null;
  is_active: boolean;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

function hydrate(row: RawRow): ContentFormatTemplate {
  return {
    id: row.id,
    scope: row.scope,
    tenantSlug: row.tenant_slug,
    parentTemplateId: row.parent_template_id,
    medium: row.medium,
    name: row.name,
    description: row.description,
    category: row.category,
    durationMin: row.duration_min,
    durationMax: row.duration_max,
    structure: Array.isArray(row.structure) ? (row.structure as string[]) : [],
    tone: row.tone,
    defaultScenes: row.default_scenes,
    exampleHook: row.example_hook,
    exampleScript: row.example_script,
    isActive: row.is_active,
    lastGeneratedAt: row.last_generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Returns merged platform + tenant rows. Tenant forks SUPERSEDE the
// platform original they were forked from — if a tenant has a fork of
// "POV Pain", the platform "POV Pain" disappears from the list.
export async function listForTenant(
  tenantSlug: string,
  medium: ContentMedium = "video"
): Promise<ContentFormatTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_format_templates")
    .select(
      "id, scope, tenant_slug, parent_template_id, medium, name, description, category, duration_min, duration_max, structure, tone, default_scenes, example_hook, example_script, is_active, last_generated_at, created_at, updated_at"
    )
    .eq("medium", medium)
    .order("name");

  if (error || !data) return [];

  const all = data.map((r) => hydrate(r as RawRow));
  const tenantForks = all.filter(
    (t) => t.scope === "tenant" && t.tenantSlug === tenantSlug
  );
  const overriddenParentIds = new Set(
    tenantForks
      .map((t) => t.parentTemplateId)
      .filter((id): id is string => !!id)
  );

  return [
    ...tenantForks,
    ...all.filter(
      (t) =>
        t.scope === "platform" &&
        !overriddenParentIds.has(t.id)
    ),
  ];
}

// Service-role variant for AI generators / cron paths that don't
// have a request cookie.
export async function listForTenantAdmin(
  tenantSlug: string,
  medium: ContentMedium = "video"
): Promise<ContentFormatTemplate[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("content_format_templates")
    .select("*")
    .eq("medium", medium);

  if (error || !data) return [];

  const all = data.map((r) => hydrate(r as RawRow));
  const tenantForks = all.filter(
    (t) => t.scope === "tenant" && t.tenantSlug === tenantSlug
  );
  const overriddenParentIds = new Set(
    tenantForks
      .map((t) => t.parentTemplateId)
      .filter((id): id is string => !!id)
  );
  return [
    ...tenantForks,
    ...all.filter(
      (t) => t.scope === "platform" && !overriddenParentIds.has(t.id)
    ),
  ];
}

// Deterministic-ish format rotation. Sort by last_generated_at ASC
// (nulls first), pick the front N. Adds a small jitter via ID hash
// so two simultaneous batches don't collide on identical timestamps.
export function pickForGeneration(
  active: ContentFormatTemplate[],
  count: number
): ContentFormatTemplate[] {
  if (active.length === 0) return [];

  const scored = active.map((t) => {
    const ts = t.lastGeneratedAt
      ? new Date(t.lastGeneratedAt).getTime()
      : 0;
    // Hash the ID to a small offset so identical timestamps break tie
    // without re-running the same template back-to-back across batches.
    let hash = 0;
    for (let i = 0; i < t.id.length; i += 1) {
      hash = (hash * 31 + t.id.charCodeAt(i)) | 0;
    }
    return { t, score: ts + Math.abs(hash % 997) };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map((s) => s.t);
}
