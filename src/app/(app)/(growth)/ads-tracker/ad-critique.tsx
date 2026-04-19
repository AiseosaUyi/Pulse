"use client";

import { useState, useTransition } from "react";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { critiqueAdAction } from "@/lib/actions/critique-ad";
import {
  AD_OBJECTIVES,
  AD_PLATFORMS,
  type AdCritique,
  type AdObjective,
  type AdPlatform,
} from "@/lib/ai/critique-ad";

const PLATFORM_LABELS: Record<AdPlatform, string> = {
  meta_facebook: "Meta · Facebook",
  meta_instagram: "Meta · Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  google_search: "Google Search",
  linkedin: "LinkedIn",
  other: "Other",
};

const OBJECTIVE_LABELS: Record<AdObjective, string> = {
  awareness: "Awareness",
  traffic: "Traffic",
  engagement: "Engagement",
  leads: "Leads",
  sales: "Sales",
  app_install: "App install",
};

const VERDICT_STYLES: Record<
  AdCritique["verdict"],
  { label: string; Icon: typeof CheckCircle2; cls: string }
> = {
  ship_as_is: {
    label: "Ship as-is",
    Icon: CheckCircle2,
    cls: "bg-status-green/10 text-status-green border-status-green/30",
  },
  polish: {
    label: "Polish",
    Icon: Wrench,
    cls: "bg-status-yellow/10 text-status-yellow border-status-yellow/30",
  },
  pause_and_rewrite: {
    label: "Pause + rewrite",
    Icon: PauseCircle,
    cls: "bg-status-red/10 text-status-red border-status-red/30",
  },
  kill: {
    label: "Kill it",
    Icon: XCircle,
    cls: "bg-status-red/15 text-status-red border-status-red/40",
  },
};

export function AdCritiquePanel({ tenantSlug }: { tenantSlug: string }) {
  const [platform, setPlatform] = useState<AdPlatform>("meta_facebook");
  const [objective, setObjective] = useState<AdObjective>("sales");
  const [headline, setHeadline] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [cta, setCta] = useState("Learn more");
  const [audience, setAudience] = useState("");
  const [visual, setVisual] = useState("");
  const [perf, setPerf] = useState("");
  const [critique, setCritique] = useState<AdCritique | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isCritiquing, startCritique] = useTransition();

  const canSubmit =
    headline.trim() && primaryText.trim() && cta.trim() && !isCritiquing;

  const handleSubmit = () => {
    setError(null);
    setCritique(null);
    startCritique(async () => {
      const res = await critiqueAdAction(tenantSlug, {
        platform,
        objective,
        headline,
        primaryText,
        cta,
        audience,
        visualDescription: visual,
        currentPerformance: perf,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setCritique(res.critique);
    });
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-5 md:p-6">
      <header className="flex items-center gap-3 mb-5">
        <div className="h-9 w-9 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center">
          <Sparkles size={16} />
        </div>
        <div>
          <h2 className="text-foreground font-semibold">AI Creative Critic</h2>
          <p className="text-xs text-text-muted">
            Paste your ad copy. Get scored on hook, clarity, CTA, brand and
            platform fit. One rewrite per pass.
          </p>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <Label htmlFor="ad-platform">Platform</Label>
          <select
            id="ad-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as AdPlatform)}
            className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
          >
            {AD_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ad-objective">Objective</Label>
          <select
            id="ad-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value as AdObjective)}
            className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
          >
            {AD_OBJECTIVES.map((o) => (
              <option key={o} value={o}>
                {OBJECTIVE_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <Label htmlFor="ad-headline">Headline / hook</Label>
          <Input
            id="ad-headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="e.g. Stop wasting budget on cold traffic."
          />
        </div>
        <div>
          <Label htmlFor="ad-body">Primary text</Label>
          <Textarea
            id="ad-body"
            rows={4}
            value={primaryText}
            onChange={(e) => setPrimaryText(e.target.value)}
            placeholder="The full body copy the audience will see."
          />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ad-cta">CTA</Label>
            <Input
              id="ad-cta"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="Learn more / Shop now / Sign up"
            />
          </div>
          <div>
            <Label htmlFor="ad-audience">Audience (optional)</Label>
            <Input
              id="ad-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Event organisers in Lagos, 25-45"
            />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ad-visual">Visual description (optional)</Label>
            <Input
              id="ad-visual"
              value={visual}
              onChange={(e) => setVisual(e.target.value)}
              placeholder="Founder talking to camera, warm lighting"
            />
          </div>
          <div>
            <Label htmlFor="ad-perf">Current performance (optional)</Label>
            <Input
              id="ad-perf"
              value={perf}
              onChange={(e) => setPerf(e.target.value)}
              placeholder="CTR 0.6%, CPM ₦18,000, ROAS 1.2x"
            />
          </div>
        </div>
      </div>

      {error && (
        <div
          className="mb-3 rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="sm"
          className="gap-1.5"
        >
          {isCritiquing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Critiquing…
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Run critique
            </>
          )}
        </Button>
      </div>

      {critique && (
        <div className="mt-6 space-y-4">
          <CritiqueVerdict critique={critique} />

          <div className="grid md:grid-cols-5 gap-2">
            <ScoreTile label="Overall" value={critique.overall_score} max={100} accent />
            <ScoreTile label="Hook" value={critique.hook_score} />
            <ScoreTile label="Clarity" value={critique.clarity_score} />
            <ScoreTile label="CTA" value={critique.cta_score} />
            <ScoreTile label="Brand fit" value={critique.brand_fit_score} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-status-green/20 bg-status-green/5 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-status-green mb-2 flex items-center gap-1.5">
                <CheckCircle2 size={12} />
                What&apos;s working
              </h3>
              <ul className="space-y-1.5">
                {critique.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-foreground leading-relaxed">
                    • {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-status-red/20 bg-status-red/5 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-status-red mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                What&apos;s hurting ROAS
              </h3>
              <ul className="space-y-1.5">
                {critique.weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-foreground leading-relaxed">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {critique.failure_modes.length > 0 && (
            <div className="rounded-lg border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                Cost-driver analysis
              </h3>
              <ul className="space-y-2">
                {critique.failure_modes.map((f, i) => (
                  <li key={i} className="text-xs leading-relaxed">
                    <p className="text-foreground font-medium">{f.issue}</p>
                    <p className="text-text-muted mt-0.5">{f.why_it_hurts_cost}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-primary-500/30 bg-primary-500/5 p-4">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                Ready-to-ship rewrite
              </h3>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    "rewrite",
                    `${critique.rewrites.headline}\n\n${critique.rewrites.primary_text}\n\nCTA: ${critique.rewrites.cta}`
                  )
                }
                className="text-[11px] text-primary-500 hover:text-primary-600 inline-flex items-center gap-1"
              >
                {copied === "rewrite" ? <Check size={11} /> : <Copy size={11} />}
                Copy all
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <RewriteField label="Headline" value={critique.rewrites.headline} />
              <RewriteField label="Primary text" value={critique.rewrites.primary_text} multiline />
              <RewriteField label="CTA" value={critique.rewrites.cta} />
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

function CritiqueVerdict({ critique }: { critique: AdCritique }) {
  const style = VERDICT_STYLES[critique.verdict];
  return (
    <div
      className={`rounded-lg border p-4 flex items-start gap-3 ${style.cls}`}
    >
      <style.Icon size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-wide opacity-80">Verdict</p>
        <p className="text-sm font-bold mt-0.5">{style.label}</p>
        <p className="text-xs mt-1 leading-relaxed">{critique.verdict_reason}</p>
      </div>
    </div>
  );
}

function ScoreTile({
  label,
  value,
  max = 10,
  accent,
}: {
  label: string;
  value: number;
  max?: number;
  accent?: boolean;
}) {
  const pct = Math.round((value / max) * 100);
  const tone =
    pct >= 85
      ? "text-status-green"
      : pct >= 60
        ? "text-status-yellow"
        : "text-status-red";
  return (
    <div
      className={`rounded-lg p-3 border ${
        accent
          ? "border-primary-500/30 bg-primary-500/5"
          : "border-border bg-sidebar/30"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-lg font-bold ${tone} mt-0.5`}>
        {value}
        <span className="text-xs text-text-muted font-normal">/{max}</span>
      </p>
    </div>
  );
}

function RewriteField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd
        className={`text-foreground mt-0.5 ${
          multiline ? "whitespace-pre-wrap leading-relaxed" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
