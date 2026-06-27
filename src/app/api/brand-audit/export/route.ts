import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const url = new URL(req.url);
  const tenantSlug = url.searchParams.get("tenant");
  if (!tenantSlug)
    return NextResponse.json({ error: "tenant required" }, { status: 400 });

  // Verify membership via RLS client
  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name,settings")
    .eq("slug", tenantSlug)
    .single();

  if (!tenant)
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  const voice = settings.brand_voice as Record<string, unknown> | undefined;
  const positioning = settings.brand_positioning as
    | Record<string, unknown>
    | undefined;
  const auditMeta = settings.brand_audit_meta as
    | Record<string, unknown>
    | undefined;

  // Fetch competitors, keywords, briefs via admin (bypasses RLS for aggregation)
  const admin = createAdminClient();
  const [{ data: competitors }, { data: keywords }, { data: briefs }] =
    await Promise.all([
      admin
        .from("competitors")
        .select("name,website,type,strengths,weaknesses,threat_level")
        .eq("tenant_id", tenantSlug)
        .order("created_at"),
      admin
        .from("keyword_rankings")
        .select("keyword,difficulty,volume,position")
        .eq("tenant_slug", tenantSlug)
        .order("created_at")
        .limit(30),
      admin
        .from("content_briefs")
        .select("title,content_type,platform,seo_keywords,outline")
        .eq("tenant_id", tenantSlug)
        .is("dismissed_at", null)
        .order("created_at")
        .limit(10),
    ]);

  const now = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
  const auditDate = auditMeta?.ran_at
    ? new Date(auditMeta.ran_at as string).toLocaleDateString("en-GB", {
        dateStyle: "long",
      })
    : "Not yet run";
  const auditUrl = (auditMeta?.url as string) ?? "—";

  const lines: string[] = [
    `# Brand Audit Report — ${tenant.name}`,
    ``,
    `_Generated: ${now}_  `,
    `_Audit source URL: ${auditUrl}_  `,
    `_Last audited: ${auditDate}_`,
    ``,
    `---`,
    ``,
  ];

  // Brand voice section
  lines.push(`## Brand Voice`);
  if (voice) {
    if (voice.tone) lines.push(``, `**Tone:** ${voice.tone}`);
    if (voice.audience) lines.push(``, `**Audience:** ${voice.audience}`);
    if (Array.isArray(voice.do_list) && voice.do_list.length) {
      lines.push(``, `**Do:**`);
      (voice.do_list as string[]).forEach((d) => lines.push(`- ${d}`));
    }
    if (Array.isArray(voice.dont_list) && voice.dont_list.length) {
      lines.push(``, `**Don't:**`);
      (voice.dont_list as string[]).forEach((d) => lines.push(`- ${d}`));
    }
    if (Array.isArray(voice.example_posts) && voice.example_posts.length) {
      lines.push(``, `**Example posts:**`);
      (voice.example_posts as string[]).forEach((p) => lines.push(`> ${p}`));
    }
  } else {
    lines.push(``, `_No brand voice data yet._`);
  }

  lines.push(``, `---`, ``);

  // Brand positioning section
  lines.push(`## Brand Positioning`);
  if (positioning) {
    if (positioning.mission)
      lines.push(``, `**Mission:** ${positioning.mission}`);
    if (positioning.value_proposition)
      lines.push(``, `**Value proposition:** ${positioning.value_proposition}`);
    if (
      Array.isArray(positioning.differentiators) &&
      positioning.differentiators.length
    ) {
      lines.push(``, `**Differentiators:**`);
      (positioning.differentiators as string[]).forEach((d) =>
        lines.push(`- ${d}`)
      );
    }
    if (
      Array.isArray(positioning.topics_to_cover) &&
      positioning.topics_to_cover.length
    ) {
      lines.push(``, `**Topics to cover:**`);
      (positioning.topics_to_cover as string[]).forEach((t) =>
        lines.push(`- ${t}`)
      );
    }
    if (
      Array.isArray(positioning.topics_to_avoid) &&
      positioning.topics_to_avoid.length
    ) {
      lines.push(``, `**Topics to avoid:**`);
      (positioning.topics_to_avoid as string[]).forEach((t) =>
        lines.push(`- ${t}`)
      );
    }
    if (
      Array.isArray(positioning.target_demographics) &&
      positioning.target_demographics.length
    ) {
      lines.push(``, `**Target demographics:**`);
      (positioning.target_demographics as Array<{ segment: string; pain_points: string[] }>).forEach((seg) => {
        lines.push(``, `### ${seg.segment}`);
        if (seg.pain_points?.length) {
          lines.push(`Pain points:`);
          seg.pain_points.forEach((p) => lines.push(`- ${p}`));
        }
      });
    }
  } else {
    lines.push(``, `_No brand positioning data yet._`);
  }

  lines.push(``, `---`, ``);

  // Competitors
  lines.push(`## Competitors`);
  if (competitors?.length) {
    competitors.forEach((c) => {
      lines.push(``, `### ${c.name}`);
      if (c.website) lines.push(`Website: ${c.website}`);
      if (c.type) lines.push(`Type: ${c.type}`);
      if (c.threat_level) lines.push(`Threat level: ${c.threat_level}/10`);
      if (c.strengths?.length) {
        lines.push(`Strengths:`);
        (c.strengths as string[]).forEach((s) => lines.push(`- ${s}`));
      }
      if (c.weaknesses?.length) {
        lines.push(`Weaknesses (our opportunity):`);
        (c.weaknesses as string[]).forEach((w) => lines.push(`- ${w}`));
      }
    });
  } else {
    lines.push(``, `_No competitors recorded yet._`);
  }

  lines.push(``, `---`, ``);

  // Keywords
  lines.push(`## Tracked Keywords`);
  if (keywords?.length) {
    lines.push(``, `| Keyword | Difficulty | Volume | Position |`);
    lines.push(`|---------|------------|--------|----------|`);
    keywords.forEach((k) => {
      lines.push(
        `| ${k.keyword} | ${k.difficulty ?? "—"} | ${k.volume ?? "—"} | ${k.position != null ? `#${k.position}` : "—"} |`
      );
    });
  } else {
    lines.push(``, `_No keywords tracked yet._`);
  }

  lines.push(``, `---`, ``);

  // Content briefs
  lines.push(`## Starter Content Briefs`);
  if (briefs?.length) {
    briefs.forEach((b, i) => {
      lines.push(``, `### ${i + 1}. ${b.title}`);
      if (b.content_type || b.platform)
        lines.push(`_${b.content_type ?? ""} · ${b.platform ?? ""}_`);
      if (b.seo_keywords?.length)
        lines.push(`Keywords: ${(b.seo_keywords as string[]).join(", ")}`);
      if (b.outline?.length) {
        lines.push(`Outline:`);
        (b.outline as string[]).forEach((item) => lines.push(`- ${item}`));
      }
    });
  } else {
    lines.push(``, `_No content briefs yet._`);
  }

  lines.push(``, `---`, ``);
  lines.push(`_This report was generated by Pulse · gruve.events_`);

  const markdown = lines.join("\n");
  const filename = `brand-audit-${tenantSlug}-${new Date().toISOString().split("T")[0]}.md`;

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
