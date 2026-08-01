// Durable publish workflow (PULSE-SEO-SPEC.md §12). Drives the step
// graph defined in migration 044, checkpointing each step into
// seo_publish_run_steps and resuming from the step after the last 'ok'.
// Not Vercel Workflow DevKit — DB-checkpoint/resume is the deliberate
// choice (044 header; revisit after 100 publishes).
//
//   load_post → upload_cover → upload_inline_assets → upsert_entry
//     → publish_entry → notify_gruve → write_post_index → embed
//     → mark_published
//
// Idempotency: run key is `${blogPostId}:${version}`; an in-flight
// 'running' run for the post is reused. Each step is idempotent —
// asset ids / entry id are read back from prior 'ok' step payloads on
// resume so re-runs never duplicate Contentful objects.
//
// Asset jsonb contract (documented — no other code pins these shapes):
//   cover_image / thumbnail : { url, fileName?, contentType?, alt? } | null
//   inline_images           : Array<{ url, fileName?, contentType? }>
//   author_image            : text URL | null
//   body_rich_text          : Contentful RichText document | null
// body_rich_text MUST already be RichText (generator/editor's job, §8).
// Markdown→RichText conversion is NOT done here — a null fails the run
// loudly rather than publishing an empty body.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  upsertGruveBlog,
  publishGruveBlogEntry,
  uploadGruveAsset,
  resolveContentfulConfig,
  type GruveBlogDraft,
  type GruveBlogAssets,
  type PublishTarget,
} from "@/lib/integrations/contentful";
import { embedSeoPost } from "@/lib/vector/embed";

const STEP_ORDER = [
  "load_post",
  "upload_cover",
  "upload_inline_assets",
  "upsert_entry",
  "publish_entry",
  "notify_gruve",
  "write_post_index",
  "embed",
  "mark_published",
] as const;
type Step = (typeof STEP_ORDER)[number];

type Json = Record<string, unknown>;

export interface PublishOutcome {
  runId: string;
  status: "succeeded" | "failed";
  resumedFrom: Step | null;
  failedStep?: Step;
  error?: string;
}

interface ImageRef {
  url: string;
  fileName?: string;
  contentType?: string;
  alt?: string;
}

function asImageRef(v: unknown): ImageRef | null {
  if (v && typeof v === "object" && typeof (v as ImageRef).url === "string") {
    return v as ImageRef;
  }
  return null;
}

function fileMeta(ref: ImageRef, fallbackName: string) {
  return {
    url: ref.url,
    fileName: ref.fileName ?? fallbackName,
    contentType: ref.contentType ?? "image/jpeg",
  };
}

/** Publish all `scheduled` posts whose scheduled_at has passed. */
export async function sweepDuePublishes(): Promise<{
  status: "ok" | "partial" | "failed";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const admin = createAdminClient();
  const { data: due } = await admin
    .from("blog_posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .limit(25);
  const posts = due ?? [];
  let ok = 0;
  let failed = 0;
  for (const p of posts) {
    const r = await runPublish({ blogPostId: p.id });
    if (r.status === "succeeded") ok++;
    else failed++;
  }
  return {
    status: failed > 0 && ok > 0 ? "partial" : failed > 0 ? "failed" : "ok",
    rowsProcessed: posts.length,
    metadata: { ok, failed },
  };
}

export async function runPublish(args: {
  blogPostId: string;
  triggeredBy?: string | null;
  /** Which Contentful environment to publish into. Default "live" (master/www). */
  target?: PublishTarget;
}): Promise<PublishOutcome> {
  const supabase = createAdminClient();
  const { blogPostId } = args;
  const target: PublishTarget = args.target ?? "live";

  // ── Load post ──────────────────────────────────────────────────────
  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select(
      "id, tenant_slug, status, version, title, slug, question, excerpt, meta_description, body_rich_text, author, author_image, read_minutes, seo_meta_title, seo_meta_description, canonical_override, faq_items, json_ld_overrides, pulse_metadata, cover_image, thumbnail, inline_images, tags, category, author_bio, author_title, author_url, published_date, updated_date, noindex, content_flags, content_flags_cleared"
    )
    .eq("id", blogPostId)
    .maybeSingle();

  if (postErr || !post) {
    return {
      runId: "",
      status: "failed",
      resumedFrom: null,
      failedStep: "load_post",
      error: postErr?.message ?? "post not found",
    };
  }

  let version: number = post.version;

  // Resolve this tenant's Contentful config for the requested target
  // (per-tenant integration, env fallback). Fail fast if neither is set —
  // nothing downstream can publish.
  const cfg = await resolveContentfulConfig(post.tenant_slug, target);
  if (!cfg) {
    return {
      runId: "",
      status: "failed",
      resumedFrom: null,
      failedStep: "load_post",
      error:
        "Contentful is not configured for this workspace (connect a Contentful integration or set the env credentials).",
    };
  }

  // Ensure the post is in 'publishing'. seo_approved/scheduled → publishing.
  if (post.status === "seo_approved" || post.status === "scheduled") {
    const t = await transition(
      supabase,
      blogPostId,
      post.status,
      "publishing",
      version,
      args.triggeredBy,
      "publish runner start"
    );
    if (!t.ok) {
      return {
        runId: "",
        status: "failed",
        resumedFrom: null,
        failedStep: "load_post",
        error: `cannot enter publishing: ${t.error}`,
      };
    }
    version = t.version;
  } else if (post.status !== "publishing") {
    return {
      runId: "",
      status: "failed",
      resumedFrom: null,
      failedStep: "load_post",
      error: `post status '${post.status}' is not publishable`,
    };
  }

  // ── Reuse or create the run ────────────────────────────────────────
  const { data: openRun } = await supabase
    .from("seo_publish_runs")
    .select("id, target")
    .eq("blog_post_id", blogPostId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Never let a resume/retry flip an in-flight run between live and test —
  // that would publish a half-done run into the wrong Contentful environment.
  if (openRun?.id && openRun.target && openRun.target !== target) {
    return {
      runId: openRun.id,
      status: "failed",
      resumedFrom: null,
      failedStep: "load_post",
      error: `a '${openRun.target}' publish is already in progress for this post; finish or cancel it before publishing to '${target}'`,
    };
  }

  let runId: string;
  if (openRun?.id) {
    runId = openRun.id;
  } else {
    const { data: created, error: runErr } = await supabase
      .from("seo_publish_runs")
      .insert({
        blog_post_id: blogPostId,
        tenant_slug: post.tenant_slug,
        status: "running",
        workflow_run_id: `${blogPostId}:${version}`,
        triggered_by: args.triggeredBy ?? null,
        target,
      })
      .select("id")
      .single();
    if (runErr || !created) {
      return {
        runId: "",
        status: "failed",
        resumedFrom: null,
        failedStep: "load_post",
        error: runErr?.message ?? "could not create publish run",
      };
    }
    runId = created.id;
    await supabase
      .from("blog_posts")
      .update({ publish_run_id: runId })
      .eq("id", blogPostId);
  }

  // ── Resume point: prior 'ok' steps + their payloads ────────────────
  const { data: stepRows } = await supabase
    .from("seo_publish_run_steps")
    .select("step, attempt, status, payload")
    .eq("run_id", runId);

  const okPayload = new Map<Step, Json>();
  const attemptCount = new Map<string, number>();
  for (const r of stepRows ?? []) {
    attemptCount.set(r.step, (attemptCount.get(r.step) ?? 0) + 1);
    if (r.status === "ok") okPayload.set(r.step as Step, (r.payload ?? {}) as Json);
  }

  const firstPending =
    STEP_ORDER.find((s) => !okPayload.has(s)) ?? "mark_published";
  const resumedFrom: Step | null =
    okPayload.size > 0 && firstPending !== STEP_ORDER[0] ? firstPending : null;

  // Carry forward asset ids / entry id from prior ok payloads.
  const assets: GruveBlogAssets = {
    bannerImageId: (okPayload.get("upload_cover")?.bannerImageId as string) ?? null,
    thumbnailId: (okPayload.get("upload_cover")?.thumbnailId as string) ?? null,
    authorImageId:
      (okPayload.get("upload_cover")?.authorImageId as string) ?? null,
  };
  let entryId =
    (okPayload.get("upsert_entry")?.entryId as string | undefined) ?? null;

  const runStep = async (step: Step, fn: () => Promise<Json>) => {
    if (okPayload.has(step)) return okPayload.get(step)!;
    const attempt = (attemptCount.get(step) ?? 0) + 1;
    const t0 = Date.now();
    try {
      const payload = await fn();
      await supabase.from("seo_publish_run_steps").insert({
        run_id: runId,
        step,
        attempt,
        status: "ok",
        duration_ms: Date.now() - t0,
        payload,
      });
      return payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("seo_publish_run_steps").insert({
        run_id: runId,
        step,
        attempt,
        status: "failed",
        duration_ms: Date.now() - t0,
        error: { message },
      });
      throw Object.assign(new Error(message), { step });
    }
  };

  try {
    // load_post — validate the body is publishable.
    await runStep("load_post", async () => {
      if (!post.body_rich_text || typeof post.body_rich_text !== "object") {
        throw new Error(
          "body_rich_text missing/!object — RichText conversion is not wired here (spec §5/§8)"
        );
      }
      if (!post.slug) throw new Error("slug is required to publish");
      const flags = (post.content_flags as unknown[] | null) ?? [];
      if (flags.length > 0 && !post.content_flags_cleared) {
        throw new Error(
          `${flags.length} unreviewed content flag${flags.length === 1 ? "" : "s"} (unverified stats, testimonials, guarantees, or prices) — clear them in the editor before publishing`
        );
      }
      return { ok: true };
    });

    // upload_cover — banner + thumbnail + author image.
    await runStep("upload_cover", async () => {
      const out: Json = {};
      const cover = asImageRef(post.cover_image);
      if (cover) {
        assets.bannerImageId = await uploadGruveAsset({
          ...fileMeta(cover, `${post.slug}-cover`),
          title: `${post.title} — cover`,
        }, cfg);
        out.bannerImageId = assets.bannerImageId;
      }
      const thumb = asImageRef(post.thumbnail);
      if (thumb) {
        assets.thumbnailId = await uploadGruveAsset({
          ...fileMeta(thumb, `${post.slug}-thumb`),
          title: `${post.title} — thumbnail`,
        }, cfg);
        out.thumbnailId = assets.thumbnailId;
      }
      if (typeof post.author_image === "string" && post.author_image) {
        assets.authorImageId = await uploadGruveAsset({
          url: post.author_image,
          fileName: `${post.slug}-author`,
          contentType: "image/jpeg",
          title: `${post.author ?? "Author"} portrait`,
        }, cfg);
        out.authorImageId = assets.authorImageId;
      }
      return out;
    });

    // upload_inline_assets — body images.
    const inlinePayload = await runStep("upload_inline_assets", async () => {
      const list = Array.isArray(post.inline_images) ? post.inline_images : [];
      const ids: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const ref = asImageRef(list[i]);
        if (!ref) continue;
        ids.push(
          await uploadGruveAsset({
            ...fileMeta(ref, `${post.slug}-inline-${i}`),
            title: `${post.title} — inline ${i}`,
          }, cfg)
        );
      }
      return { inlineAssetIds: ids };
    });
    void inlinePayload; // inline asset linking into RichText is upstream's job

    // upsert_entry — idempotent by pulseId.
    const upsertPayload = await runStep("upsert_entry", async () => {
      // Auto-compute read time from word count when not explicitly set.
      // `minuteRead` is an Integer field on the gruveBlog content type — send
      // a plain number, not a formatted string like "8 mins read".
      const estimatedReadTime = (() => {
        if (post.read_minutes != null) return post.read_minutes;
        const richText = post.body_rich_text as { content?: unknown[] } | null;
        if (!richText?.content) return null;
        let words = 0;
        const countWords = (nodes: unknown[]): void => {
          for (const n of nodes) {
            const node = n as { nodeType?: string; value?: string; content?: unknown[] };
            if (node.nodeType === "text" && node.value) {
              words += node.value.trim().split(/\s+/).filter(Boolean).length;
            } else if (node.content) countWords(node.content);
          }
        };
        countWords(richText.content);
        return Math.max(1, Math.ceil(words / 200));
      })();

      const draft: GruveBlogDraft = {
        pulseId: post.id,
        title: post.title,
        slug: post.slug,
        question: post.question ?? null,
        // gruveBlog's `description` field (sourced from excerpt) is required.
        // Posts created before excerpt was persisted at generation time (or
        // any other gap) would otherwise hit a raw Contentful 422 at publish
        // time — fall back to the editor's own Meta description field
        // (blog_posts.meta_description, always populated) rather than null.
        excerpt: post.excerpt ?? post.meta_description ?? null,
        bodyRichText: post.body_rich_text,
        author: post.author ?? null,
        readMinutes: estimatedReadTime,
        seoMetaTitle: post.seo_meta_title ?? null,
        seoMetaDescription: post.seo_meta_description ?? null,
        canonicalOverride: post.canonical_override ?? null,
        faqItems: post.faq_items ?? null,
        jsonLdOverrides: post.json_ld_overrides ?? null,
        pulseMetadata: post.pulse_metadata ?? null,
        tags: post.tags ?? null,
        category: post.category ?? null,
        authorBio: post.author_bio ?? null,
        authorTitle: post.author_title ?? null,
        authorUrl: post.author_url ?? null,
        publishedDate: post.published_date ?? null,
        updatedDate: post.updated_date ?? null,
        noindex: post.noindex ?? null,
      };
      const res = await upsertGruveBlog(draft, assets, cfg);
      await supabase
        .from("blog_posts")
        .update({
          contentful_entry_id: res.entryId,
          contentful_version: res.version,
        })
        .eq("id", post.id);
      return { entryId: res.entryId, created: res.created };
    });
    entryId = (upsertPayload.entryId as string) ?? entryId;

    // publish_entry — Contentful publish.
    await runStep("publish_entry", async () => {
      if (!entryId) throw new Error("no entryId from upsert_entry");
      const r = await publishGruveBlogEntry(entryId, cfg);
      return { publishedVersion: r.version };
    });

    // notify_gruve — no-op: publish_entry already triggers Gruve's
    // Contentful webhook → revalidation. Pulse never calls
    // /api/revalidate (spec §12). Recorded for graph completeness.
    await runStep("notify_gruve", async () => ({
      via: "contentful-publish-webhook",
    }));

    // write_post_index — seo_posts projection.
    await runStep("write_post_index", async () => {
      const { error } = await supabase.from("seo_posts").upsert(
        {
          tenant_slug: post.tenant_slug,
          slug: post.slug,
          blog_post_id: post.id,
          contentful_entry_id: entryId,
          title: post.title,
          published_at: new Date().toISOString(),
          last_updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_slug,slug" }
      );
      if (error) throw new Error(`seo_posts upsert: ${error.message}`);
      return { ok: true };
    });

    // embed — once, on publish.
    await runStep("embed", async () => {
      const body =
        typeof post.body_rich_text === "string"
          ? post.body_rich_text
          : JSON.stringify(post.body_rich_text);
      const r = await embedSeoPost({
        tenantSlug: post.tenant_slug,
        blogPostId: post.id,
        slug: post.slug,
        bodyText: body,
      });
      return { embed: r.status };
    });

    // mark_published — state machine + timestamps + run close.
    await runStep("mark_published", async () => {
      const t = await transition(
        supabase,
        post.id,
        "publishing",
        "published",
        version,
        args.triggeredBy,
        "publish runner success"
      );
      if (!t.ok) throw new Error(`mark_published transition: ${t.error}`);
      await supabase
        .from("blog_posts")
        .update({ published_at: new Date().toISOString() })
        .eq("id", post.id);
      return { version: t.version };
    });

    await supabase
      .from("seo_publish_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", runId);

    return { runId, status: "succeeded", resumedFrom };
  } catch (err) {
    const e = err as Error & { step?: Step };
    const message = e.message;
    await supabase
      .from("seo_publish_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: { message, step: e.step ?? null },
      })
      .eq("id", runId);

    // Best-effort move to publish_failed so the UI can offer retry.
    await transition(
      supabase,
      post.id,
      "publishing",
      "publish_failed",
      version,
      args.triggeredBy,
      `publish failed at ${e.step ?? "unknown"}: ${message}`
    ).catch(() => {});
    await supabase
      .from("blog_posts")
      .update({ last_error: { message, step: e.step ?? null } })
      .eq("id", post.id);

    return {
      runId,
      status: "failed",
      resumedFrom,
      failedStep: e.step,
      error: message,
    };
  }
}

// ── transition_blog_post_status RPC wrapper ───────────────────────────
async function transition(
  supabase: ReturnType<typeof createAdminClient>,
  postId: string,
  from: string,
  to: string,
  expectedVersion: number,
  actor: string | null | undefined,
  reason: string
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("transition_blog_post_status", {
    p_post_id: postId,
    p_from_status: from,
    p_to_status: to,
    p_expected_version: expectedVersion,
    p_actor: actor ?? null,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.new_version && row?.new_version !== 0) {
    return { ok: false, error: "empty transition response" };
  }
  return { ok: true, version: row.new_version as number };
}
