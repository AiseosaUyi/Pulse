"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  brandPositioningSchema,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";
import { updateBrandPositioning } from "@/lib/actions/brand-positioning";

interface Props {
  tenantSlug: string;
  initial: BrandPositioning | null;
}

const EMPTY: BrandPositioning = {
  mission: "",
  value_proposition: "",
  target_demographics: [{ segment: "", pain_points: [""] }],
  topics_to_cover: [],
  topics_to_avoid: [],
  competitors: [],
  differentiators: [""],
};

export function BrandPositioningEditor({ tenantSlug, initial }: Props) {
  const [state, setState] = useState<BrandPositioning>(initial ?? EMPTY);
  const [topicsCoverText, setTopicsCoverText] = useState(
    (initial?.topics_to_cover ?? []).join("\n")
  );
  const [topicsAvoidText, setTopicsAvoidText] = useState(
    (initial?.topics_to_avoid ?? []).join("\n")
  );
  const [differentiatorsText, setDifferentiatorsText] = useState(
    (initial?.differentiators ?? [""]).join("\n")
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const addDemographic = () =>
    setState((s) => ({
      ...s,
      target_demographics: [
        ...s.target_demographics,
        { segment: "", pain_points: [""] },
      ],
    }));

  const removeDemographic = (idx: number) =>
    setState((s) => ({
      ...s,
      target_demographics: s.target_demographics.filter((_, i) => i !== idx),
    }));

  const addCompetitor = () =>
    setState((s) => ({
      ...s,
      competitors: [
        ...s.competitors,
        { name: "", domain: null, why_we_beat_them: null },
      ],
    }));

  const removeCompetitor = (idx: number) =>
    setState((s) => ({
      ...s,
      competitors: s.competitors.filter((_, i) => i !== idx),
    }));

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const payload: BrandPositioning = {
      ...state,
      topics_to_cover: topicsCoverText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      topics_to_avoid: topicsAvoidText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      differentiators: differentiatorsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      target_demographics: state.target_demographics
        .map((d) => ({
          segment: d.segment.trim(),
          pain_points: d.pain_points.map((p) => p.trim()).filter(Boolean),
        }))
        .filter((d) => d.segment && d.pain_points.length > 0),
      competitors: state.competitors
        .map((c) => ({
          name: c.name.trim(),
          domain: c.domain?.trim() || null,
          why_we_beat_them: c.why_we_beat_them?.trim() || null,
        }))
        .filter((c) => c.name),
    };

    const parsed = brandPositioningSchema.safeParse(payload);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((i) => i.message).join(" · ") ||
          "Validation failed"
      );
      return;
    }
    startTransition(async () => {
      const res = await updateBrandPositioning(tenantSlug, parsed.data);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Mission + Value prop */}
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="bp-mission">Mission</Label>
          <Textarea
            id="bp-mission"
            value={state.mission}
            onChange={(e) =>
              setState((s) => ({ ...s, mission: e.target.value }))
            }
            placeholder="e.g. Make live music discoverable and bookable across West Africa."
            rows={3}
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="bp-value">Value proposition</Label>
          <Textarea
            id="bp-value"
            value={state.value_proposition}
            onChange={(e) =>
              setState((s) => ({ ...s, value_proposition: e.target.value }))
            }
            placeholder="The specific promise you make. What the audience gets that they can't get elsewhere."
            rows={3}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Target demographics */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Target audience</Label>
          <button
            type="button"
            onClick={addDemographic}
            className="text-xs text-primary-500 hover:text-primary-600 inline-flex items-center gap-1"
          >
            <Plus size={12} /> Add segment
          </button>
        </div>
        <div className="space-y-3">
          {state.target_demographics.map((d, idx) => (
            <div key={idx} className="bg-sidebar rounded-xl p-4 border border-border/50">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Input
                    value={d.segment}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        target_demographics: s.target_demographics.map(
                          (x, i) =>
                            i === idx ? { ...x, segment: e.target.value } : x
                        ),
                      }))
                    }
                    placeholder="Segment — e.g. Lagos-based event promoters, 25-40"
                    disabled={isPending}
                  />
                  <Textarea
                    value={d.pain_points.join("\n")}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        target_demographics: s.target_demographics.map(
                          (x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  pain_points: e.target.value.split("\n"),
                                }
                              : x
                        ),
                      }))
                    }
                    placeholder="Pain points (one per line)"
                    rows={3}
                    disabled={isPending}
                  />
                </div>
                {state.target_demographics.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDemographic(idx)}
                    className="text-text-muted hover:text-status-red p-1"
                    aria-label="Remove segment"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Topics */}
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="bp-cover">Topics we cover (one per line)</Label>
          <Textarea
            id="bp-cover"
            value={topicsCoverText}
            onChange={(e) => setTopicsCoverText(e.target.value)}
            placeholder={"Event ticketing\nAfrobeats culture\nConcert logistics\nNightlife reviews"}
            rows={6}
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="bp-avoid">Topics to avoid (one per line)</Label>
          <Textarea
            id="bp-avoid"
            value={topicsAvoidText}
            onChange={(e) => setTopicsAvoidText(e.target.value)}
            placeholder={"Political commentary\nCompetitor bashing\nCrypto speculation"}
            rows={6}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Differentiators */}
      <div>
        <Label htmlFor="bp-diff">What sets us apart (one per line)</Label>
        <Textarea
          id="bp-diff"
          value={differentiatorsText}
          onChange={(e) => setDifferentiatorsText(e.target.value)}
          placeholder={"Only platform with offline ticket pickup across Lagos\nRefund guarantee within 48hrs\nFirst-mover on afrobeats exclusives"}
          rows={5}
          disabled={isPending}
        />
        <p className="text-xs text-text-muted mt-1.5">
          These get named or demonstrated in every blog draft for a content-score
          boost on Brand Alignment.
        </p>
      </div>

      {/* Competitors */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Competitors we benchmark</Label>
          <button
            type="button"
            onClick={addCompetitor}
            className="text-xs text-primary-500 hover:text-primary-600 inline-flex items-center gap-1"
          >
            <Plus size={12} /> Add competitor
          </button>
        </div>
        {state.competitors.length === 0 ? (
          <p className="text-xs text-text-muted">None yet. Add one to give the AI context about who we're fighting for the same audience.</p>
        ) : (
          <div className="space-y-3">
            {state.competitors.map((c, idx) => (
              <div key={idx} className="bg-sidebar rounded-xl p-4 border border-border/50">
                <div className="flex items-start gap-2">
                  <div className="flex-1 grid md:grid-cols-2 gap-3">
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          competitors: s.competitors.map((x, i) =>
                            i === idx ? { ...x, name: e.target.value } : x
                          ),
                        }))
                      }
                      placeholder="Name — e.g. Nairabox"
                      disabled={isPending}
                    />
                    <Input
                      value={c.domain ?? ""}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          competitors: s.competitors.map((x, i) =>
                            i === idx ? { ...x, domain: e.target.value } : x
                          ),
                        }))
                      }
                      placeholder="Domain (optional)"
                      disabled={isPending}
                    />
                    <Textarea
                      className="md:col-span-2"
                      value={c.why_we_beat_them ?? ""}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          competitors: s.competitors.map((x, i) =>
                            i === idx
                              ? { ...x, why_we_beat_them: e.target.value }
                              : x
                          ),
                        }))
                      }
                      placeholder="Why we beat them (optional — feeds positioning in AI content)"
                      rows={2}
                      disabled={isPending}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCompetitor(idx)}
                    className="text-text-muted hover:text-status-red p-1"
                    aria-label="Remove competitor"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save brand positioning"}
        </Button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            Saved ✓
          </span>
        )}
      </div>
    </div>
  );
}
