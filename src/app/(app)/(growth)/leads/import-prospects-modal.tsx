"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Upload, AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importProspects, checkExistingHandles } from "@/lib/actions/import-prospects";
import type { ImportProspectRow, ImportResult } from "@/lib/actions/import-prospects";
import { OUTBOUND_PLATFORMS } from "@/lib/types/outbound";
import type { OutboundPlatform } from "@/lib/types/outbound";

// ── Column field defs ────────────────────────────────────────────────────────

const FIELDS = [
  { key: "handle", label: "Handle / Username", required: true },
  { key: "platform", label: "Platform", required: true },
  { key: "displayName", label: "Display name", required: false },
  { key: "eventTitle", label: "Event title", required: false },
  { key: "category", label: "Category", required: false },
  { key: "location", label: "Location", required: false },
  { key: "phone", label: "Phone number", required: false },
  { key: "bio", label: "Bio", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "profileUrl", label: "Profile URL", required: false },
  { key: "followerCount", label: "Follower count", required: false },
  { key: "lastReachoutDate", label: "Last reachout date", required: false },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

type Step = "drop" | "map" | "preview" | "review" | "done";

interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

// ── Guess which header likely maps to a field ────────────────────────────────

const GUESSES: Record<FieldKey, string[]> = {
  handle: ["handle", "username", "user", "@", "account", "screen_name"],
  platform: ["platform", "network", "social", "channel", "source"],
  displayName: ["organizer", "display", "full name", "fullname", "display_name", "event name"],
  eventTitle: ["event title", "title", "event name"],
  category: ["category", "type", "niche", "genre", "industry"],
  location: ["location", "city", "region", "area", "state"],
  bio: ["bio", "description", "about"],
  notes: ["notes", "note", "comment", "remarks", "memo", "response", "latest response"],
  profileUrl: ["url", "link", "profile url", "profile_url", "profileurl"],
  followerCount: ["followers", "follower", "follower_count", "followers_count"],
  phone: ["phone", "mobile", "telephone", "whatsapp", "contact number", "tel"],
  lastReachoutDate: ["last reachout", "last reach out", "last contact", "last contacted", "reached out", "last outreach", "outreach date"],
};

function guessMapping(headers: string[]): Record<FieldKey, string> {
  const mapping: Partial<Record<FieldKey, string>> = {};
  for (const field of FIELDS) {
    const keywords = GUESSES[field.key];
    const matched = headers.find((h) =>
      keywords.some((kw) => h.toLowerCase().includes(kw))
    );
    if (matched) mapping[field.key] = matched;
  }
  return mapping as Record<FieldKey, string>;
}

// ── CSV parser (handles quoted fields) ───────────────────────────────────────

function parseCSV(text: string): ParsedSheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
}

// ── XLSX parser (dynamic import to avoid SSR issues) ─────────────────────────

async function parseXLSX(buffer: ArrayBuffer): Promise<ParsedSheet> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
  if (!data.length) return { headers: [], rows: [] };
  const headers = (data[0] as string[]).map(String);
  const rows = (data.slice(1) as string[][])
    .filter(r => r.some(cell => String(cell).trim() !== ""))
    .map(r => r.map(String));
  return { headers, rows };
}

// ── Row builder from mapping ─────────────────────────────────────────────────

const PLATFORM_ALIASES: Record<string, OutboundPlatform> = {
  instagram: "instagram", ig: "instagram",
  tiktok: "tiktok", tt: "tiktok",
  twitter: "twitter", x: "twitter",
  linkedin: "linkedin", li: "linkedin",
  manual: "manual", other: "other",
};

function normalisePlatform(raw: string): OutboundPlatform {
  const s = raw.trim().toLowerCase();
  return PLATFORM_ALIASES[s] ?? "manual";
}

function buildRows(
  sheet: ParsedSheet,
  mapping: Record<FieldKey, string>
): { rows: ImportProspectRow[]; errors: string[] } {
  const rows: ImportProspectRow[] = [];
  const errors: string[] = [];
  const idx = (field: FieldKey) => sheet.headers.indexOf(mapping[field] ?? "");

  for (let i = 0; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const rawHandle = (idx("handle") >= 0 ? r[idx("handle")] : "").replace(/^@/, "").trim();
    const rawName = idx("displayName") >= 0 ? r[idx("displayName")].trim() : "";

    // If no handle, fall back to a slug of the display name so name-only rows still import.
    // The user can edit the handle later via the Edit button.
    const handle = rawHandle || rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!handle) { errors.push(`Row ${i + 2}: no handle or name — skipped`); continue; }

    const platformRaw = idx("platform") >= 0 ? r[idx("platform")] : "";
    const platform = normalisePlatform(platformRaw);

    const str = (field: FieldKey) => idx(field) >= 0 ? r[idx(field)]?.trim() || null : null;

    // Parse date string to ISO; returns null if unparseable
    const rawDate = str("lastReachoutDate");
    let lastReachoutAt: string | null = null;
    if (rawDate) {
      const ddmmyyyy = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const d = ddmmyyyy
        ? new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]))
        : new Date(rawDate);
      if (!isNaN(d.getTime())) lastReachoutAt = d.toISOString();
    }

    rows.push({
      handle,
      platform,
      displayName: str("displayName"),
      eventTitle: str("eventTitle"),
      category: str("category"),
      location: str("location"),
      phone: str("phone"),
      bio: str("bio"),
      notes: str("notes"),
      profileUrl: str("profileUrl"),
      followerCount: idx("followerCount") >= 0 ? parseInt(r[idx("followerCount")], 10) || null : null,
      lastReachoutAt,
    });
  }
  return { rows, errors };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImportProspectsModal({
  tenantSlug,
  onClose,
  onImported,
}: {
  tenantSlug: string;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [step, setStep] = useState<Step>("drop");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Duplicate review state: handles that already exist in the DB
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [skippedHandles, setSkippedHandles] = useState<Set<string>>(new Set());
  const [checkingDupes, setCheckingDupes] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setParseError(null);
    try {
      let parsed: ParsedSheet;
      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const text = await file.text();
        parsed = parseCSV(text);
      } else {
        const buf = await file.arrayBuffer();
        parsed = await parseXLSX(buf);
      }
      if (!parsed.headers.length) {
        setParseError("Could not read any columns from the file.");
        return;
      }
      const guessed = guessMapping(parsed.headers);
      setSheet(parsed);
      setMapping(guessed);
      setStep("map");
    } catch {
      setParseError("Failed to parse the file. Make sure it is a valid CSV or Excel file.");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const preview = sheet ? buildRows(sheet, mapping).rows.slice(0, 8) : [];

  const handleGoToReview = async () => {
    if (!sheet) return;
    const { rows } = buildRows(sheet, mapping);
    // Ask the server which handles already exist so the user can review them
    setCheckingDupes(true);
    const existing = await checkExistingHandles(tenantSlug, rows.map((r) => ({ handle: r.handle, platform: r.platform })));
    setCheckingDupes(false);
    const dupeSet = new Set(existing);
    setDuplicates(dupeSet);
    setSkippedHandles(new Set()); // reset any prior skip decisions
    if (dupeSet.size > 0) {
      setStep("review");
    } else {
      // No duplicates — go straight to import
      await runImport(rows);
    }
  };

  const runImport = async (rows: ImportProspectRow[]) => {
    const finalRows = rows.filter((r) => !skippedHandles.has(`${r.handle}:${r.platform}`));
    if (!finalRows.length) {
      setParseError("No rows to import after skipping duplicates.");
      return;
    }
    setImporting(true);
    const res = await importProspects(tenantSlug, finalRows);
    setImporting(false);
    if (!res.success) {
      setParseError(res.error);
      return;
    }
    setResult(res.result);
    setStep("done");
    onImported(res.result.created + res.result.updated);
  };

  const handleImport = async () => {
    if (!sheet) return;
    const { rows, errors: rowErrors } = buildRows(sheet, mapping);
    if (!rows.length) {
      setParseError(`No valid rows to import. ${rowErrors[0] ?? ""}`);
      return;
    }
    await runImport(rows);
  };

  const modal = (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Import prospects"
        className="fixed inset-x-4 top-[10vh] z-50 mx-auto max-w-xl bg-card rounded-2xl border border-border shadow-2xl flex flex-col max-h-[80vh] animate-fade-scale-in"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/60">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Import prospects</h2>
            <p className="text-xs text-text-muted mt-0.5">CSV or Excel (.xlsx/.xls) — one sheet at a time</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="shrink-0 flex gap-1 px-5 py-2.5 border-b border-border/40">
          {(["drop", "map", "preview", "done"] as const).map((s, i) => {
            const ORDER: Step[] = ["drop", "map", "preview", "review", "done"];
            const currentIdx = ORDER.indexOf(step);
            const thisIdx = ORDER.indexOf(s === "preview" && step === "review" ? "review" : s);
            const labels: Record<typeof s, string> = { drop: "Upload", map: "Map columns", preview: "Preview", done: "Done" };
            return (
              <div key={s} className="flex items-center gap-1">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                  step === s || (s === "preview" && step === "review")
                    ? "bg-primary-500 text-white font-medium"
                    : currentIdx > thisIdx
                    ? "bg-status-green/15 text-status-green"
                    : "bg-sidebar text-text-muted"
                }`}>
                  {i + 1}. {labels[s]}
                </span>
                {i < 3 && <ArrowRight size={10} className="text-border" />}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {parseError && (
            <div className="flex items-start gap-2 text-xs text-status-red bg-status-red/5 border border-status-red/20 rounded-lg px-3 py-2">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}

          {/* ── Step: Upload ── */}
          {step === "drop" && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-12 cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary-500 bg-primary-500/5"
                  : "border-border hover:border-primary-500/50 hover:bg-sidebar/40"
              }`}
            >
              <Upload size={28} className="text-text-muted" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Drop your file here</p>
                <p className="text-xs text-text-muted mt-0.5">or click to browse — CSV, XLSX, XLS</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* ── Step: Map columns ── */}
          {step === "map" && sheet && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                Match your sheet&apos;s columns to the right fields. <span className="text-foreground">{sheet.rows.length} rows</span> detected.
              </p>
              <div className="rounded-xl border border-border bg-sidebar/40 divide-y divide-border/40">
                {FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-32 shrink-0">
                      <span className="text-xs font-medium text-foreground">{field.label}</span>
                      {field.required && <span className="text-xs text-status-red ml-1">*</span>}
                    </div>
                    <select
                      value={mapping[field.key] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field.key]: e.target.value }))
                      }
                      className="flex-1 text-xs bg-card border border-border rounded-lg px-2 py-1.5 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
                    >
                      <option value="">— skip —</option>
                      {sheet.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {/* Platform hint */}
              <p className="text-xs text-text-muted">
                Accepted platforms: {OUTBOUND_PLATFORMS.join(", ")}. Unrecognised values default to <code className="text-xs bg-sidebar px-1 rounded">manual</code>.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setStep("drop")}>Back</Button>
                <Button
                  size="sm"
                  onClick={() => setStep("preview")}
                  disabled={!mapping.handle || !mapping.platform}
                >
                  Preview →
                </Button>
              </div>
            </div>
          )}

          {/* ── Step: Preview ── */}
          {step === "preview" && sheet && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                First {preview.length} of {buildRows(sheet, mapping).rows.length} rows. Existing prospects are updated, new ones are created.
              </p>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-sidebar border-b border-border/60">
                      <th className="text-left px-3 py-2 text-text-muted font-medium">Handle</th>
                      <th className="text-left px-3 py-2 text-text-muted font-medium">Platform</th>
                      <th className="text-left px-3 py-2 text-text-muted font-medium">Name</th>
                      <th className="text-left px-3 py-2 text-text-muted font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {preview.map((row, i) => (
                      <tr key={i} className="bg-card hover:bg-sidebar/40">
                        <td className="px-3 py-2 text-foreground font-medium">@{row.handle}</td>
                        <td className="px-3 py-2 text-text-muted">{row.platform}</td>
                        <td className="px-3 py-2 text-text-muted truncate max-w-[120px]">{row.displayName ?? "—"}</td>
                        <td className="px-3 py-2 text-text-muted truncate max-w-[140px]">{row.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setStep("map")}>Back</Button>
                <Button size="sm" onClick={handleGoToReview} disabled={checkingDupes || importing} className="gap-1.5">
                  {checkingDupes && <Loader2 size={12} className="animate-spin" />}
                  Continue → ({buildRows(sheet, mapping).rows.length} rows)
                </Button>
              </div>
            </div>
          )}

          {/* ── Step: Review duplicates ── */}
          {step === "review" && sheet && (() => {
            const allRows = buildRows(sheet, mapping).rows;
            const dupeRows = allRows.filter((r) => duplicates.has(`${r.handle}:${r.platform}`));
            return (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {dupeRows.length} existing {dupeRows.length === 1 ? "lead" : "leads"} found
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    These handles already exist in your pipeline. Choose to update them (refresh their info from the sheet) or skip them.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border/30 max-h-[300px] overflow-y-auto">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 bg-sidebar text-[11px] font-medium text-text-muted sticky top-0">
                    <span>Handle</span>
                    <span className="text-center">Update</span>
                    <span className="text-center">Skip</span>
                  </div>
                  {dupeRows.map((r) => {
                    const key = `${r.handle}:${r.platform}`;
                    const isSkipped = skippedHandles.has(key);
                    return (
                      <div key={key} className={`grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2.5 items-center transition-colors ${isSkipped ? "opacity-50" : ""}`}>
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-foreground">@{r.handle}</span>
                          <span className="text-[10px] text-text-muted ml-2">{r.platform}</span>
                          {r.displayName && <span className="text-[10px] text-text-muted ml-2 truncate block">{r.displayName}</span>}
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => setSkippedHandles(prev => { const n = new Set(prev); n.delete(key); return n; })}
                            className={`w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${!isSkipped ? "bg-status-green/15 border-status-green text-status-green" : "border-border text-text-muted hover:bg-sidebar"}`}
                          >
                            <CheckCircle2 size={13} />
                          </button>
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => setSkippedHandles(prev => { const n = new Set(prev); n.add(key); return n; })}
                            className={`w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${isSkipped ? "bg-primary-500/10 border-primary-500 text-primary-500" : "border-border text-text-muted hover:bg-sidebar"}`}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-text-muted">
                  {dupeRows.length - skippedHandles.size} will be updated · {skippedHandles.size} will be skipped · {allRows.length - dupeRows.length} new
                </p>
                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setStep("preview")}>Back</Button>
                  <Button size="sm" onClick={() => runImport(allRows)} disabled={importing} className="gap-1.5">
                    {importing && <Loader2 size={12} className="animate-spin" />}
                    Import {allRows.length - skippedHandles.size} leads
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* ── Step: Done ── */}
          {step === "done" && result && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={20} className="text-status-green shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Import complete</p>
                  <p className="text-xs text-text-muted">
                    {result.created + result.updated} prospects imported
                    {result.errors.length > 0 && ` · ${result.errors.length} skipped`}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-sidebar/40 divide-y divide-border/40">
                <div className="flex justify-between px-4 py-2.5 text-xs">
                  <span className="text-text-muted">New prospects added</span>
                  <span className="font-semibold text-status-green">{result.created}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5 text-xs">
                  <span className="text-text-muted">Existing prospects updated</span>
                  <span className="font-semibold text-foreground">{result.updated}</span>
                </div>
                {result.errors.length > 0 && (
                  <div className="px-4 py-2.5 text-xs">
                    <p className="text-status-red font-medium mb-1">{result.errors.length} rows skipped (no handle and no name)</p>
                    <ul className="space-y-0.5 text-text-muted">
                      {result.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>Row {e.row} (@{e.handle}): {e.reason}</li>
                      ))}
                      {result.errors.length > 5 && (
                        <li className="text-text-muted">…and {result.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={onClose}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
