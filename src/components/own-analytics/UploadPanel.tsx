"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Image as ImageIcon, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uploadCsv, uploadScreenshot } from "@/lib/actions/own-metrics";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

const PLATFORMS: { value: OwnMetricsPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitter", label: "Twitter/X" },
  { value: "linkedin", label: "LinkedIn" },
];

function readAsText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result ?? ""));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result ?? ""));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function UploadPanel({ tenantSlug }: { tenantSlug: string }) {
  const [csvPlatform, setCsvPlatform] = useState<OwnMetricsPlatform>("instagram");
  const [shotPlatform, setShotPlatform] = useState<OwnMetricsPlatform | "">("");
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const csvInputRef = useRef<HTMLInputElement>(null);
  const shotInputRef = useRef<HTMLInputElement>(null);

  const handleCsv = async (file: File) => {
    setStatus({ kind: "idle" });
    const text = await readAsText(file);
    startTransition(async () => {
      const res = await uploadCsv(tenantSlug, csvPlatform, text);
      if (!res.success) {
        setStatus({ kind: "error", message: res.error });
        return;
      }
      const warn = res.unrecognizedHeaders.length
        ? ` (${res.unrecognizedHeaders.length} unrecognized header${res.unrecognizedHeaders.length !== 1 ? "s" : ""} ignored)`
        : "";
      setStatus({
        kind: "success",
        message: `Imported ${res.inserted} row${res.inserted !== 1 ? "s" : ""}${warn}`,
      });
    });
  };

  const handleScreenshot = async (file: File) => {
    setStatus({ kind: "idle" });
    const dataUrl = await readAsDataUrl(file);
    startTransition(async () => {
      const res = await uploadScreenshot(
        tenantSlug,
        (shotPlatform || null) as OwnMetricsPlatform | null,
        dataUrl
      );
      if (!res.success) {
        setStatus({ kind: "error", message: res.error });
        return;
      }
      const summary = Object.entries(res.extracted)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      setStatus({
        kind: "success",
        message: `Saved ${res.platform} metrics — ${summary}`,
      });
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {/* CSV */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} className="text-text-muted" />
            <h3 className="text-foreground font-semibold text-sm">
              Import CSV export
            </h3>
          </div>
          <p className="text-xs text-text-muted mb-4">
            From Meta Business Suite, TikTok Business Suite, or LinkedIn Page
            Analytics. Free on all three.
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="csv-platform">Platform</Label>
              <select
                id="csv-platform"
                value={csvPlatform}
                onChange={(e) =>
                  setCsvPlatform(e.target.value as OwnMetricsPlatform)
                }
                disabled={isPending}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await handleCsv(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => csvInputRef.current?.click()}
              disabled={isPending}
            >
              {isPending ? "Importing..." : "Choose CSV file"}
            </Button>
          </div>
        </div>

        {/* Screenshot */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon size={16} className="text-text-muted" />
            <h3 className="text-foreground font-semibold text-sm">
              Upload screenshot (AI extraction)
            </h3>
          </div>
          <p className="text-xs text-text-muted mb-4">
            For Twitter/X (no CSV export) or one-off posts. AI reads the
            numbers off the image. ~$0.01 per upload.
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="shot-platform">Platform hint (optional)</Label>
              <select
                id="shot-platform"
                value={shotPlatform}
                onChange={(e) =>
                  setShotPlatform(e.target.value as OwnMetricsPlatform | "")
                }
                disabled={isPending}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
              >
                <option value="">Auto-detect</option>
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              ref={shotInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await handleScreenshot(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => shotInputRef.current?.click()}
              disabled={isPending}
            >
              {isPending ? "Analyzing..." : "Choose screenshot"}
            </Button>
          </div>
        </div>
      </div>

      {status.kind === "success" && (
        <div
          role="status"
          className="flex items-start gap-2 p-3 rounded-lg bg-success-1000 border border-success-500/20 text-success-500 text-sm"
        >
          <Check size={16} className="shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </div>
      )}
      {status.kind === "error" && (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
