"use client";

// "Get started · N/M steps" sidebar widget with a collapsible panel.
// Each step clicks into a focused modal — the tenant can fill everything
// without ever leaving the sidebar. Auto-hides once all 4 steps are
// done (the user shouldn't have to keep looking at it forever).
//
// Inspired by Linear, Notion, and Stripe activation checklists — the
// industry's best-practice pattern for pushing new users through the
// first 5 things that unlock real value.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  Globe,
  Users,
  KeyRound,
  FileText,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogCloseButton,
  useDialogs,
} from "@/components/ui/Dialog";
import { runBrandAudit } from "@/lib/actions/brand-audit";
import {
  bulkAddCompetitors,
  bulkAddKeywords,
} from "@/lib/actions/onboarding";
import type {
  OnboardingProgress,
  OnboardingStep,
  OnboardingStepId,
} from "@/lib/services/onboarding";

interface Props {
  progress: OnboardingProgress;
  tenantSlug: string;
  tenantName: string;
}

const STEP_ICON: Record<OnboardingStepId, LucideIcon> = {
  "brand-audit": Globe,
  competitors: Users,
  keywords: KeyRound,
  "first-blog": FileText,
};

export function OnboardingChecklist({
  progress,
  tenantSlug,
  tenantName,
}: Props) {
  const [expanded, setExpanded] = useState(progress.completed < progress.total);
  const [activeStep, setActiveStep] = useState<OnboardingStepId | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (progress.allDone || dismissed) return null;

  const pct = Math.round((progress.completed / progress.total) * 100);

  return (
    <>
      <div className="px-4 pt-1 pb-3">
        <div className="rounded-xl border border-border/60 bg-card/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-sidebar/60 transition-colors text-left"
          >
            <div className="shrink-0 h-6 w-6 rounded-full bg-primary-500/15 text-primary-500 flex items-center justify-center">
              <Sparkles size={12} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-foreground leading-none">
                Get started
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-sidebar overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-muted shrink-0">
                  {progress.completed} / {progress.total} steps
                </span>
              </div>
            </div>
            {expanded ? (
              <ChevronUp size={13} className="text-text-muted shrink-0" />
            ) : (
              <ChevronDown size={13} className="text-text-muted shrink-0" />
            )}
          </button>

          {expanded && (
            <div className="border-t border-border/30 p-2 space-y-1">
              {progress.steps.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  onClick={() => setActiveStep(step.id)}
                />
              ))}
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="w-full text-[10px] text-text-muted hover:text-foreground transition-colors pt-1.5 pb-1 text-center"
              >
                Hide until next login
              </button>
            </div>
          )}
        </div>
      </div>

      {activeStep === "brand-audit" && (
        <BrandAuditStep
          tenantSlug={tenantSlug}
          tenantName={tenantName}
          onClose={() => setActiveStep(null)}
        />
      )}
      {activeStep === "competitors" && (
        <CompetitorsStep onClose={() => setActiveStep(null)} />
      )}
      {activeStep === "keywords" && (
        <KeywordsStep onClose={() => setActiveStep(null)} />
      )}
      {activeStep === "first-blog" && (
        <FirstBlogStep onClose={() => setActiveStep(null)} />
      )}
    </>
  );
}

function StepRow({
  step,
  onClick,
}: {
  step: OnboardingStep;
  onClick: () => void;
}) {
  const Icon = STEP_ICON[step.id];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={step.done}
      className={`w-full px-2.5 py-2 rounded-md flex items-center gap-2.5 text-left transition-colors ${
        step.done
          ? "opacity-60"
          : "hover:bg-sidebar/80 active:bg-sidebar"
      }`}
    >
      <div
        className={`shrink-0 h-5 w-5 rounded-full flex items-center justify-center ${
          step.done
            ? "bg-status-green text-white"
            : "bg-sidebar text-text-muted border border-border"
        }`}
      >
        {step.done ? (
          <Check size={11} strokeWidth={3} />
        ) : (
          <Icon size={11} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-[12px] font-medium leading-tight ${
            step.done ? "text-text-muted line-through" : "text-foreground"
          }`}
        >
          {step.label}
        </p>
        {step.progress && !step.done && (
          <p className="text-[10px] text-text-muted mt-0.5">{step.progress}</p>
        )}
      </div>
      {!step.done && (
        <ArrowRight size={11} className="text-text-muted shrink-0" />
      )}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Step 1: Brand audit
// ──────────────────────────────────────────────────────────

function BrandAuditStep({
  tenantSlug,
  tenantName,
  onClose,
}: {
  tenantSlug: string;
  tenantName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!url.trim()) return;
    setError(null);
    setRunning(true);
    startTransition(async () => {
      const res = await runBrandAudit(tenantSlug, url.trim());
      setRunning(false);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onClose={onClose} locked={running || isPending}>
      <div className="relative">
        {!(running || isPending) && <DialogCloseButton onClose={onClose} />}
        <DialogHeader
          title={`Run your brand audit`}
          subtitle={`Paste ${tenantName}'s website URL and we'll extract your voice, positioning, and summary in about 20 seconds.`}
          tone="default"
          icon={Globe}
        />
        <DialogBody>
          <div className="relative">
            <Globe
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !running && !isPending) submit();
              }}
              disabled={running || isPending}
              placeholder="gruve.events"
              className="pl-9"
              autoFocus
            />
          </div>
          {running && (
            <p className="text-xs text-text-muted flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-primary-500 animate-pulse" />
              Reading your site and drafting your profile…
            </p>
          )}
          {error && (
            <p className="text-xs text-status-red" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={running || isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!url.trim() || running || isPending}
          >
            <Sparkles size={14} />
            {running || isPending ? "Building profile…" : "Build my profile"}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Step 2: Competitors
// ──────────────────────────────────────────────────────────

function CompetitorsStep({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const raw = text.trim();
    if (!raw) {
      setError("Add at least one competitor.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await bulkAddCompetitors(raw);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onClose={onClose} locked={isPending}>
      <div className="relative">
        {!isPending && <DialogCloseButton onClose={onClose} />}
        <DialogHeader
          title="Add your competitors"
          subtitle="Paste names or URLs, one per line. We'll set sensible defaults — you can refine each one later in Competition."
          tone="default"
          icon={Users}
        />
        <DialogBody>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={isPending}
            placeholder={"Competitor Name\nhttps://another-competitor.com\nthird.co"}
            autoFocus
          />
          <p className="text-[11px] text-text-muted">
            Up to 20 at a time. We&apos;ll parse URLs into clean names
            automatically.
          </p>
          {error && (
            <p className="text-xs text-status-red" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!text.trim() || isPending}>
            {isPending ? "Adding…" : "Add competitors"}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Step 3: Keywords
// ──────────────────────────────────────────────────────────

function KeywordsStep({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const raw = text.trim();
    if (!raw) {
      setError("Add at least one keyword.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await bulkAddKeywords(raw);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
      if (res.skippedDuplicates > 0) {
        await dialogs.alert({
          title: `${res.added} keyword${res.added === 1 ? "" : "s"} added`,
          subtitle: `${res.skippedDuplicates} were already tracked, so we skipped them.`,
          tone: "success",
        });
      }
    });
  };

  return (
    <Dialog open onClose={onClose} locked={isPending}>
      <div className="relative">
        {!isPending && <DialogCloseButton onClose={onClose} />}
        <DialogHeader
          title="Track your keywords"
          subtitle="One keyword per line. These are the SEO queries your team will benchmark blog posts and SERP analysis against."
          tone="default"
          icon={KeyRound}
        />
        <DialogBody>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={isPending}
            placeholder={"best tools for remote teams\nhow to grow a newsletter\ncontent strategy for startups"}
            autoFocus
          />
          <p className="text-[11px] text-text-muted">
            Up to 30 at a time. Duplicates are skipped automatically.
          </p>
          {error && (
            <p className="text-xs text-status-red" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!text.trim() || isPending}>
            {isPending ? "Adding…" : "Track keywords"}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Step 4: First blog — sends the user to the blog writer with a CTA
// focused on generating their first post.
// ──────────────────────────────────────────────────────────

function FirstBlogStep({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  return (
    <Dialog open onClose={onClose}>
      <div className="relative">
        <DialogCloseButton onClose={onClose} />
        <DialogHeader
          title="Generate your first blog"
          subtitle="Your team is ready. We'll use your voice, positioning, and tracked keywords to draft a post — then iterate it to a 90+ quality score in about 2 minutes."
          tone="default"
          icon={FileText}
        />
        <DialogBody>
          <ul className="text-xs text-text-secondary space-y-1.5">
            <li className="flex items-center gap-2">
              <Check size={12} className="text-status-green" />
              Voice and positioning auto-injected into the prompt
            </li>
            <li className="flex items-center gap-2">
              <Check size={12} className="text-status-green" />
              Scored on 7 axes, refined until it hits 90 or best-effort
            </li>
            <li className="flex items-center gap-2">
              <Check size={12} className="text-status-green" />
              Full version history, voice feedback, regenerate anytime
            </li>
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Later
          </Button>
          <Button
            onClick={() => {
              onClose();
              router.push("/seo-tracker/blog-writer");
            }}
          >
            Open Blog Writer
            <ArrowRight size={14} />
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

