"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Play,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  createProgrammaticTemplate,
  updateProgrammaticTemplate,
  deleteProgrammaticTemplate,
  generatePagesFromTemplate,
  deleteProgrammaticPage,
  updateProgrammaticPageStatus,
  publishProgrammaticPage,
} from "@/lib/actions/programmatic";
import { useDialogs } from "@/components/ui/Dialog";
import type {
  ProgrammaticTemplateRecord,
  ProgrammaticPageRecord,
  TemplateVariable,
} from "@/lib/types/programmatic";

interface Props {
  tenantSlug: string;
  templates: ProgrammaticTemplateRecord[];
  pages: ProgrammaticPageRecord[];
}

export function ProgrammaticClient({ tenantSlug, templates, pages }: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<ProgrammaticTemplateRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(
    templates[0]?.id ?? null
  );
  const [previewPage, setPreviewPage] = useState<ProgrammaticPageRecord | null>(
    null
  );
  // Publish target for ALL pages on this screen. Defaults to Test (gamma) so a
  // bulk-generated set never lands on live www without an explicit switch.
  const [publishTarget, setPublishTarget] = useState<"test" | "live">("test");

  const pagesByTemplate = useMemo(() => {
    const map = new Map<string, ProgrammaticPageRecord[]>();
    for (const p of pages) {
      const arr = map.get(p.templateId) ?? [];
      arr.push(p);
      map.set(p.templateId, arr);
    }
    return map;
  }, [pages]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-text-muted text-xs">
          {templates.length} template{templates.length === 1 ? "" : "s"} ·{" "}
          {pages.length} page{pages.length === 1 ? "" : "s"} generated
        </p>
        <div className="flex items-center gap-3">
          {/* Publish target for every "Publish to Gruve" button below. */}
          <div
            className="flex items-center gap-1 rounded-lg border border-border bg-sidebar p-0.5"
            role="group"
            aria-label="Publish target"
          >
            {([
              { value: "test", label: "Test (gamma)" },
              { value: "live", label: "Live (www)" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPublishTarget(opt.value)}
                aria-pressed={publishTarget === opt.value}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  publishTarget === opt.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowEditor(true);
            }}
          >
            <Plus size={14} />
            New template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <p className="text-foreground font-semibold mb-1">No templates yet</p>
          <p className="text-text-muted text-sm max-w-[480px] mx-auto">
            Create your first template. Example for events:{" "}
            <code className="font-mono text-xs">{"{eventType} in {city}"}</code>
            {" "}with <code className="font-mono text-xs">city</code>: [New York,
            London] and{" "}
            <code className="font-mono text-xs">eventType</code>: [wedding,
            concert] → 4 landing pages.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const rows = pagesByTemplate.get(t.id) ?? [];
            const expanded = expandedId === t.id;
            const combos = t.variables.reduce(
              (n, v) => n * (v.values.length || 1),
              1
            );
            return (
              <div
                key={t.id}
                className="bg-card rounded-2xl border border-border overflow-hidden"
              >
                <div className="p-5 flex items-start gap-3">
                  <button
                    onClick={() =>
                      setExpandedId((prev) => (prev === t.id ? null : t.id))
                    }
                    className="mt-1 text-text-muted hover:text-foreground"
                    aria-label="Toggle"
                  >
                    {expanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <h3 className="text-foreground font-semibold">
                          {t.name}
                        </h3>
                        <p className="text-primary-500 text-sm mt-0.5 font-mono truncate">
                          {t.titlePattern}
                        </p>
                        <p className="text-text-muted text-xs mt-0.5 font-mono truncate">
                          {t.urlPattern}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <GenerateButton
                          tenantSlug={tenantSlug}
                          templateId={t.id}
                          combos={combos}
                          pageCount={t.pageCount}
                        />
                        <button
                          onClick={() => {
                            setEditing(t);
                            setShowEditor(true);
                          }}
                          className="p-2 rounded text-text-muted hover:text-foreground hover:bg-sidebar transition-colors"
                          aria-label="Edit template"
                        >
                          <Pencil size={14} />
                        </button>
                        <DeleteTemplateButton
                          tenantSlug={tenantSlug}
                          templateId={t.id}
                          pageCount={t.pageCount}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      {t.variables.map((v) => (
                        <div key={v.name} className="flex items-center gap-1.5">
                          <span className="text-text-muted uppercase tracking-wide">
                            {v.name}:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {v.values.map((val) => (
                              <span
                                key={val}
                                className="px-2 py-0.5 rounded-full bg-sidebar border border-border text-foreground"
                              >
                                {val}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <p className="text-text-muted text-xs mt-3">
                      {combos} combination{combos === 1 ? "" : "s"} · {t.pageCount}{" "}
                      generated · ~{t.targetWordCount} words/page
                    </p>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border/30">
                    {rows.length === 0 ? (
                      <p className="text-text-muted text-sm text-center py-8">
                        No pages yet. Tap Generate to create{" "}
                        {combos} page{combos === 1 ? "" : "s"}.
                      </p>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border/30">
                            <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              Title
                            </th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              Slug
                            </th>
                            <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              Status
                            </th>
                            <th className="text-right px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p) => (
                            <tr
                              key={p.id}
                              className="border-b border-border/20 last:border-0"
                            >
                              <td className="px-5 py-2.5 text-sm text-foreground">
                                <button
                                  onClick={() => setPreviewPage(p)}
                                  className="hover:text-primary-500 text-left"
                                >
                                  {p.title}
                                </button>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-text-muted font-mono">
                                /{p.slug}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <StatusToggle
                                  tenantSlug={tenantSlug}
                                  pageId={p.id}
                                  status={p.status}
                                />
                              </td>
                              <td className="px-5 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {p.liveUrl && (
                                    <a
                                      href={p.liveUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] text-primary-500 hover:underline"
                                    >
                                      Live ↗
                                    </a>
                                  )}
                                  <PublishToGruveButton
                                    tenantSlug={tenantSlug}
                                    pageId={p.id}
                                    isLive={Boolean(p.liveUrl)}
                                    target={publishTarget}
                                  />
                                  <DeletePageButton
                                    tenantSlug={tenantSlug}
                                    pageId={p.id}
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showEditor && (
        <TemplateEditorModal
          tenantSlug={tenantSlug}
          editing={editing}
          onClose={() => {
            setShowEditor(false);
            setEditing(null);
          }}
        />
      )}

      {previewPage && (
        <PagePreviewModal
          page={previewPage}
          onClose={() => setPreviewPage(null)}
        />
      )}
    </div>
  );
}

function GenerateButton({
  tenantSlug,
  templateId,
  combos,
  pageCount,
}: {
  tenantSlug: string;
  templateId: string;
  combos: number;
  pageCount: number;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const handle = async () => {
    const skip = pageCount > 0;
    const toMake = skip ? combos - pageCount : combos;
    const count = skip ? toMake : combos;
    const cost = (count * 0.01).toFixed(2);
    const ok = await dialogs.confirm({
      title: `Generate ${count} page${count === 1 ? "" : "s"}?`,
      subtitle: skip
        ? `We'll skip the ${pageCount} pages that already exist. Estimated cost: ~$${cost}.`
        : `Each page uses one AI call. Estimated cost: ~$${cost}.`,
      tone: "default",
      icon: Play,
      confirmLabel: "Generate",
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await generatePagesFromTemplate(tenantSlug, templateId, {
        skipExisting: skip,
      });
      if (!res.success) {
        await dialogs.alert({
          title: "Generation failed",
          subtitle: res.error,
          tone: "destructive",
        });
        return;
      }
      const parts = [`Generated ${res.generated}`];
      if (res.skipped > 0) parts.push(`skipped ${res.skipped}`);
      if (res.failed > 0) parts.push(`failed ${res.failed}`);
      await dialogs.alert({
        title: parts.join(" · "),
        subtitle:
          res.failures.length > 0
            ? `First failure: ${res.failures[0]}`
            : "Pages are ready in the list below.",
        tone: res.failed > 0 ? "warning" : "success",
      });
    });
  };

  return (
    <Button size="sm" onClick={handle} disabled={isPending}>
      <Play size={14} />
      {isPending ? "Generating..." : "Generate"}
    </Button>
  );
}

function DeleteTemplateButton({
  tenantSlug,
  templateId,
  pageCount,
}: {
  tenantSlug: string;
  templateId: string;
  pageCount: number;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={async () => {
        const ok = await dialogs.confirm({
          title: "Delete template?",
          subtitle: `The template and ${pageCount} generated page${
            pageCount === 1 ? "" : "s"
          } will be permanently removed. This can't be undone.`,
          tone: "destructive",
          confirmLabel: "Delete everything",
        });
        if (!ok) return;
        startTransition(async () => {
          const res = await deleteProgrammaticTemplate(tenantSlug, templateId);
          if (!res.success) {
            await dialogs.alert({
              title: "Couldn't delete template",
              subtitle: res.error,
              tone: "destructive",
            });
          }
        });
      }}
      disabled={isPending}
      className="p-2 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
      aria-label="Delete template"
    >
      <Trash2 size={14} />
    </button>
  );
}

function DeletePageButton({
  tenantSlug,
  pageId,
}: {
  tenantSlug: string;
  pageId: string;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={async () => {
        const ok = await dialogs.confirm({
          title: "Delete this page?",
          subtitle:
            "Removed from the programmatic set. You can regenerate from the template anytime.",
          tone: "destructive",
        });
        if (!ok) return;
        startTransition(async () => {
          const res = await deleteProgrammaticPage(tenantSlug, pageId);
          if (!res.success) {
            await dialogs.alert({
              title: "Couldn't delete page",
              subtitle: res.error,
              tone: "destructive",
            });
          }
        });
      }}
      disabled={isPending}
      className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
      aria-label="Delete page"
    >
      <Trash2 size={12} />
    </button>
  );
}

function StatusToggle({
  tenantSlug,
  pageId,
  status,
}: {
  tenantSlug: string;
  pageId: string;
  status: "draft" | "published";
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  const next = status === "draft" ? "published" : "draft";
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const res = await updateProgrammaticPageStatus(
            tenantSlug,
            pageId,
            next
          );
          if (!res.success) {
            await dialogs.alert({
              title: "Couldn't update status",
              subtitle: res.error,
              tone: "destructive",
            });
          }
        })
      }
      disabled={isPending}
      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide transition-colors ${
        status === "published"
          ? "bg-status-green/15 text-status-green hover:bg-status-green/25"
          : "bg-sidebar border border-border text-text-muted hover:text-foreground"
      }`}
    >
      {status}
    </button>
  );
}

function PublishToGruveButton({
  tenantSlug,
  pageId,
  isLive,
  target,
}: {
  tenantSlug: string;
  pageId: string;
  isLive: boolean;
  target: "test" | "live";
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  const dest = target === "test" ? "gamma" : "www";
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const res = await publishProgrammaticPage(tenantSlug, pageId, target);
          if (!res.success) {
            await dialogs.alert({
              title: "Couldn't publish",
              subtitle: res.error,
              tone: "destructive",
            });
            return;
          }
          await dialogs.alert({
            title:
              target === "test"
                ? "Published to gamma (test)"
                : "Published live",
            subtitle: `Live at ${res.liveUrl} — it'll appear in the sitemap and be indexable shortly.`,
          });
        })
      }
      disabled={isPending}
      className="text-[11px] px-2 py-0.5 rounded-full font-medium text-primary-500 border border-primary-500/30 hover:bg-primary-50 disabled:opacity-50"
    >
      {isPending
        ? "Publishing…"
        : isLive
          ? `Re-publish → ${dest}`
          : `Publish → ${dest}`}
    </button>
  );
}

function TemplateEditorModal({
  tenantSlug,
  editing,
  onClose,
}: {
  tenantSlug: string;
  editing: ProgrammaticTemplateRecord | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [titlePattern, setTitlePattern] = useState(editing?.titlePattern ?? "");
  const [urlPattern, setUrlPattern] = useState(editing?.urlPattern ?? "");
  const [metaPattern, setMetaPattern] = useState(
    editing?.metaDescriptionPattern ?? ""
  );
  const [prompt, setPrompt] = useState(editing?.contentPrompt ?? "");
  const [wordCount, setWordCount] = useState(
    editing?.targetWordCount ?? 600
  );
  const [variables, setVariables] = useState<TemplateVariable[]>(
    editing?.variables ?? [{ name: "city", values: ["New York"] }]
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const addVar = () =>
    setVariables((prev) => [...prev, { name: "", values: [""] }]);
  const removeVar = (idx: number) =>
    setVariables((prev) => prev.filter((_, i) => i !== idx));
  const updateVarName = (idx: number, name: string) =>
    setVariables((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, name } : v))
    );
  const updateVarValues = (idx: number, text: string) => {
    const values = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setVariables((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, values } : v))
    );
  };

  const combos = variables.reduce(
    (n, v) => n * (v.values.length || 1),
    1
  );

  const submit = () => {
    setError(null);
    const payload = {
      name,
      titlePattern,
      urlPattern,
      metaDescriptionPattern: metaPattern || null,
      contentPrompt: prompt,
      targetWordCount: wordCount,
      variables,
    };
    startTransition(async () => {
      const res = editing
        ? await updateProgrammaticTemplate(tenantSlug, editing.id, payload)
        : await createProgrammaticTemplate(tenantSlug, payload);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl my-8">
        <div className="flex items-center justify-between p-5 border-b border-border/30">
          <h2 className="text-foreground font-semibold">
            {editing ? "Edit template" : "New programmatic template"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <Label htmlFor="pt-name">Internal name</Label>
            <Input
              id="pt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Events by city"
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="pt-title">
              Title pattern — use{" "}
              <code className="font-mono">{"{varName}"}</code>
            </Label>
            <Input
              id="pt-title"
              value={titlePattern}
              onChange={(e) => setTitlePattern(e.target.value)}
              placeholder="Best {eventType} venues in {city} 2026"
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="pt-url">URL pattern (slug base)</Label>
            <Input
              id="pt-url"
              value={urlPattern}
              onChange={(e) => setUrlPattern(e.target.value)}
              placeholder="events/{city}/{eventType}"
              disabled={isPending}
              className="font-mono text-sm"
            />
          </div>

          <div>
            <Label htmlFor="pt-meta">
              Meta description pattern (optional)
            </Label>
            <Input
              id="pt-meta"
              value={metaPattern ?? ""}
              onChange={(e) => setMetaPattern(e.target.value)}
              placeholder="Planning a {eventType} in {city}? Explore venues, pricing, and booking."
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="pt-prompt">Content brief for AI</Label>
            <Textarea
              id="pt-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Write a guide for planning a {eventType} in {city}. Cover: venue shortlist with 2-3 real examples, typical budget range, booking tips, and one local insight."
              rows={4}
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pt-words">Target word count</Label>
              <Input
                id="pt-words"
                type="number"
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value) || 600)}
                min={200}
                max={3000}
                step={100}
                disabled={isPending}
              />
            </div>
            <div className="flex items-end">
              <p className="text-text-muted text-xs pb-2">
                {combos} page{combos === 1 ? "" : "s"} will be generated
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Variables</Label>
              <button
                type="button"
                onClick={addVar}
                className="text-xs text-primary-500 hover:text-primary-600 flex items-center gap-1"
              >
                <Plus size={12} /> Add variable
              </button>
            </div>
            <div className="space-y-2">
              {variables.map((v, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <Input
                    value={v.name}
                    onChange={(e) => updateVarName(idx, e.target.value)}
                    placeholder="name (e.g. city)"
                    disabled={isPending}
                    className="w-40 font-mono text-sm"
                  />
                  <Input
                    value={v.values.join(", ")}
                    onChange={(e) => updateVarValues(idx, e.target.value)}
                    placeholder="New York, London, Toronto"
                    disabled={isPending}
                    className="flex-1"
                  />
                  {variables.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeVar(idx)}
                      className="p-2 text-text-muted hover:text-red-500"
                      aria-label="Remove"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-text-muted text-xs mt-2">
              Comma-separated values. Variable names must be alphanumeric
              (no spaces/hyphens).
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-border/30">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending
              ? "Saving..."
              : editing
              ? "Save template"
              : "Create template"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PagePreviewModal({
  page,
  onClose,
}: {
  page: ProgrammaticPageRecord;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl border border-border w-full max-w-3xl my-8">
        <div className="flex items-center justify-between p-5 border-b border-border/30">
          <div className="min-w-0 flex-1 mr-3">
            <p className="text-xs text-text-muted uppercase tracking-wide">
              Preview · {page.status}
            </p>
            <h2 className="text-foreground font-semibold truncate">
              {page.title}
            </h2>
            <p className="text-text-muted text-xs font-mono mt-0.5 truncate">
              /{page.slug}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {page.metaDescription && (
            <section>
              <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-1">
                Meta description
              </h4>
              <p className="text-foreground text-sm italic">
                {page.metaDescription}
              </p>
            </section>
          )}

          <section>
            <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2">
              Variables
            </h4>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(page.variables).map(([k, v]) => (
                <span
                  key={k}
                  className="px-2 py-0.5 rounded-full bg-sidebar border border-border text-foreground"
                >
                  <span className="text-text-muted font-mono">{k}:</span> {v}
                </span>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold mb-2 flex items-center gap-1">
              Body
              {page.bodyMd && (
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(page.bodyMd ?? "")
                  }
                  className="ml-auto text-primary-500 hover:text-primary-600 flex items-center gap-1 normal-case tracking-normal"
                >
                  <ExternalLink size={10} /> Copy markdown
                </button>
              )}
            </h4>
            <pre className="bg-sidebar border border-border/30 rounded-lg p-4 text-sm text-foreground whitespace-pre-wrap font-sans max-h-[60vh] overflow-y-auto">
              {page.bodyMd ?? "No body generated."}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
