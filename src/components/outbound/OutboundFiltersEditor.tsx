"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOutboundFilters } from "@/lib/actions/outbound-filters";
import type { OutboundFilters } from "@/lib/types/outbound-filters";

interface Props {
  tenantSlug: string;
  initialFilters: OutboundFilters;
}

interface GeoFormRow {
  country: string;
  statesRaw: string;
}

function geoToForm(scope: OutboundFilters["geoScope"]): GeoFormRow[] {
  return scope.length > 0
    ? scope.map((g) => ({ country: g.country, statesRaw: g.states.join("\n") }))
    : [{ country: "", statesRaw: "" }];
}

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clampDwell(value: number): number {
  if (!Number.isFinite(value)) return 1200;
  return Math.max(400, Math.min(5000, Math.round(value)));
}

export function OutboundFiltersEditor({ tenantSlug, initialFilters }: Props) {
  const [keywords, setKeywords] = useState(
    initialFilters.keywords.join("\n")
  );
  const [competitors, setCompetitors] = useState(
    initialFilters.competitorUrls.join("\n")
  );
  const [geo, setGeo] = useState<GeoFormRow[]>(() =>
    geoToForm(initialFilters.geoScope)
  );
  const [passiveEnabled, setPassiveEnabled] = useState(
    initialFilters.passiveCaptureEnabled
  );
  const [dwellMs, setDwellMs] = useState<number>(initialFilters.dwellMs);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateGeoRow = (index: number, patch: Partial<GeoFormRow>) => {
    setGeo((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };
  const addGeoRow = () =>
    setGeo((prev) => [...prev, { country: "", statesRaw: "" }]);
  const removeGeoRow = (index: number) =>
    setGeo((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
    );

  const handleSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const geoScope = geo
        .map((row) => ({
          country: row.country.trim(),
          states: parseList(row.statesRaw),
        }))
        .filter((g) => g.country.length > 0);
      const res = await updateOutboundFilters(tenantSlug, {
        keywords: parseList(keywords),
        competitorUrls: parseList(competitors),
        geoScope,
        passiveCaptureEnabled: passiveEnabled,
        dwellMs: clampDwell(dwellMs),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <Label htmlFor="obf-keywords">
          Event-intent keywords (one per line)
        </Label>
        <Textarea
          id="obf-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder={"wedding\nengaged\nrave\nbeach party"}
          rows={8}
          disabled={isPending}
          className="font-mono text-sm mt-1.5"
        />
        <p className="text-xs text-text-muted mt-1.5">
          Words we look for in captions, comments, and bios when deciding
          whether a captured account is a real buyer signal. More specific
          wins.
        </p>
      </div>

      <div>
        <Label>Geographic scope</Label>
        <p className="text-xs text-text-muted mt-1 mb-3">
          Captures outside these regions are penalized by the qualifier.
          Add states per country, one per line.
        </p>
        <div className="space-y-3">
          {geo.map((row, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-background p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={row.country}
                  onChange={(e) =>
                    updateGeoRow(i, { country: e.target.value })
                  }
                  placeholder="Country (e.g. United States)"
                  disabled={isPending}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeGeoRow(i)}
                  disabled={isPending || geo.length <= 1}
                  aria-label="Remove country"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <Textarea
                value={row.statesRaw}
                onChange={(e) =>
                  updateGeoRow(i, { statesRaw: e.target.value })
                }
                placeholder={"New York\nCalifornia\nTexas"}
                rows={4}
                disabled={isPending}
                className="font-mono text-xs"
              />
            </div>
          ))}
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={addGeoRow}
            disabled={isPending}
          >
            <Plus size={14} /> Add country
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="obf-competitors">
          Competitor event platforms (one per line)
        </Label>
        <Textarea
          id="obf-competitors"
          value={competitors}
          onChange={(e) => setCompetitors(e.target.value)}
          placeholder={"tix.africa\neventbrite.com\nluma.com"}
          rows={6}
          disabled={isPending}
          className="font-mono text-sm mt-1.5"
        />
        <p className="text-xs text-text-muted mt-1.5">
          Domain only — no https:// prefix. If a prospect&apos;s bio or
          caption references one of these, the qualifier flags it as a
          poach opportunity.
        </p>
      </div>

      <div className="pt-2 border-t border-border">
        <div className="flex items-start gap-3">
          <input
            id="obf-passive"
            type="checkbox"
            checked={passiveEnabled}
            onChange={(e) => setPassiveEnabled(e.target.checked)}
            disabled={isPending}
            className="mt-1"
          />
          <div className="flex-1">
            <Label htmlFor="obf-passive" className="cursor-pointer">
              Passive capture enabled
            </Label>
            <p className="text-xs text-text-muted mt-0.5">
              When on, the extension quietly captures post authors,
              commenters, and tagged people you naturally view on
              Instagram. No auto-scrolling, no automation. Each device
              can locally disable further.
            </p>
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="obf-dwell">Viewport dwell before capture (ms)</Label>
        <Input
          id="obf-dwell"
          type="number"
          min={400}
          max={5000}
          step={100}
          value={dwellMs}
          onChange={(e) => setDwellMs(clampDwell(Number(e.target.value)))}
          disabled={isPending}
          className="mt-1.5 w-32"
        />
        <p className="text-xs text-text-muted mt-1.5">
          How long a post or comment must be visibly in your viewport
          before it&apos;s considered intentionally viewed. Default
          1200ms. Higher = stricter, fewer false positives.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save filters"}
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
