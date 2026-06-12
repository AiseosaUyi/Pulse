"use client";

import { useState, useTransition } from "react";
import {
  Copy,
  Film,
  RefreshCw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import {
  generatePlanBatchAction,
  setPlanFeedback,
  regeneratePlan,
  deletePlan,
  sendPlanToScheduledPosts,
  updatePlan,
} from "@/lib/actions/content-plans";
import { createVideoProject } from "@/lib/actions/video-projects";
import {
  PLAN_PLATFORMS,
  PLATFORM_LABELS,
  TOOL_LABELS,
  type ContentPlan,
  type PlanPlatform,
  type SuggestedTool,
} from "@/lib/types/content-engine";

export function VideoPlansTab({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: ContentPlan[];
}) {
  const [plans, setPlans] = useState<ContentPlan[]>(initial);
  const [platform, setPlatform] = useState<PlanPlatform>("tiktok");
  const [goal, setGoal] = useState<"engagement" | "conversion" | "awareness">(
    "engagement"
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onGenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await generatePlanBatchAction({
        tenantSlug,
        platform,
        goal,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setPlans((prev) => [...res.plans, ...prev]);
    });
  };

  const visible = plans.filter(
    (p) => p.status !== "dismissed" && p.status !== "used"
  );

  return (
    <div className="space-y-5">
      <div className="bg-card rounded-xl p-5 border border-border/50">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-muted">Platform</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as PlanPlatform)}
              className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground"
            >
              {PLAN_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-muted">Goal</span>
            <select
              value={goal}
              onChange={(e) =>
                setGoal(
                  e.target.value as "engagement" | "conversion" | "awareness"
                )
              }
              className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground"
            >
              <option value="engagement">Engagement</option>
              <option value="conversion">Conversion</option>
              <option value="awareness">Awareness</option>
            </select>
          </label>
          <button
            type="button"
            disabled={isPending}
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-primary-500 text-white hover:bg-primary-500/90 disabled:opacity-50 font-medium text-sm"
          >
            <Sparkles size={14} />
            {visible.length === 0 ? "Generate 3" : "Generate 3 more"}
          </button>
          {isPending && (
            <span className="text-xs text-text-muted">
              Generating… ~10s for the batch.
            </span>
          )}
        </div>
        {error && (
          <p className="text-xs text-status-red mt-3">{error}</p>
        )}
        <p className="text-xs text-text-muted mt-3">
          Each plan picks one of your active formats (rotated for fair coverage),
          drafts the scenes + dialogue, and emits a paste-ready prompt for
          Seedance/Kling. Inactive formats won&rsquo;t be picked — manage them at{" "}
          <a
            href="/settings/content-engine"
            className="text-primary-500 hover:underline"
          >
            Settings → Content Engine
          </a>
          .
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="bg-card rounded-xl border border-border/50 p-8 text-center">
          <p className="text-foreground font-semibold mb-1">No plans yet</p>
          <p className="text-text-muted text-sm">
            Click &ldquo;Generate 3&rdquo; to draft your first batch.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onUpdate={(next) =>
                setPlans((prev) =>
                  prev.map((p) => (p.id === next.id ? next : p))
                )
              }
              onDelete={(id) =>
                setPlans((prev) =>
                  prev.map((p) =>
                    p.id === id ? { ...p, status: "dismissed" } : p
                  )
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  onUpdate,
  onDelete,
}: {
  plan: ContentPlan;
  onUpdate: (p: ContentPlan) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hookDraft, setHookDraft] = useState(plan.output.hook);
  const [readyDraft, setReadyDraft] = useState(plan.output.readyPrompt);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackNotes, setFeedbackNotes] = useState(plan.feedbackNotes ?? "");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onCreateVideo = () => {
    startTransition(async () => {
      setErr(null);
      const res = await createVideoProject({
        sourceKind: "content_plan",
        sourceId: plan.id,
      });
      if (res.success) {
        window.location.href = `/video/${res.projectId}`;
      } else {
        setErr(res.error);
      }
    });
  };

  const onCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(plan.output.readyPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr("Clipboard unavailable");
    }
  };

  const onThumbs = (
    feedback: "good" | "bad",
    notes?: string | null
  ) => {
    setErr(null);
    startTransition(async () => {
      const res = await setPlanFeedback(plan.id, feedback, notes ?? null);
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onUpdate({ ...plan, feedback, feedbackNotes: notes ?? null });
      setFeedbackOpen(false);
    });
  };

  const onRegenerate = () => {
    setErr(null);
    startTransition(async () => {
      const res = await regeneratePlan(plan.id);
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onDelete(plan.id);
    });
  };

  const onDeleteClick = () => {
    if (!confirm("Delete this plan?")) return;
    startTransition(async () => {
      const res = await deletePlan(plan.id);
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onDelete(plan.id);
    });
  };

  const onSendToCalendar = () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const iso = tomorrow.toISOString();
    startTransition(async () => {
      const res = await sendPlanToScheduledPosts(plan.id, iso);
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onUpdate({ ...plan, status: "used" });
    });
  };

  const onSaveEdit = () => {
    setErr(null);
    startTransition(async () => {
      const res = await updatePlan(plan.id, {
        output: { hook: hookDraft, readyPrompt: readyDraft },
      });
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onUpdate({
        ...plan,
        output: {
          ...plan.output,
          hook: hookDraft,
          readyPrompt: readyDraft,
        },
      });
      setEditing(false);
    });
  };

  return (
    <article className="bg-card rounded-xl border border-border/50 p-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">
              {plan.templateName}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-text-muted capitalize">
              {plan.platform}
            </span>
            {plan.templateCategory && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-text-muted">
                {plan.templateCategory}
              </span>
            )}
            <span className="text-[10px] text-text-muted">
              {plan.output.durationSeconds}s · {plan.output.scenes.length}{" "}
              scenes
            </span>
          </div>
        </div>
        <ScoreRow
          v={plan.predictedVirality}
          e={plan.predictedEducation}
          c={plan.predictedConversion}
        />
      </header>

      {plan.suggestedTool && (
        <div className="mt-3 inline-flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-primary-500/10 text-primary-500">
          <span className="font-medium">
            Use {TOOL_LABELS[plan.suggestedTool as SuggestedTool] ?? plan.suggestedTool}
          </span>
          {plan.suggestedToolReason && (
            <span className="text-primary-500/80">
              · {plan.suggestedToolReason}
            </span>
          )}
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-wide text-text-muted">Hook</p>
        {editing ? (
          <textarea
            value={hookDraft}
            rows={2}
            onChange={(e) => setHookDraft(e.target.value)}
            className="w-full text-sm mt-1 rounded border border-border/50 bg-background p-2 text-foreground"
          />
        ) : (
          <p className="text-sm text-foreground mt-1 italic">
            &ldquo;{plan.output.hook}&rdquo;
          </p>
        )}
      </div>

      <details className="mt-3 group">
        <summary className="text-xs text-text-muted cursor-pointer select-none">
          Scene-by-scene ({plan.output.scenes.length})
        </summary>
        <ol className="mt-2 space-y-2">
          {plan.output.scenes.map((s) => (
            <li
              key={s.scene}
              className="bg-background rounded p-3 text-xs space-y-1"
            >
              <p className="text-text-muted text-[10px]">Scene {s.scene}</p>
              <p>
                <span className="text-text-muted">Description: </span>
                <span className="text-foreground">{s.description}</span>
              </p>
              {s.dialogue && (
                <p>
                  <span className="text-text-muted">Dialogue: </span>
                  <span className="text-foreground italic">{s.dialogue}</span>
                </p>
              )}
              <p>
                <span className="text-text-muted">Camera: </span>
                <span className="text-foreground">{s.camera}</span>
              </p>
              <p>
                <span className="text-text-muted">Emotion: </span>
                <span className="text-foreground">{s.emotion}</span>
              </p>
            </li>
          ))}
        </ol>
      </details>

      <details className="mt-3">
        <summary className="text-xs text-text-muted cursor-pointer select-none">
          Ready-to-paste prompt
        </summary>
        {editing ? (
          <textarea
            value={readyDraft}
            rows={8}
            onChange={(e) => setReadyDraft(e.target.value)}
            className="w-full text-xs mt-2 rounded border border-border/50 bg-background p-2 text-foreground font-mono"
          />
        ) : (
          <pre className="mt-2 bg-background rounded p-3 text-xs text-foreground whitespace-pre-wrap font-mono">
            {plan.output.readyPrompt}
          </pre>
        )}
      </details>

      {feedbackOpen && (
        <div className="mt-3 bg-background rounded p-3">
          <textarea
            value={feedbackNotes}
            onChange={(e) => setFeedbackNotes(e.target.value)}
            rows={2}
            placeholder="What didn't work? (optional)"
            className="w-full text-xs rounded border border-border/50 bg-card p-2 text-foreground"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setFeedbackOpen(false)}
              className="text-[11px] px-2 py-1 rounded border border-border/50 text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onThumbs("bad", feedbackNotes)}
              className="text-[11px] px-2 py-1 rounded bg-status-red/10 text-status-red"
            >
              Save feedback
            </button>
          </div>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-status-red">{err}</p>}

      <footer className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={pending}
          onClick={onCreateVideo}
          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
        >
          <Film size={12} />
          Create video
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCopyPrompt}
          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border/50 text-foreground hover:bg-card-hover"
        >
          <Copy size={12} />
          {copied ? "Copied!" : "Copy prompt"}
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] px-2 py-1 rounded border border-border/50 text-text-secondary hover:text-foreground"
          >
            Edit
          </button>
        )}
        {editing && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={onSaveEdit}
              className="text-[11px] px-2 py-1 rounded bg-primary-500 text-white"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setHookDraft(plan.output.hook);
                setReadyDraft(plan.output.readyPrompt);
              }}
              className="text-[11px] px-2 py-1 rounded border border-border/50 text-text-secondary"
            >
              Cancel
            </button>
          </>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => onThumbs("good")}
          className={`p-1.5 rounded ${
            plan.feedback === "good"
              ? "bg-status-green/10 text-status-green"
              : "text-text-muted hover:text-status-green"
          }`}
          aria-label="Mark good"
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setFeedbackOpen(true)}
          className={`p-1.5 rounded ${
            plan.feedback === "bad"
              ? "bg-status-red/10 text-status-red"
              : "text-text-muted hover:text-status-red"
          }`}
          aria-label="Mark bad"
        >
          <ThumbsDown size={14} />
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onRegenerate}
          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded text-text-muted hover:text-foreground"
          title="Replace this plan with a new one"
        >
          <RefreshCw size={12} />
          Regenerate
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={pending}
          onClick={onSendToCalendar}
          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 font-medium"
        >
          <Send size={12} />
          Send to calendar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onDeleteClick}
          className="p-1.5 rounded text-text-muted hover:text-status-red"
          aria-label="Delete"
        >
          <Trash2 size={14} />
        </button>
      </footer>
    </article>
  );
}

function ScoreRow({
  v,
  e,
  c,
}: {
  v: number | null;
  e: number | null;
  c: number | null;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-text-muted">
      <Score label="V" value={v} tone="primary" />
      <Score label="E" value={e} tone="info" />
      <Score label="C" value={c} tone="green" />
    </div>
  );
}

function Score({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "primary" | "info" | "green";
}) {
  const pct = value != null ? Math.max(0, Math.min(10, value)) * 10 : 0;
  const fill =
    tone === "primary"
      ? "bg-primary-500"
      : tone === "info"
        ? "bg-blue-500"
        : "bg-status-green";
  return (
    <div className="flex flex-col items-center gap-0.5 w-9">
      <span>{label}</span>
      <div className="w-full h-1 rounded bg-border/40 overflow-hidden">
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-foreground font-medium">
        {value ?? "—"}
      </span>
    </div>
  );
}
