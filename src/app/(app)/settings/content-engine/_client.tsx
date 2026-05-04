"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  forkPlatformTemplate,
  setTemplateActive,
  updateTemplate,
  createTenantTemplate,
  deleteTemplate,
} from "@/lib/actions/content-format-templates";
import type { ContentFormatTemplate } from "@/lib/types/content-engine";

const CATEGORY_OPTIONS = [
  "ugc",
  "storytelling",
  "aesthetic",
  "social_proof",
  "product",
] as const;

export function ContentEngineClient({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: ContentFormatTemplate[];
}) {
  const [templates, setTemplates] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAfter = async () => {
    // Server action revalidates; for instant UX we re-render with the
    // current state and rely on the next nav to re-fetch. Keep simple.
  };

  const onToggleActive = (t: ContentFormatTemplate) => {
    setError(null);
    if (t.scope === "platform") {
      // Implicit fork-and-toggle.
      startTransition(async () => {
        const fork = await forkPlatformTemplate(tenantSlug, t.id);
        if (!fork.success) {
          setError(fork.error);
          return;
        }
        const setRes = await setTemplateActive(fork.id, !t.isActive);
        if (!setRes.success) {
          setError(setRes.error);
          return;
        }
        setTemplates((prev) => {
          const next = prev.filter((x) => x.id !== t.id);
          next.push({
            ...t,
            id: fork.id,
            scope: "tenant",
            tenantSlug,
            parentTemplateId: t.id,
            isActive: !t.isActive,
          });
          return next;
        });
        await refreshAfter();
      });
      return;
    }
    startTransition(async () => {
      const res = await setTemplateActive(t.id, !t.isActive);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setTemplates((prev) =>
        prev.map((x) =>
          x.id === t.id ? { ...x, isActive: !t.isActive } : x
        )
      );
    });
  };

  const onCustomize = (t: ContentFormatTemplate) => {
    setError(null);
    startTransition(async () => {
      const res = await forkPlatformTemplate(tenantSlug, t.id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setTemplates((prev) => {
        const next = prev.filter((x) => x.id !== t.id);
        next.push({
          ...t,
          id: res.id,
          scope: "tenant",
          tenantSlug,
          parentTemplateId: t.id,
        });
        return next;
      });
      setOpenId(res.id);
    });
  };

  const onDelete = (t: ContentFormatTemplate) => {
    if (!confirm(`Delete "${t.name}" for this workspace?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteTemplate(t.id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-status-red/10 border border-status-red/30 rounded p-3 text-sm text-status-red">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border/50 text-sm text-foreground hover:bg-card-hover"
        >
          <Plus size={14} />
          New custom format
        </button>
      </div>

      {creating && (
        <NewFormatCard
          tenantSlug={tenantSlug}
          onCancel={() => setCreating(false)}
          onCreated={(t) => {
            setTemplates((prev) => [t, ...prev]);
            setCreating(false);
          }}
        />
      )}

      <ul className="bg-card border border-border rounded-xl divide-y divide-border/40">
        {templates.length === 0 && (
          <li className="p-6 text-sm text-text-muted">
            No formats yet — add one with &ldquo;New custom format&rdquo;.
          </li>
        )}
        {templates.map((t) => {
          const open = openId === t.id;
          return (
            <li key={t.id} className="p-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : t.id)}
                  className="text-text-muted hover:text-foreground mt-0.5"
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">
                      {t.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        t.scope === "platform"
                          ? "bg-border/40 text-text-muted"
                          : "bg-primary-500/10 text-primary-500"
                      }`}
                    >
                      {t.scope === "platform" ? "platform" : "custom"}
                    </span>
                    {t.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-text-muted">
                        {t.category}
                      </span>
                    )}
                    <span className="text-[10px] text-text-muted">
                      {t.durationMin}-{t.durationMax}s · {t.defaultScenes}{" "}
                      scene{t.defaultScenes === 1 ? "" : "s"}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                      {t.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onToggleActive(t)}
                    className={`text-[11px] px-2 py-1 rounded ${
                      t.isActive
                        ? "bg-status-green/10 text-status-green"
                        : "bg-border/40 text-text-muted"
                    }`}
                  >
                    {t.isActive ? "Active" : "Off"}
                  </button>
                  {t.scope === "platform" ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onCustomize(t)}
                      className="text-[11px] px-2 py-1 rounded border border-border/50 text-foreground hover:bg-card-hover"
                    >
                      Customize
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onDelete(t)}
                      className="p-1 rounded text-text-muted hover:text-status-red"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {open && (
                <div className="mt-4 pl-7">
                  {t.scope === "platform" ? (
                    <PlatformReadOnlyView t={t} />
                  ) : (
                    <TenantEditView
                      t={t}
                      onSaved={(updated) =>
                        setTemplates((prev) =>
                          prev.map((x) => (x.id === updated.id ? updated : x))
                        )
                      }
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlatformReadOnlyView({ t }: { t: ContentFormatTemplate }) {
  return (
    <div className="text-xs space-y-2 text-text-secondary">
      <Field label="Description" value={t.description ?? "—"} />
      <Field label="Tone" value={t.tone ?? "—"} />
      <Field label="Structure" value={t.structure.join(" → ") || "—"} />
      <Field label="Example hook" value={t.exampleHook ?? "—"} />
      <p className="text-text-muted italic">
        Click &ldquo;Customize&rdquo; above to fork an editable copy of this format.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-text-muted">{label}: </span>
      <span className="text-foreground">{value}</span>
    </p>
  );
}

function TenantEditView({
  t,
  onSaved,
}: {
  t: ContentFormatTemplate;
  onSaved: (updated: ContentFormatTemplate) => void;
}) {
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description ?? "");
  const [category, setCategory] = useState(t.category ?? "");
  const [tone, setTone] = useState(t.tone ?? "");
  const [structure, setStructure] = useState(t.structure.join(", "));
  const [durationMin, setDurationMin] = useState(t.durationMin);
  const [durationMax, setDurationMax] = useState(t.durationMax);
  const [defaultScenes, setDefaultScenes] = useState(t.defaultScenes);
  const [exampleHook, setExampleHook] = useState(t.exampleHook ?? "");
  const [exampleScript, setExampleScript] = useState(t.exampleScript ?? "");
  const [saving, startSaving] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onSave = () => {
    setErr(null);
    const struct = structure
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    startSaving(async () => {
      const res = await updateTemplate(t.id, {
        name,
        description: description || null,
        category: category || null,
        tone: tone || null,
        structure: struct,
        durationMin: Number(durationMin),
        durationMax: Number(durationMax),
        defaultScenes: Number(defaultScenes),
        exampleHook: exampleHook || null,
        exampleScript: exampleScript || null,
      });
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onSaved({
        ...t,
        name,
        description: description || null,
        category: category || null,
        tone: tone || null,
        structure: struct,
        durationMin: Number(durationMin),
        durationMax: Number(durationMax),
        defaultScenes: Number(defaultScenes),
        exampleHook: exampleHook || null,
        exampleScript: exampleScript || null,
      });
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <Input label="Name" value={name} onChange={setName} />
      <Select
        label="Category"
        value={category}
        onChange={setCategory}
        options={["", ...CATEGORY_OPTIONS]}
      />
      <Textarea
        label="Description"
        value={description}
        onChange={setDescription}
        rows={2}
        full
      />
      <Input label="Tone" value={tone} onChange={setTone} full />
      <Input
        label="Structure (comma-separated beats)"
        value={structure}
        onChange={setStructure}
        full
      />
      <Input
        label="Duration min (s)"
        value={String(durationMin)}
        onChange={(v) => setDurationMin(Number(v) || 0)}
      />
      <Input
        label="Duration max (s)"
        value={String(durationMax)}
        onChange={(v) => setDurationMax(Number(v) || 0)}
      />
      <Input
        label="Default scenes"
        value={String(defaultScenes)}
        onChange={(v) => setDefaultScenes(Number(v) || 1)}
      />
      <Textarea
        label="Example hook"
        value={exampleHook}
        onChange={setExampleHook}
        rows={2}
        full
      />
      <Textarea
        label="Example script"
        value={exampleScript}
        onChange={setExampleScript}
        rows={3}
        full
      />
      {err && (
        <p className="col-span-2 text-status-red text-xs">{err}</p>
      )}
      <div className="col-span-2 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="text-xs px-3 py-1.5 rounded bg-primary-500 text-white disabled:opacity-50 font-medium"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function NewFormatCard({
  tenantSlug,
  onCancel,
  onCreated,
}: {
  tenantSlug: string;
  onCancel: () => void;
  onCreated: (t: ContentFormatTemplate) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [structure, setStructure] = useState("hook, body, payoff");
  const [tone, setTone] = useState("");
  const [durationMin, setDurationMin] = useState(8);
  const [durationMax, setDurationMax] = useState(15);
  const [defaultScenes, setDefaultScenes] = useState(2);
  const [creating, startCreating] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onCreate = () => {
    setErr(null);
    startCreating(async () => {
      const res = await createTenantTemplate(tenantSlug, {
        name,
        description: description || null,
        category: category || null,
        tone: tone || null,
        structure: structure.split(",").map((s) => s.trim()).filter(Boolean),
        durationMin: Number(durationMin),
        durationMax: Number(durationMax),
        defaultScenes: Number(defaultScenes),
      });
      if (!res.success) {
        setErr(res.error);
        return;
      }
      onCreated({
        id: res.id,
        scope: "tenant",
        tenantSlug,
        parentTemplateId: null,
        medium: "video",
        name,
        description: description || null,
        category: category || null,
        durationMin: Number(durationMin),
        durationMax: Number(durationMax),
        structure: structure.split(",").map((s) => s.trim()).filter(Boolean),
        tone: tone || null,
        defaultScenes: Number(defaultScenes),
        exampleHook: null,
        exampleScript: null,
        isActive: true,
        lastGeneratedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  };

  return (
    <div className="bg-card border border-primary-500/40 rounded-xl p-4">
      <p className="text-sm font-semibold text-foreground mb-3">
        New custom format
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Input label="Name" value={name} onChange={setName} />
        <Select
          label="Category"
          value={category}
          onChange={setCategory}
          options={["", ...CATEGORY_OPTIONS]}
        />
        <Textarea
          label="Description"
          value={description}
          onChange={setDescription}
          rows={2}
          full
        />
        <Input label="Tone" value={tone} onChange={setTone} full />
        <Input
          label="Structure (comma-separated)"
          value={structure}
          onChange={setStructure}
          full
        />
        <Input
          label="Duration min (s)"
          value={String(durationMin)}
          onChange={(v) => setDurationMin(Number(v) || 0)}
        />
        <Input
          label="Duration max (s)"
          value={String(durationMax)}
          onChange={(v) => setDurationMax(Number(v) || 0)}
        />
        <Input
          label="Default scenes"
          value={String(defaultScenes)}
          onChange={(v) => setDefaultScenes(Number(v) || 1)}
        />
        {err && <p className="col-span-2 text-status-red">{err}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-border/50 text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={creating || !name.trim()}
            onClick={onCreate}
            className="text-xs px-3 py-1.5 rounded bg-primary-500 text-white disabled:opacity-50 font-medium"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <span className="text-text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border/50 bg-background px-2 py-1.5 text-foreground text-xs"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  rows,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <span className="text-text-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border/50 bg-background px-2 py-1.5 text-foreground text-xs"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border/50 bg-background px-2 py-1.5 text-foreground text-xs"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o || "—"}
          </option>
        ))}
      </select>
    </label>
  );
}
