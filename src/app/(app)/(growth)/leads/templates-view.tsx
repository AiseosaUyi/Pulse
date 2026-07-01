"use client";

// Templates tab for the Outbound page. Three responsibilities:
//   1. List saved templates (primary first)
//   2. Score / edit / copy / promote-to-primary / archive any template
//   3. Generate 3 fresh AI variants from a brief
// All destructive actions use the shared Dialog primitive.

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, useDialogs } from "@/components/ui/Dialog";
import {
  createTemplate,
  deleteTemplate,
  generateTemplateVariants,
  scoreTemplate,
  updateTemplate,
} from "@/lib/actions/outbound-templates";
import {
  TEMPLATE_PLATFORM_LABELS,
  TEMPLATE_PLATFORMS,
  TEMPLATE_TYPE_LABELS,
  TEMPLATE_TYPE_DESCRIPTIONS,
  TEMPLATE_TYPES,
  type OutboundTemplateRecord,
  type TemplateCritique,
  type TemplatePlatform,
  type TemplateType,
} from "@/lib/types/outbound-templates";

const VERDICT_STYLES: Record<
  TemplateCritique["verdict"],
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
  rewrite: {
    label: "Rewrite",
    Icon: PauseCircle,
    cls: "bg-status-red/10 text-status-red border-status-red/30",
  },
  kill: {
    label: "Kill it",
    Icon: XCircle,
    cls: "bg-status-red/15 text-status-red border-status-red/40",
  },
};

export function TemplatesView({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: OutboundTemplateRecord[];
}) {
  const dialogs = useDialogs();
  const [templates, setTemplates] = useState(initial);
  const [creating, setCreating] = useState(initial.length === 0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTemplate = (next: OutboundTemplateRecord) => {
    setTemplates((prev) => prev.map((t) => (t.id === next.id ? next : t)));
  };

  const handleCreate = async (input: {
    name: string;
    platform: TemplatePlatform;
    templateType: TemplateType;
    angle: string;
    body: string;
    makePrimary: boolean;
  }) => {
    setError(null);
    const res = await createTemplate(tenantSlug, { ...input, templateType: input.templateType });
    if (!res.success) {
      setError(res.error);
      return;
    }
    setTemplates((prev) => {
      // If we promoted a new primary, old ones on the same platform
      // have been demoted server-side — reflect that client-side too.
      const next = res.template.isPrimary
        ? prev.map((t) =>
            t.platform === res.template.platform
              ? { ...t, isPrimary: false }
              : t
          )
        : prev;
      return [res.template, ...next];
    });
    setCreating(false);
  };

  const handleScore = async (t: OutboundTemplateRecord) => {
    setError(null);
    const res = await scoreTemplate(tenantSlug, t.id);
    if (!res.success) {
      setError(res.error);
      return;
    }
    refreshTemplate({
      ...t,
      score: res.critique.overall_score,
      lastCritique: res.critique,
      lastScoredAt: new Date().toISOString(),
    });
  };

  const handleDelete = async (t: OutboundTemplateRecord) => {
    const ok = await dialogs.confirm({
      title: `Delete "${t.name}"?`,
      subtitle: "The template is permanently removed.",
      tone: "destructive",
      confirmLabel: "Delete template",
    });
    if (!ok) return;
    const res = await deleteTemplate(tenantSlug, t.id);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
  };

  const handleUpdateBody = async (
    t: OutboundTemplateRecord,
    patch: { body?: string; name?: string; angle?: string | null; templateType?: TemplateType; platform?: TemplatePlatform }
  ) => {
    const res = await updateTemplate(tenantSlug, t.id, patch);
    if (!res.success) {
      setError(res.error);
      return false;
    }
    refreshTemplate({
      ...t,
      body: patch.body ?? t.body,
      name: patch.name ?? t.name,
      angle: patch.angle !== undefined ? patch.angle : t.angle,
      templateType: patch.templateType ?? t.templateType,
      platform: patch.platform ?? t.platform,
      // Invalidate score after a body edit — the critique is stale.
      score: patch.body !== undefined ? null : t.score,
      lastCritique: patch.body !== undefined ? null : t.lastCritique,
      lastScoredAt: patch.body !== undefined ? null : t.lastScoredAt,
    });
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                Outbound templates
              </h3>
              <p className="text-xs text-text-muted leading-relaxed">
                DM templates for every stage of the outreach sequence. Score
                one to get an AI critique, or generate variants to test
                different angles. Default templates apply to all tenants —
                create your own to override them.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setGenerating((v) => !v)}
              className="gap-1.5"
            >
              <RefreshCw size={14} />
              Generate variants
            </Button>
            {!creating && (
              <Button
                size="sm"
                onClick={() => setCreating(true)}
                className="gap-1.5"
              >
                <Plus size={14} />
                New template
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}

      {creating && (
        <NewTemplateForm
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      )}

      {generating && (
        <GenerateVariantsForm
          tenantSlug={tenantSlug}
          seed={templates.find((t) => t.isPrimary)?.body}
          onClose={() => setGenerating(false)}
          onSave={async (input) => {
            const res = await createTemplate(tenantSlug, {
              name: input.name,
              platform: input.platform,
              body: input.body,
              angle: input.angle,
              generatorModel: input.generatorModel,
              generatorCostUsd: input.generatorCostUsd,
            });
            if (!res.success) {
              setError(res.error);
              return false;
            }
            setTemplates((prev) => [res.template, ...prev]);
            return true;
          }}
        />
      )}

      {templates.length === 0 && !creating && !generating && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground font-semibold">
            No templates yet
          </p>
          <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
            Click <strong>New template</strong> to paste your current bulk
            DM and have Pulse score it. Or <strong>Generate variants</strong>{" "}
            if you want 3 fresh AI drafts to pick from.
          </p>
        </div>
      )}

      {templates.length > 0 && (
        <ul className="space-y-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onScore={() => handleScore(t)}
              onDelete={() => handleDelete(t)}
              onUpdate={(patch) => handleUpdateBody(t, patch)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTemplateForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    platform: TemplatePlatform;
    templateType: TemplateType;
    angle: string;
    body: string;
    makePrimary: boolean;
  }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<TemplatePlatform>("instagram");
  const [templateType, setTemplateType] = useState<TemplateType>("cold_open");
  const [angle, setAngle] = useState("");
  const [body, setBody] = useState("");
  const [makePrimary, setMakePrimary] = useState(true);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim() || !body.trim()) return;
    startTransition(async () => {
      await onSubmit({ name, platform, templateType, angle, body, makePrimary });
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          New template
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      <div className="grid md:grid-cols-[1fr_160px_200px] gap-3">
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Event planners cold open"
          />
        </div>
        <div>
          <Label>Type</Label>
          <select
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value as TemplateType)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
          >
            {TEMPLATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TEMPLATE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-text-muted mt-1 leading-tight">
            {TEMPLATE_TYPE_DESCRIPTIONS[templateType]}
          </p>
        </div>
        <div>
          <Label>Platform</Label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as TemplatePlatform)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
          >
            {TEMPLATE_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {TEMPLATE_PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>Angle (optional)</Label>
        <Input
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          placeholder="e.g. Hit them right after their event wraps"
        />
      </div>

      <div>
        <Label>DM body</Label>
        <Textarea
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste the exact DM you'd send. Use [FIRST_NAME] / [SIGNAL] as tokens if you swap anything per-prospect."
        />
        <p className="text-[11px] text-text-muted mt-1">
          {body.length} chars · {body.trim().split(/\s+/).filter(Boolean).length}{" "}
          words
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={makePrimary}
          onChange={(e) => setMakePrimary(e.target.checked)}
          className="accent-primary-500"
        />
        Make this the primary template for{" "}
        {TEMPLATE_PLATFORM_LABELS[platform]}
      </label>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={submit}
          disabled={isPending || !name.trim() || !body.trim()}
        >
          {isPending ? "Saving…" : "Save template"}
        </Button>
      </div>
    </div>
  );
}

function GenerateVariantsForm({
  tenantSlug,
  seed,
  onClose,
  onSave,
}: {
  tenantSlug: string;
  seed?: string;
  onClose: () => void;
  onSave: (input: {
    name: string;
    platform: TemplatePlatform;
    angle: string;
    body: string;
    generatorModel?: string;
    generatorCostUsd?: number;
  }) => Promise<boolean>;
}) {
  const [audience, setAudience] = useState("");
  const [angle, setAngle] = useState("");
  const [platform, setPlatform] = useState<TemplatePlatform>("instagram");
  const [variants, setVariants] = useState<
    Array<{ name: string; angle: string; body: string }>
  >([]);
  const [model, setModel] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenerate] = useTransition();
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const generate = () => {
    if (!audience.trim() || !angle.trim()) return;
    setError(null);
    startGenerate(async () => {
      const res = await generateTemplateVariants(tenantSlug, {
        audience,
        angle,
        platform,
        seedBody: seed,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setVariants(res.variants);
      setModel(res.model);
      setCostUsd(res.costUsd);
    });
  };

  const saveVariant = async (idx: number) => {
    const v = variants[idx];
    if (!v) return;
    setSavingIdx(idx);
    const ok = await onSave({
      name: v.name,
      platform,
      angle: v.angle,
      body: v.body,
      generatorModel: model ?? undefined,
      generatorCostUsd: costUsd / Math.max(1, variants.length),
    });
    setSavingIdx(null);
    if (ok) {
      setVariants((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  return (
    <div className="rounded-xl border border-primary-500/30 bg-primary-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Sparkles size={14} className="text-primary-500" />
          Generate 3 template variants
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-muted hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label>Audience</Label>
          <Input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. Early-stage SaaS founders, B2B focus"
          />
        </div>
        <div>
          <Label>Platform</Label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as TemplatePlatform)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
          >
            {TEMPLATE_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {TEMPLATE_PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>Angle / goal</Label>
        <Textarea
          rows={2}
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          placeholder="e.g. Open by referencing a recent post they made, ask about their biggest challenge with content distribution"
        />
      </div>

      {seed && (
        <p className="text-[11px] text-text-muted">
          Variants will be written to be meaningfully different from your
          current primary template.
        </p>
      )}

      {error && (
        <p className="text-xs text-status-red" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={generate}
          disabled={isGenerating || !audience.trim() || !angle.trim()}
          className="gap-1.5"
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate 3 variants
            </>
          )}
        </Button>
      </div>

      {variants.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/30">
          {variants.map((v, i) => (
            <div
              key={i}
              className="rounded-lg bg-card border border-border p-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <p className="text-sm font-semibold text-foreground">
                  {v.name}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => saveVariant(i)}
                  disabled={savingIdx === i}
                  className="gap-1.5"
                >
                  {savingIdx === i ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Plus size={12} />
                  )}
                  Save this variant
                </Button>
              </div>
              <p className="text-xs text-text-muted mb-2">{v.angle}</p>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {v.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onScore,
  onDelete,
  onUpdate,
}: {
  template: OutboundTemplateRecord;
  onScore: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onUpdate: (patch: {
    body?: string;
    name?: string;
    angle?: string | null;
    templateType?: TemplateType;
    platform?: TemplatePlatform;
  }) => Promise<boolean>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [isScoring, startScore] = useTransition();
  const critique = template.lastCritique;
  const isGlobal = template.isGlobal;

  return (
    <li className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-foreground">{template.name}</h4>
            <span className="text-[10px] uppercase tracking-wide text-text-muted bg-sidebar px-1.5 py-0.5 rounded">
              {TEMPLATE_TYPE_LABELS[template.templateType]}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-text-muted">
              {TEMPLATE_PLATFORM_LABELS[template.platform]}
            </span>
            {isGlobal && (
              <span className="text-[10px] uppercase tracking-wide text-primary-500 bg-primary-500/8 px-1.5 py-0.5 rounded">
                Default
              </span>
            )}
            {template.score != null && (
              <span className={`text-[10px] font-bold ${
                template.score >= 85 ? "text-status-green"
                : template.score >= 70 ? "text-status-yellow"
                : "text-status-red"
              }`}>
                {template.score}/100
              </span>
            )}
          </div>
          {template.angle && (
            <p className="text-xs text-text-muted">{template.angle}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isGlobal && (
            <button
              type="button"
              onClick={() => startScore(onScore)}
              disabled={isScoring}
              className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600 px-2 py-1 rounded-md hover:bg-primary-500/10"
              title="AI score this template"
            >
              {isScoring ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {template.score == null ? "Score" : "Re-score"}
            </button>
          )}
          {!isGlobal && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-2 py-1 rounded-md hover:bg-sidebar"
            >
              <Pencil size={11} />
              Edit
            </button>
          )}
          {!isGlobal && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-md text-text-muted hover:text-status-red hover:bg-status-red/10"
              title="Delete template"
              aria-label="Delete template"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {template.body}
      </p>

      {critique && <CritiquePanel critique={critique} />}

      {/* Edit modal */}
      {editOpen && (
        <EditTemplateModal
          template={template}
          onClose={() => setEditOpen(false)}
          onSave={async (patch) => {
            const ok = await onUpdate(patch);
            if (ok) setEditOpen(false);
          }}
        />
      )}
    </li>
  );
}

function EditTemplateModal({
  template,
  onClose,
  onSave,
}: {
  template: OutboundTemplateRecord;
  onClose: () => void;
  onSave: (patch: {
    name?: string;
    body?: string;
    angle?: string | null;
    templateType?: TemplateType;
    platform?: TemplatePlatform;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(template.name);
  const [templateType, setTemplateType] = useState<TemplateType>(template.templateType);
  const [platform, setPlatform] = useState<TemplatePlatform>(template.platform);
  const [angle, setAngle] = useState(template.angle ?? "");
  const [body, setBody] = useState(template.body);
  const [isSaving, startSave] = useTransition();

  const save = () => {
    startSave(async () => {
      const patch: Parameters<typeof onSave>[0] = {};
      if (name.trim() !== template.name) patch.name = name.trim();
      if (body.trim() !== template.body) patch.body = body.trim();
      if (angle.trim() !== (template.angle ?? "")) patch.angle = angle.trim() || null;
      if (templateType !== template.templateType) patch.templateType = templateType;
      if (platform !== template.platform) patch.platform = platform;
      if (Object.keys(patch).length === 0) { onClose(); return; }
      await onSave(patch);
    });
  };

  return (
    <Dialog open onClose={onClose} locked={isSaving} size="lg">
      <div className="p-5 space-y-4">
        <h3 className="text-base font-semibold text-foreground">Edit template</h3>

        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Event planners cold open" />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>Category</Label>
            <select
              value={templateType}
              onChange={(e) => setTemplateType(e.target.value as TemplateType)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
            >
              {TEMPLATE_TYPES.map((t) => (
                <option key={t} value={t}>{TEMPLATE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="text-[10px] text-text-muted mt-1 leading-tight">
              {TEMPLATE_TYPE_DESCRIPTIONS[templateType]}
            </p>
          </div>
          <div>
            <Label>Platform</Label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as TemplatePlatform)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
            >
              {TEMPLATE_PLATFORMS.map((p) => (
                <option key={p} value={p}>{TEMPLATE_PLATFORM_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label>Angle (optional)</Label>
          <Input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="e.g. Hit them right after their event wraps" />
        </div>

        <div>
          <Label>Message</Label>
          <Textarea
            rows={7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="text-sm leading-relaxed"
            placeholder="Use [FIRST_NAME], [COMPANY], [SIGNAL], [EVENT] as tokens"
          />
          <p className="text-[10px] text-text-muted mt-1">
            {body.length} chars · {body.trim().split(/\s+/).filter(Boolean).length} words
            {body !== template.body && " · Score will be reset on save"}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={isSaving || !name.trim() || !body.trim()}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CritiquePanel({ critique }: { critique: TemplateCritique }) {
  const style = VERDICT_STYLES[critique.verdict];
  return (
    <div className="border-t border-border/30 pt-3 space-y-3">
      <div
        className={`rounded-lg border px-3 py-2 flex items-start gap-2 ${style.cls}`}
      >
        <style.Icon size={14} className="shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] uppercase tracking-wide opacity-80">
            Verdict
          </p>
          <p className="text-sm font-bold">{style.label}</p>
          <p className="text-xs mt-0.5 leading-relaxed">
            {critique.verdict_reason}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        <ScoreTile label="Hook" value={critique.hook_score} />
        <ScoreTile label="Clarity" value={critique.clarity_score} />
        <ScoreTile label="Voice fit" value={critique.voice_fit_score} />
        <ScoreTile label="Platform" value={critique.platform_fit_score} />
        <ScoreTile label="CTA" value={critique.cta_score} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-status-green/20 bg-status-green/5 p-3">
          <h5 className="text-[10px] uppercase tracking-wide text-status-green font-semibold mb-1.5 flex items-center gap-1.5">
            <CheckCircle2 size={11} />
            Strengths
          </h5>
          <ul className="space-y-1">
            {critique.strengths.map((s, i) => (
              <li key={i} className="text-xs text-foreground leading-relaxed">
                • {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-status-red/20 bg-status-red/5 p-3">
          <h5 className="text-[10px] uppercase tracking-wide text-status-red font-semibold mb-1.5 flex items-center gap-1.5">
            <AlertTriangle size={11} />
            Weaknesses
          </h5>
          <ul className="space-y-1">
            {critique.weaknesses.map((w, i) => (
              <li key={i} className="text-xs text-foreground leading-relaxed">
                • {w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {critique.rewrite && (
        <div className="rounded-lg border border-primary-500/30 bg-primary-500/5 p-3">
          <h5 className="text-[10px] uppercase tracking-wide text-primary-500 font-semibold mb-1.5">
            Ready-to-ship rewrite
          </h5>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {critique.rewrite}
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 8 ? "text-status-green" : value >= 6 ? "text-status-yellow" : "text-status-red";
  return (
    <div className="rounded-md border border-border p-2 bg-sidebar/30 text-center">
      <p className="text-[9px] uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p className={`text-sm font-bold mt-0.5 ${tone}`}>
        {value}
        <span className="text-[9px] text-text-muted font-normal">/10</span>
      </p>
    </div>
  );
}
