"use client";

import {
  useEffect,
  useState,
  useTransition,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Sparkles,
  Loader2,
  Calendar,
  ChevronDown,
  Trash2,
  Tag,
  CheckCircle2,
  Clock,
  MessageCircle,
  Pencil,
  AlertCircle,
  Send,
  ExternalLink,
  Check,
  Link as LinkIcon,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils/format";
import {
  loadProspectPanelData,
  analyzeProspectConversation,
  snoozeFollowUp,
  clearFollowUp,
  setFollowUpDate,
} from "@/lib/actions/conversation-intelligence";
import {
  addProspectNote,
  deleteProspectNote,
} from "@/lib/actions/prospect-notes";
import {
  tagProspectCampaign,
  untagProspectCampaign,
  createOutreachCampaign,
} from "@/lib/actions/outreach-campaigns";
import {
  STAGE_LABELS,
  STAGE_COLORS,
  RISK_COLORS,
  OBJECTION_LABELS,
} from "@/lib/types/outreach-intelligence";
import type {
  ThreadEvent,
  ConversationAnalysisRecord,
  OutreachCampaignRecord,
} from "@/lib/types/outreach-intelligence";
import type { ProspectRecord, ProspectStatus } from "@/lib/types/outbound";
import { PLATFORM_LABELS, STATUS_LABELS } from "@/lib/types/outbound";

type PanelTab = "thread" | "analysis" | "notes";

const SNOOZE_OPTIONS = [
  { label: "+3 days", days: 3 },
  { label: "+7 days", days: 7 },
  { label: "+14 days", days: 14 },
];

const NOW_MS = new Date().getTime();

function relativeTime(iso: string): string {
  const diff = NOW_MS - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Campaign tag popover (inline, portal-less for panel context) ─────────────

function CampaignTagsInPanel({
  prospectId,
  tenantSlug,
  campaigns: initialCampaigns,
  taggedIds: initialTaggedIds,
}: {
  prospectId: string;
  tenantSlug: string;
  campaigns: OutreachCampaignRecord[];
  taggedIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [taggedIds, setTaggedIds] = useState(initialTaggedIds);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = campaigns.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  const exactMatch = campaigns.some(
    (c) => c.name.toLowerCase() === query.trim().toLowerCase()
  );

  const toggle = async (campaignId: string) => {
    setBusy(campaignId);
    const isTagged = taggedIds.includes(campaignId);
    if (isTagged) {
      const res = await untagProspectCampaign(prospectId, campaignId);
      if (res.success) setTaggedIds((prev) => prev.filter((id) => id !== campaignId));
    } else {
      const res = await tagProspectCampaign(prospectId, campaignId);
      if (res.success) setTaggedIds((prev) => [...prev, campaignId]);
    }
    setBusy(null);
  };

  const handleCreate = async () => {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    const res = await createOutreachCampaign(tenantSlug, { name });
    if (res.success) {
      const now = new Date().toISOString();
      const newCampaign: OutreachCampaignRecord = {
        id: res.id,
        tenantSlug,
        name,
        description: null,
        business: null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      setCampaigns((prev) => [...prev, newCampaign]);
      // Auto-tag the prospect with the newly created campaign
      await tagProspectCampaign(prospectId, res.id);
      setTaggedIds((prev) => [...prev, res.id]);
      setQuery("");
    }
    setCreating(false);
  };

  const tagged = campaigns.filter((c) => taggedIds.includes(c.id));

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1 items-center">
        {tagged.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-500"
          >
            {c.name}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-1.5 py-0.5 rounded hover:bg-sidebar"
        >
          <Tag size={10} />
          {tagged.length === 0 ? "Add campaign" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-xl border border-border bg-card shadow-lg">
          <div className="p-2 border-b border-border/50">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campaigns…"
              className="w-full text-xs bg-transparent outline-none text-foreground placeholder:text-text-muted"
            />
          </div>
          <ul className="max-h-40 overflow-y-auto py-1">
            {filtered.map((c) => {
              const isTagged = taggedIds.includes(c.id);
              const isBusy = busy === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    disabled={isBusy}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-sidebar text-left"
                  >
                    {isBusy ? (
                      <Loader2 size={11} className="animate-spin text-text-muted" />
                    ) : (
                      <span
                        className={`h-3 w-3 rounded-sm border flex items-center justify-center ${
                          isTagged
                            ? "bg-primary-500 border-primary-500"
                            : "border-border"
                        }`}
                      >
                        {isTagged && (
                          <CheckCircle2 size={8} className="text-white" />
                        )}
                      </span>
                    )}
                    <span className="text-foreground">{c.name}</span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-muted">No campaigns</li>
            )}
          </ul>
          {query.trim() && !exactMatch && (
            <div className="border-t border-border/50 p-1">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-500 hover:bg-sidebar rounded"
              >
                {creating ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <span>+</span>
                )}
                Create &ldquo;{query.trim()}&rdquo;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thread event card ────────────────────────────────────────────────────────

function ThreadEventCard({
  event,
  onDeleteNote,
}: {
  event: ThreadEvent;
  onDeleteNote: (noteId: string) => void;
}) {
  const [deleting, startDelete] = useTransition();

  if (event.type === "outbound_dm") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary-500/10 rounded-2xl rounded-tr-sm px-3 py-2">
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {event.dmBody}
          </p>
          <div className="flex items-center gap-2 mt-1 justify-end">
            <span className="text-xs text-text-muted">
              {relativeTime(event.createdAt)}
            </span>
            {event.dmVersion && event.dmVersion > 1 && (
              <span className="text-xs text-text-muted">
                v{event.dmVersion}
              </span>
            )}
            <span className="text-xs text-text-muted capitalize">
              {event.dmStatus}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "inbound_message") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] bg-sidebar rounded-2xl rounded-tl-sm px-3 py-2">
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {event.messageBody}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {relativeTime(event.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  if (event.type === "note") {
    return (
      <div className="flex items-start gap-2 py-1">
        <div className="flex-1 border-l-2 border-border/60 pl-3">
          <p className="text-xs text-text-muted italic leading-relaxed">
            {event.noteBody}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {formatDateTime(event.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            startDelete(async () => {
              const res = await deleteProspectNote(event.id);
              if (res.success) onDeleteNote(event.id);
            })
          }
          disabled={deleting}
          className="p-1 text-text-muted hover:text-status-red hover:bg-status-red/10 rounded mt-0.5 shrink-0"
        >
          {deleting ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Trash2 size={10} />
          )}
        </button>
      </div>
    );
  }

  if (event.type === "analysis" && event.analysis) {
    const a = event.analysis;
    return (
      <div className="rounded-xl border border-primary-500/20 bg-primary-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={12} className="text-primary-500 shrink-0" />
          <span className="text-xs uppercase tracking-wide text-primary-500 font-semibold">
            AI Analysis
          </span>
          <span className="text-xs text-text-muted ml-auto">
            {relativeTime(event.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs uppercase tracking-wide px-1.5 py-0.5 rounded ${STAGE_COLORS[a.conversationStage]}`}
          >
            {STAGE_LABELS[a.conversationStage]}
          </span>
          <span
            className={`text-xs font-medium ${RISK_COLORS[a.riskLevel]}`}
          >
            {a.riskLevel} risk
          </span>
          {a.objectionDetected && a.objectionCategory && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-status-yellow/10 text-status-yellow">
              {OBJECTION_LABELS[a.objectionCategory]}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground leading-relaxed">{a.intentSummary}</p>
        {a.recommendedFollowUpAt && a.recommendedFollowUpNote && (
          <div className="flex items-start gap-1.5 text-[11px] text-text-muted pt-1 border-t border-primary-500/10">
            <Calendar size={11} className="mt-0.5 shrink-0 text-primary-500" />
            <span>
              Follow-up{" "}
              <span className="text-foreground">
                {formatDateTime(a.recommendedFollowUpAt)}
              </span>
              {" · "}
              {a.recommendedFollowUpNote}
            </span>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Analysis tab (latest analysis detail) ───────────────────────────────────

function AnalysisTab({
  analysis,
}: {
  analysis: ConversationAnalysisRecord | null;
}) {
  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <Sparkles size={28} className="text-text-muted" />
        <p className="text-sm font-medium text-foreground">No analysis yet</p>
        <p className="text-xs text-text-muted text-center max-w-[240px]">
          Use &ldquo;Analyze conversation&rdquo; to let AI assess this thread
          and recommend a follow-up date.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_COLORS[analysis.conversationStage]}`}
        >
          {STAGE_LABELS[analysis.conversationStage]}
        </span>
        <span className={`text-xs font-semibold ${RISK_COLORS[analysis.riskLevel]}`}>
          {analysis.riskLevel} risk
        </span>
        {analysis.objectionDetected && analysis.objectionCategory && (
          <span className="text-xs px-2 py-0.5 rounded bg-status-yellow/10 text-status-yellow">
            {OBJECTION_LABELS[analysis.objectionCategory]}
          </span>
        )}
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-text-muted mb-1">
          AI Summary
        </p>
        <p className="text-sm text-foreground leading-relaxed">
          {analysis.intentSummary}
        </p>
      </div>

      {analysis.recommendedFollowUpAt && (
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs uppercase tracking-wide text-text-muted mb-1">
            Recommended follow-up
          </p>
          <div className="flex items-center gap-1.5 text-sm text-foreground">
            <Calendar size={13} className="text-primary-500 shrink-0" />
            {formatDateTime(analysis.recommendedFollowUpAt)}
            {analysis.recommendedWaitDays != null && (
              <span className="text-text-muted">
                (+{analysis.recommendedWaitDays}d)
              </span>
            )}
          </div>
          {analysis.recommendedFollowUpNote && (
            <p className="text-xs text-text-muted mt-1">
              {analysis.recommendedFollowUpNote}
            </p>
          )}
        </div>
      )}

      {(analysis.gruveRelevant || analysis.sippoyRelevant) && (
        <div className="flex gap-2 flex-wrap">
          {analysis.gruveRelevant && (
            <span className="text-xs px-2 py-0.5 rounded bg-primary-500/10 text-primary-500">
              Gruve relevant
            </span>
          )}
          {analysis.sippoyRelevant && (
            <span className="text-xs px-2 py-0.5 rounded bg-primary-500/10 text-primary-500">
              Sippoy relevant
            </span>
          )}
        </div>
      )}

      <p className="text-xs text-text-muted">
        Analyzed {formatDateTime(analysis.createdAt)}
      </p>
    </div>
  );
}

// ── Follow-up controls ───────────────────────────────────────────────────────

function FollowUpControls({
  tenantSlug,
  prospectId,
  followUpAt,
  followUpNote,
  onChanged,
}: {
  tenantSlug: string;
  prospectId: string;
  followUpAt: string | null;
  followUpNote: string | null;
  onChanged: (followUpAt: string | null, followUpNote: string | null) => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snoozeOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSnoozeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [snoozeOpen]);

  const handleSnooze = (days: number) => {
    setSnoozeOpen(false);
    startTransition(async () => {
      const newDate = new Date();
      newDate.setDate(newDate.getDate() + days);
      const res = await snoozeFollowUp(tenantSlug, prospectId, days);
      if (res.success) onChanged(newDate.toISOString(), followUpNote);
    });
  };

  const handlePickDate = () => {
    if (!customDate) return;
    setDatePickerOpen(false);
    startTransition(async () => {
      const d = new Date(customDate);
      const res = await setFollowUpDate(tenantSlug, prospectId, d);
      if (res.success) onChanged(d.toISOString(), followUpNote);
    });
  };

  const handleClear = () => {
    startTransition(async () => {
      const res = await clearFollowUp(tenantSlug, prospectId);
      if (res.success) onChanged(null, null);
    });
  };

  if (!followUpAt) {
    return (
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setSnoozeOpen((v) => !v)}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-2 py-1 rounded hover:bg-sidebar border border-border/60"
        >
          {isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Calendar size={11} />
          )}
          Set follow-up
          <ChevronDown size={10} />
        </button>
        {snoozeOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 w-44 rounded-lg border border-border bg-card shadow-lg py-1 animate-popover-in">
            {SNOOZE_OPTIONS.map((o) => (
              <button
                key={o.days}
                type="button"
                onClick={() => handleSnooze(o.days)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-sidebar text-foreground"
              >
                {o.label}
              </button>
            ))}
            <div className="border-t border-border/50 p-1">
              <button
                type="button"
                onClick={() => {
                  setSnoozeOpen(false);
                  setDatePickerOpen(true);
                }}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-sidebar text-foreground rounded"
              >
                Pick date…
              </button>
            </div>
          </div>
        )}
        {datePickerOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-card shadow-lg p-3 space-y-2">
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDatePickerOpen(false)}
                className="text-xs text-text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePickDate}
                disabled={!customDate}
                className="text-xs text-primary-500 hover:text-primary-600 font-medium disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isOverdue = new Date(followUpAt) < new Date();

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1.5 flex-wrap">
      <div
        className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border ${
          isOverdue
            ? "bg-status-red/10 text-status-red border-status-red/30"
            : "bg-primary-500/10 text-primary-500 border-primary-500/20"
        }`}
      >
        <Calendar size={11} />
        {formatDateTime(followUpAt)}
      </div>
      {followUpNote && (
        <span className="text-[11px] text-text-muted">{followUpNote}</span>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setSnoozeOpen((v) => !v)}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-1.5 py-1 rounded hover:bg-sidebar"
        >
          {isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <>
              <Clock size={11} />
              Snooze
              <ChevronDown size={9} />
            </>
          )}
        </button>
        {snoozeOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 w-44 rounded-lg border border-border bg-card shadow-lg py-1 animate-popover-in">
            {SNOOZE_OPTIONS.map((o) => (
              <button
                key={o.days}
                type="button"
                onClick={() => handleSnooze(o.days)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-sidebar text-foreground"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleClear}
        disabled={isPending}
        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-status-green hover:bg-status-green/10 px-1.5 py-1 rounded"
      >
        <CheckCircle2 size={11} />
        Done
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function platformProfileUrl(prospect: ProspectRecord): string {
  if (prospect.profileUrl) return prospect.profileUrl;
  const h = prospect.handle;
  switch (prospect.platform) {
    case "instagram": return `https://www.instagram.com/${h}/`;
    case "tiktok": return `https://www.tiktok.com/@${h}`;
    case "twitter": return `https://twitter.com/${h}`;
    case "linkedin": return `https://www.linkedin.com/in/${h}/`;
    default: return "";
  }
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function ProspectThreadPanel({
  prospect,
  tenantSlug,
  campaigns,
  onClose,
  onQualify,
  onDraft,
  onStatusChange,
  onDelete,
  onEdit,
}: {
  prospect: ProspectRecord;
  tenantSlug: string;
  campaigns: OutreachCampaignRecord[];
  onClose: () => void;
  onQualify?: (p: ProspectRecord) => void;
  onDraft?: (p: ProspectRecord) => void;
  onStatusChange?: (p: ProspectRecord, status: ProspectStatus) => void;
  onDelete?: (p: ProspectRecord) => void;
  onEdit?: (p: ProspectRecord) => void;
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>("thread");
  // null = not yet loaded (loading); [] = loaded and empty
  const [thread, setThread] = useState<ThreadEvent[] | null>(null);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [latestAnalysis, setLatestAnalysis] =
    useState<ConversationAnalysisRecord | null>(null);
  const [followUpAt, setFollowUpAt] = useState<string | null>(null);
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);
  const [analyzing, startAnalyzing] = useTransition();
  const [noteBody, setNoteBody] = useState("");
  const [addingNote, startAddNote] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const profileUrl = platformProfileUrl(prospect);

  const copyReplyLink = async () => {
    const url = `${window.location.origin}/leads?prospect=${prospect.id}&action=reply`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("reply");
      setTimeout(() => setCopied((c) => (c === "reply" ? null : c)), 1500);
    } catch {}
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    loadProspectPanelData(tenantSlug, prospect.id).then((res) => {
      if (!res.success) {
        setThread([]);
        return;
      }
      setThread(res.thread);
      setCampaignIds(res.campaignIds);
      setLatestAnalysis(res.latestAnalysis);
      setFollowUpAt(res.followUpAt);
      setFollowUpNote(res.followUpNote);
    });
  }, [tenantSlug, prospect.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Scroll thread to bottom when data first arrives
  useEffect(() => {
    if (thread !== null && activeTab === "thread" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread, activeTab]);

  // Keyboard close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleAnalyze = () => {
    setError(null);
    startAnalyzing(async () => {
      const res = await analyzeProspectConversation(
        tenantSlug,
        prospect.id,
        "manual"
      );
      if (!res.success) {
        setError(res.error);
        return;
      }
      setLatestAnalysis(res.analysis);
      // Reload thread to include the new analysis event
      loadProspectPanelData(tenantSlug, prospect.id).then((refreshed) => {
        if (refreshed.success) {
          setThread(refreshed.thread);
          setFollowUpAt(refreshed.followUpAt);
          setFollowUpNote(refreshed.followUpNote);
        }
      });
      setActiveTab("analysis");
    });
  };

  const handleAddNote = () => {
    if (!noteBody.trim()) return;
    setError(null);
    startAddNote(async () => {
      const res = await addProspectNote(tenantSlug, prospect.id, noteBody);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setNoteBody("");
      // Optimistically add note to thread
      setThread((prev) => [
        ...(prev ?? []),
        {
          id: res.id,
          type: "note" as const,
          createdAt: new Date().toISOString(),
          noteBody: noteBody.trim(),
        },
      ]);
    });
  };

  const handleDeleteNote = (noteId: string) => {
    setThread((prev) => (prev ?? []).filter((e) => e.id !== noteId));
  };

  const loadedThread = thread ?? [];
  const noteCount = loadedThread.filter((e) => e.type === "note").length;

  const panel = (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label={`Prospect thread: @${prospect.handle}`}
        className="fixed right-0 inset-y-0 z-50 w-full sm:w-[560px] bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right"
      >
        {/* Sticky header */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">
                @{prospect.handle}
              </h2>
              <span className="text-xs uppercase tracking-wide text-text-muted shrink-0">
                {PLATFORM_LABELS[prospect.platform]}
              </span>
              <span className="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-sidebar text-text-muted shrink-0">
                {STATUS_LABELS[prospect.status]}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground shrink-0"
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>

          {prospect.displayName && (
            <p className="text-xs text-text-muted">{prospect.displayName}</p>
          )}

          {/* Phone number */}
          {prospect.phone && (
            <a
              href={`tel:${prospect.phone}`}
              className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-primary-500"
            >
              <Phone size={11} />
              {prospect.phone}
            </a>
          )}

          {/* Profile links */}
          <div className="flex items-center gap-3 flex-wrap">
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600"
              >
                Open profile <ExternalLink size={11} />
              </a>
            )}
            <button
              type="button"
              onClick={copyReplyLink}
              className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground"
            >
              {copied === "reply" ? (
                <Check size={11} className="text-status-green" />
              ) : (
                <LinkIcon size={11} />
              )}
              {copied === "reply" ? "Copied" : "Copy reply link"}
            </button>
          </div>

          {/* Primary action row */}
          {(onQualify || onDraft || onEdit || onDelete) && (
            <div className="flex items-center gap-2 flex-wrap">
              {(prospect.status === "new" || prospect.status === "qualifying") && onQualify && (
                <Button size="sm" onClick={() => onQualify(prospect)} className="gap-1.5">
                  <Sparkles size={13} />
                  AI qualify
                </Button>
              )}
              {prospect.status === "qualified" && onDraft && (
                <Button size="sm" onClick={() => onDraft(prospect)} className="gap-1.5">
                  <Send size={13} />
                  Draft DM
                </Button>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(prospect)}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-sidebar border border-border/60"
                >
                  <Pencil size={12} />
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(prospect)}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-status-red px-2 py-1.5 rounded-lg hover:bg-status-red/10 border border-border/60"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Meta row: stage + risk + follow-up */}
          <div className="flex items-center gap-2 flex-wrap">
            {latestAnalysis && (
              <>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${STAGE_COLORS[latestAnalysis.conversationStage]}`}
                >
                  {STAGE_LABELS[latestAnalysis.conversationStage]}
                </span>
                <span
                  className={`text-xs font-medium ${RISK_COLORS[latestAnalysis.riskLevel]}`}
                >
                  {latestAnalysis.riskLevel} risk
                </span>
              </>
            )}
            <FollowUpControls
              tenantSlug={tenantSlug}
              prospectId={prospect.id}
              followUpAt={followUpAt}
              followUpNote={followUpNote}
              onChanged={(fu, fn) => {
                setFollowUpAt(fu);
                setFollowUpNote(fn);
              }}
            />
          </div>

          {/* Campaign tags */}
          <CampaignTagsInPanel
            prospectId={prospect.id}
            tenantSlug={tenantSlug}
            campaigns={campaigns}
            taggedIds={campaignIds}
          />
        </div>

        {/* Tab nav */}
        <div className="shrink-0 flex border-b border-border/60 px-4">
          {(
            [
              { key: "thread" as const, label: "Thread", count: loadedThread.length },
              { key: "analysis" as const, label: "Analysis", count: null },
              { key: "notes" as const, label: "Notes", count: noteCount || null },
            ] satisfies Array<{ key: PanelTab; label: string; count: number | null }>
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`px-3 py-2.5 text-xs -mb-px border-b-2 transition-colors ${
                activeTab === t.key
                  ? "border-primary-500 text-foreground font-medium"
                  : "border-transparent text-text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="ml-1 text-xs px-1.5 rounded-full bg-sidebar">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {thread === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-text-muted justify-center">
              <Loader2 size={16} className="animate-spin" />
              Loading thread…
            </div>
          ) : (
            <>
              {activeTab === "thread" && (
                <div className="space-y-3" role="feed">
                  {loadedThread.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <MessageCircle size={24} className="text-text-muted" />
                      <p className="text-sm font-medium text-foreground">
                        No messages yet
                      </p>
                      <p className="text-xs text-text-muted text-center max-w-[200px]">
                        DMs, replies, notes and AI analysis will appear here.
                      </p>
                    </div>
                  )}
                  {analyzing && (
                    <div className="flex items-center gap-2 py-2 text-sm text-text-muted">
                      <Loader2 size={14} className="animate-spin text-primary-500" />
                      Analyzing conversation…
                    </div>
                  )}
                  {loadedThread.map((event) => (
                    <ThreadEventCard
                      key={event.id}
                      event={event}
                      onDeleteNote={handleDeleteNote}
                    />
                  ))}
                </div>
              )}

              {activeTab === "analysis" && (
                <AnalysisTab analysis={latestAnalysis} />
              )}

              {activeTab === "notes" && (
                <div className="space-y-2">
                  {thread.filter((e) => e.type === "note").length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <Pencil size={22} className="text-text-muted" />
                      <p className="text-sm font-medium text-foreground">
                        No notes yet
                      </p>
                      <p className="text-xs text-text-muted">
                        Add a note below.
                      </p>
                    </div>
                  )}
                  {loadedThread
                    .filter((e) => e.type === "note")
                    .map((event) => (
                      <ThreadEventCard
                        key={event.id}
                        event={event}
                        onDeleteNote={handleDeleteNote}
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky action bar */}
        <div className="shrink-0 border-t border-border/60 px-4 py-3 space-y-2">
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-status-red">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <Textarea
              rows={2}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote();
              }}
              placeholder="Add a note… (⌘↵ to save)"
              className="flex-1 text-sm resize-none"
            />
            <div className="flex flex-col gap-1.5">
              <Button
                size="sm"
                onClick={handleAddNote}
                disabled={addingNote || !noteBody.trim()}
                className="gap-1.5"
              >
                {addingNote ? <Loader2 size={12} className="animate-spin" /> : null}
                Note
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleAnalyze}
                disabled={analyzing}
                className="gap-1.5"
                title="AI analyzes the conversation and auto-sets a follow-up date"
              >
                {analyzing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                Analyze
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // Portal-render outside the scrollable list
  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}
