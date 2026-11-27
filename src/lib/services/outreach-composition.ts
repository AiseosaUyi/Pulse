import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OutreachVentureConfig,
  OutreachDraftMessage,
  OutreachBatch,
  SegmentConfig,
} from "@/lib/types/outreach-config";

export const SURNAME_FIRST_REGEX =
  /^(nguyen|tran|le|pham|hoang|vu|vo|dang|bui|do|ho|ngo|duong|ly|wang|li|zhang|liu|chen|yang|huang|zhao|wu|zhou|xu|sun|ma|zhu|hu|guo|lin|tan|lim|lee|ng|ong|teo|kim|park|choi|jung|kang|cho|yoon|jang)$/i;

export const PUNCTUATION_RESTRICTIONS = /[!;–—]| - /;

const clean = (s?: string | null): string => (s || "").replace(/\s+/g, " ").trim();
const wordCount = (s?: string | null): number => clean(s).split(/\s+/).filter(Boolean).length;
const ensureSentence = (s?: string | null): string => {
  const c = clean(s);
  return c && !/[.!?]$/.test(c) ? c + "." : c;
};

/**
 * Greeting: First name of a named person (handling surname-first cultures),
 * otherwise "<Brand> team,"
 */
export function buildGreeting(person?: string | null, brandOrTeamName?: string | null): string {
  const p = clean(person);
  if (!p) {
    const brand = clean(brandOrTeamName) || "there";
    return brand === "there" ? "Hi there," : `Hi ${brand} team,`;
  }

  const parts = p.split(" ");
  if (parts.length >= 2 && SURNAME_FIRST_REGEX.test(parts[0])) {
    return `Hi ${p},`;
  }

  const honorificStripped = p.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "");
  const first = honorificStripped.split(" ")[0];
  const formattedFirst = first && /^[A-Za-zÀ-ÿ'-]{2,}$/.test(first)
    ? first[0].toUpperCase() + first.slice(1)
    : p;

  return `Hi ${formattedFirst},`;
}

/**
 * Pure linting function checking draft components against venture rules.
 */
export function lintDraftCopy(
  draft: {
    subject: string;
    hook: string;
    idea: string;
    body: string;
    country?: string | null;
  },
  config: {
    bannedRegex: string;
    promiseRegex: string;
    badSubjectRegex?: string;
    verdictRegex?: string;
    wordLimits?: {
      subject: [number, number];
      hook: [number, number];
      idea: [number, number];
    };
    blockedCountries?: string;
    ideaPrefix?: string;
  }
): string[] {
  const warnings: string[] = [];
  const banned = new RegExp(config.bannedRegex, "i");
  const promise = new RegExp(config.promiseRegex, "i");
  const badSubject = new RegExp(config.badSubjectRegex || "\\b(idea for|quick idea|a thought on|quick question)\\b", "i");
  const verdict = new RegExp(config.verdictRegex || "\\b(impressive|love|great|beautiful|stunning|awesome)\\b", "i");
  const blocked = new RegExp(config.blockedCountries || "^$", "i");
  const limits = config.wordLimits || { subject: [3, 7], hook: [8, 22], idea: [25, 45] };

  // 1. Punctuation checks (no em/en dashes, semicolons, exclamation marks)
  if (PUNCTUATION_RESTRICTIONS.test(draft.subject)) {
    warnings.push("Subject contains banned punctuation (!, ;, em-dash or spaced dash)");
  }
  if (PUNCTUATION_RESTRICTIONS.test(draft.hook)) {
    warnings.push("Hook contains banned punctuation (!, ;, em-dash or spaced dash)");
  }
  if (PUNCTUATION_RESTRICTIONS.test(draft.idea)) {
    warnings.push("Idea contains banned punctuation (!, ;, em-dash or spaced dash)");
  }

  // 2. Banned words
  const fullText = [draft.subject, draft.hook, draft.idea].join(" ");
  const bannedMatch = fullText.match(banned);
  if (bannedMatch) {
    warnings.push(`Banned word or phrase detected: "${bannedMatch[0]}"`);
  }

  // 3. Promise & free work
  if (promise.test(draft.idea) || promise.test(draft.hook)) {
    warnings.push("Promise or free work language detected in idea or hook");
  }

  // 4. Bad subject line pattern
  if (badSubject.test(draft.subject)) {
    warnings.push(`Generic subject line pattern detected: "${draft.subject}"`);
  }

  // 5. Verdict or praise in hook
  if (verdict.test(draft.hook)) {
    warnings.push(`Subjective verdict or praise detected in hook: "${draft.hook}"`);
  }

  // 6. Word counts
  const subjWords = wordCount(draft.subject);
  if (subjWords < limits.subject[0] || subjWords > limits.subject[1]) {
    warnings.push(`Subject length (${subjWords} words) outside target [${limits.subject[0]}-${limits.subject[1]}]`);
  }

  const hookWords = wordCount(draft.hook);
  if (hookWords < limits.hook[0] || hookWords > limits.hook[1]) {
    warnings.push(`Hook length (${hookWords} words) outside target [${limits.hook[0]}-${limits.hook[1]}]`);
  }

  const ideaWords = wordCount(draft.idea);
  if (ideaWords < limits.idea[0] || ideaWords > limits.idea[1]) {
    warnings.push(`Idea length (${ideaWords} words) outside target [${limits.idea[0]}-${limits.idea[1]}]`);
  }

  // 7. Idea shape: starts with prefix and ends with ?
  if (config.ideaPrefix) {
    const prefixRegex = new RegExp("^" + config.ideaPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (!prefixRegex.test(clean(draft.idea))) {
      warnings.push(`Idea must start with "${config.ideaPrefix}"`);
    }
  }
  if (!/\?$/.test(clean(draft.idea))) {
    warnings.push("Idea must end with a question mark (?)");
  }

  // 8. Blocked country check
  if (draft.country && blocked.test(draft.country)) {
    warnings.push(`Country "${draft.country}" is on the venture blocked list`);
  }

  return warnings;
}

export async function getOutreachConfig(
  client: SupabaseClient,
  workspace: string
): Promise<OutreachVentureConfig | null> {
  const { data, error } = await client
    .from("outreach_configs")
    .select("*")
    .eq("workspace", workspace)
    .maybeSingle();

  if (error || !data) return null;

  return {
    workspace: data.workspace,
    tenantSlug: data.tenant_slug || data.workspace,
    defaultSegment: data.default_segment,
    segments: (data.segments || {}) as Record<string, SegmentConfig>,
    bannedRegex: data.banned_regex,
    promiseRegex: data.promise_regex,
    badSubjectRegex: data.bad_subject_regex,
    verdictRegex: data.verdict_regex,
    wordLimits: data.word_limits,
    signature: data.signature,
    blockedCountries: data.blocked_countries,
    ideaPrefix: data.idea_prefix,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Deal drafts round-robin into batches of ~40, segments interleaved, named contacts first
 */
export function dealIntoBatches(
  drafts: OutreachDraftMessage[],
  targetBatchSize = 40
): OutreachBatch[] {
  if (!drafts.length) return [];

  // Group by segment
  const bySegment: Record<string, OutreachDraftMessage[]> = {};
  for (const d of drafts) {
    bySegment[d.segment] = bySegment[d.segment] || [];
    bySegment[d.segment].push(d);
  }

  // Named contacts first within each segment
  for (const s in bySegment) {
    bySegment[s].sort((a, b) => (b.hasNamedContact ? 1 : 0) - (a.hasNamedContact ? 1 : 0));
  }

  const numBatches = Math.max(1, Math.ceil(drafts.length / targetBatchSize));
  const rawBuckets: OutreachDraftMessage[][] = Array.from({ length: numBatches }, () => []);

  // Round-robin deal across batches
  let bucketIndex = 0;
  for (const list of Object.values(bySegment)) {
    for (const item of list) {
      rawBuckets[bucketIndex++ % numBatches].push(item);
    }
  }

  // Interleave segments inside each batch
  const batches: OutreachBatch[] = [];
  for (let b = 0; b < rawBuckets.length; b++) {
    const bucket = rawBuckets[b];
    const segMap: Record<string, OutreachDraftMessage[]> = {};
    for (const item of bucket) {
      segMap[item.segment] = segMap[item.segment] || [];
      segMap[item.segment].push(item);
    }

    const interleaved: OutreachDraftMessage[] = [];
    let hasMore = true;
    while (hasMore) {
      hasMore = false;
      for (const s in segMap) {
        const next = segMap[s].shift();
        if (next) {
          interleaved.push(next);
          hasMore = true;
        }
      }
    }

    const wordCounts = interleaved.map((d) => wordCount(d.body));
    const minW = wordCounts.length ? Math.min(...wordCounts) : 0;
    const maxW = wordCounts.length ? Math.max(...wordCounts) : 0;
    const avgW = wordCounts.length ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0;

    batches.push({
      batchNumber: b + 1,
      drafts: interleaved,
      wordCountStats: { min: minW, avg: avgW, max: maxW },
    });
  }

  return batches;
}

/**
 * Builds drafts for prospects, lints them, and saves them to outbound_dms as drafts.
 * NEVER sends any messages.
 */
export async function composeAndSaveDrafts(
  client: SupabaseClient,
  workspace: string,
  opts: {
    runId?: string;
    prospectIds?: string[];
    batchSize?: number;
  } = {}
): Promise<{ batches: OutreachBatch[]; totalDrafts: number; totalWarnings: number; sent: false }> {
  const config = await getOutreachConfig(client, workspace);
  if (!config) {
    throw new Error(`Outreach config not found for venture ${workspace}`);
  }

  let query = client
    .from("prospects")
    .select("*")
    .eq("tenant_slug", workspace);

  // Only prospects not yet contacted. A run can contain sent or replied
  // prospects, and composing must never pull those back to "drafted".
  query = query.in("status", ["new", "qualified", "drafted"]);
  if (opts.runId) {
    query = query.eq("run_id", opts.runId);
  } else if (opts.prospectIds && opts.prospectIds.length) {
    query = query.in("id", opts.prospectIds);
  } else {
    query = query.in("status", ["new", "qualified"]).limit(100);
  }

  const { data: prospects, error } = await query;
  if (error || !prospects || !prospects.length) {
    return { batches: [], totalDrafts: 0, totalWarnings: 0, sent: false };
  }

  const turnCounters: Record<string, number> = {};
  const pickRotated = (key: string, list: string[]): string => {
    if (!list || !list.length) return "";
    turnCounters[key] = (turnCounters[key] || 0) + 1;
    return list[(turnCounters[key] - 1) % list.length];
  };

  const compiledDrafts: OutreachDraftMessage[] = [];
  let totalWarningsCount = 0;

  for (const p of prospects) {
    const rawSeg = clean(p.segment);
    const segKey = config.segments[rawSeg] ? rawSeg : config.defaultSegment;
    const seg = config.segments[segKey] || { proof: [], offer: [], ask: [] };

    const person = clean(p.verified_name || p.display_name || "");
    const company = clean(p.company_name || p.display_name || p.handle);

    const greeting = buildGreeting(person, company);

    // Extract hook and idea from signal_data or notes or fallback to standard shape
    const sigData = (p.signal_data || {}) as Record<string, unknown>;
    const subject = clean(sigData.subject as string) || `${company} x ${config.signature}`;
    const hook = ensureSentence(clean(sigData.hook as string) || clean(p.signal_summary) || `Saw your recent event updates on ${p.platform}.`);
    const idea = clean(sigData.idea as string) || `${config.ideaPrefix} quick digital check-in directly for your upcoming event dates?`;

    const proof = pickRotated(`proof:${workspace}:${segKey}`, seg.proof);
    const offer = pickRotated(`offer:${workspace}:${segKey}`, seg.offer);
    const ask = pickRotated(`ask:${workspace}:${segKey}`, seg.ask);

    const bodyParagraphs = [
      greeting,
      hook,
      idea,
      clean(`${proof} ${offer}`),
      ask,
      config.signature,
    ].filter(Boolean);

    const fullBody = bodyParagraphs.join("\n\n");

    const warnings = lintDraftCopy(
      {
        subject,
        hook,
        idea,
        body: fullBody,
        country: p.country,
      },
      config
    );

    totalWarningsCount += warnings.length;

    const draftItem: OutreachDraftMessage = {
      prospectId: p.id,
      recipientEmail: p.email || null,
      recipientHandle: p.handle || null,
      subject,
      body: fullBody,
      segment: segKey,
      hasNamedContact: Boolean(person),
      warnings,
    };

    compiledDrafts.push(draftItem);

    // Only a server-verified address becomes a recipient. Unverified or
    // dropped emails still get a draft (for DM use) but can never be emailed.
    const toEmail = p.email_status === "verified" && p.email ? String(p.email).trim().toLowerCase() : null;

    // Save as draft in outbound_dms (status: 'drafted'). Nothing is sent from
    // here: only a human approval (autopilot review) can queue a send.
    // A re-run replaces the engine's own unapproved draft instead of piling up
    // duplicates; anything else gets the next version number.
    const { data: prior } = await client
      .from("outbound_dms")
      .select("id, version, status, generator_model")
      .eq("tenant_slug", workspace)
      .eq("prospect_id", p.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prior && prior.status === "drafted" && prior.generator_model === "outreach-composition-engine") {
      await client
        .from("outbound_dms")
        .update({ body: fullBody, subject, to_email: toEmail, lint_warnings: warnings })
        .eq("tenant_slug", workspace)
        .eq("id", prior.id);
    } else {
      await client.from("outbound_dms").insert({
        tenant_slug: workspace,
        prospect_id: p.id,
        version: prior ? (prior.version as number) + 1 : 1,
        body: fullBody,
        subject,
        to_email: toEmail,
        kind: "cold_open",
        lint_warnings: warnings,
        status: "drafted",
        generator_model: "outreach-composition-engine",
        generator_cost_usd: 0,
      });
    }

    await client
      .from("prospects")
      .update({
        status: "drafted",
        last_touched_at: new Date().toISOString(),
      })
      .eq("tenant_slug", workspace)
      .eq("id", p.id);
  }

  const batches = dealIntoBatches(compiledDrafts, opts.batchSize || 40);

  return {
    batches,
    totalDrafts: compiledDrafts.length,
    totalWarnings: totalWarningsCount,
    sent: false,
  };
}
