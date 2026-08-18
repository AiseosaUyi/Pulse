"use client";

import { useEffect, useMemo, useState, useTransition, useCallback } from "react";
import { formatDateTime } from "@/lib/utils/format";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Sparkles,
  Loader2,
  Send,
  Check,
  MessageCircle,
  ExternalLink,
  Trash2,
  RefreshCw,
  Mail,
  Copy,
  Link as LinkIcon,
  MessagesSquare,
  Upload,
  Pencil,
  CheckSquare,
  Square,
  X,
  Calendar,
  MapPin,
  Tag,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, useDialogs } from "@/components/ui/Dialog";
import {
  bulkQualifyNewProspects,
  bulkDeleteProspects,
  bulkUpdateProspectStatus,
  fetchProspectsPage,
  createProspect,
  deleteProspect,
  draftProspectDm,
  qualifyProspect,
  recordInboundReply,
  updateOutboundDm,
  updateProspectStatus,
  markInboundRead,
  updateProspect as updateProspectAction,
} from "@/lib/actions/outbound";
import {
  createProspectSearch,
  deleteProspectSearch,
  runProspectSearchNow,
  updateProspectSearch,
} from "@/lib/actions/prospect-searches";
import {
  OUTBOUND_PLATFORMS,
  PLATFORM_LABELS,
  PROSPECT_QUALITIES,
  QUALITY_LABELS,
  SIGNAL_LABELS,
  SIGNAL_TYPES,
  STATUS_LABELS,
  isUnresolvedProspectHandle,
  type InboundMessageRecord,
  type OutboundDmRecord,
  type OutboundPlatform,
  type ProspectQuality,
  type SignalType,
  type ProspectRecord,
  type ProspectSearchRecord,
  type ProspectStatus,
} from "@/lib/types/outbound";
import { TemplatesView } from "./templates-view";
import { resolvePrimaryTemplate } from "@/lib/actions/outbound-templates";
import type {
  OutboundTemplateRecord,
  TemplatePlatform,
} from "@/lib/types/outbound-templates";
import { ProspectThreadPanel } from "./prospect-thread-panel";
import { TodayView } from "./today-view";
import { ImportProspectsModal } from "./import-prospects-modal";
import { EditProspectModal } from "./edit-prospect-modal";
import type { OutreachTodayData } from "@/lib/services/outreach-intelligence";
import type { OutreachCampaignRecord } from "@/lib/types/outreach-intelligence";
import type { EventScraperRunRecord } from "@/lib/types/event-scraper";
import {
  EventPlatformRuns,
  type EventScraperPlatformOption,
} from "./event-platform-runs";

type Tab = "today" | "pipeline" | "inbox" | "discovery" | "templates";

const STATUS_TONE: Record<ProspectStatus, string> = {
  new: "bg-primary-500/8 text-primary-500 font-medium",
  qualifying: "bg-status-yellow/10 text-status-yellow",
  qualified: "bg-status-green/10 text-status-green",
  unqualified: "bg-status-red/10 text-status-red",
  drafted: "bg-status-yellow/10 text-status-yellow",
  approved: "bg-primary-500/10 text-primary-500",
  sent: "bg-gray-200/60 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400",
  replied: "bg-status-green/20 text-status-green font-semibold",
  handed_off: "bg-status-green/10 text-status-green",
  closed_won: "bg-status-green/20 text-status-green",
  closed_lost: "bg-sidebar text-text-muted",
  dismissed: "bg-sidebar text-text-muted",
};

const QUALITY_TONE: Record<ProspectQuality, string> = {
  unscored: "bg-sidebar text-text-muted/70",
  hot: "bg-status-red/10 text-status-red font-semibold",
  warm: "bg-status-yellow/10 text-status-yellow font-semibold",
  cold: "bg-primary-500/8 text-primary-500",
  dead: "bg-sidebar text-text-muted",
};

type QualityTab = ProspectQuality | "all" | "duplicates";

const NOW_MS = new Date().getTime();

function temporalLine(p: ProspectRecord): { text: string; cls: string } | null {
  const rel = (iso: string) => {
    const d = Math.floor((NOW_MS - new Date(iso).getTime()) / 86_400_000);
    if (d === 0) return "today";
    if (d === 1) return "1d ago";
    return `${d}d ago`;
  };
  if (p.status === "replied") {
    const replyRef = p.lastReachoutAt ?? p.lastTouchedAt;
    return { text: `● Replied${replyRef ? ` ${rel(replyRef)}` : ""}`, cls: "text-status-green" };
  }
  if (p.status === "sent" && (p.lastReachoutAt || p.lastTouchedAt)) {
    const ref = p.lastReachoutAt ?? p.lastTouchedAt!;
    const days = (NOW_MS - new Date(ref).getTime()) / 86_400_000;
    return days > 7
      ? { text: `⚠ Sent ${rel(ref)} · follow up`, cls: "text-status-yellow" }
      : { text: `Sent ${rel(ref)}`, cls: "text-text-muted" };
  }
  if ((p.status === "drafted" || p.status === "approved") && p.lastTouchedAt) {
    return { text: "Draft ready · not sent", cls: "text-status-yellow" };
  }
  if (p.status === "qualified") {
    return { text: "Qualified · not contacted", cls: "text-primary-500" };
  }
  return null;
}

const PAGE_SIZE = 50;

function ProspectTemporalLine({
  p,
  tenantSlug,
  onUpdate,
}: {
  p: ProspectRecord;
  tenantSlug: string;
  onUpdate: (updated: ProspectRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();
  const t = temporalLine(p);

  const handleDateChange = (val: string) => {
    setEditing(false);
    if (!val) return;
    const iso = new Date(val).toISOString();
    startSave(async () => {
      const res = await updateProspectAction(tenantSlug, p.id, { lastReachoutAt: iso });
      if (res.success) onUpdate({ ...p, lastReachoutAt: iso });
    });
  };

  const dateStr = p.lastReachoutAt
    ? p.lastReachoutAt.slice(0, 10)
    : p.lastTouchedAt?.slice(0, 10) ?? "";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {t && <span className={`text-[11px] ${t.cls}`}>{t.text}</span>}
      {editing ? (
        <input
          type="date"
          autoFocus
          defaultValue={dateStr}
          onBlur={e => handleDateChange(e.target.value)}
          onChange={e => { if (e.target.value) handleDateChange(e.target.value); }}
          onClick={e => e.stopPropagation()}
          className="text-[11px] bg-card border border-primary-500/30 rounded px-1.5 py-0.5 text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setEditing(true); }}
          className={`inline-flex items-center gap-1 text-[11px] transition-colors rounded px-1 -ml-1 ${
            saving ? "opacity-50" : p.lastReachoutAt
              ? "text-text-muted hover:text-primary-500 hover:bg-primary-500/5"
              : "text-text-muted/40 hover:text-text-muted hover:bg-sidebar"
          }`}
        >
          <Calendar size={10} className="shrink-0" />
          {p.lastReachoutAt
            ? <span>Last reachout · {new Date(p.lastReachoutAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            : <span className="inline-flex items-center gap-0.5">Set last reachout <ArrowRight size={9} /></span>}
        </button>
      )}
    </div>
  );
}

function QualityBadge({
  p,
  tenantSlug,
  onUpdate,
}: {
  p: ProspectRecord;
  tenantSlug: string;
  onUpdate: (updated: ProspectRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();

  const handleChange = (quality: ProspectQuality) => {
    setEditing(false);
    if (quality === p.quality) return;
    startSave(async () => {
      const res = await updateProspectAction(tenantSlug, p.id, { quality });
      if (res.success) onUpdate({ ...p, quality });
    });
  };

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={p.quality}
        onBlur={(e) => handleChange(e.target.value as ProspectQuality)}
        onChange={(e) => handleChange(e.target.value as ProspectQuality)}
        onClick={(e) => e.stopPropagation()}
        className="text-[10px] bg-card border border-primary-500/30 rounded px-1 py-0.5 text-foreground outline-none"
      >
        {PROSPECT_QUALITIES.map((q) => (
          <option key={q} value={q}>
            {QUALITY_LABELS[q]}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      disabled={saving}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded transition-opacity ${QUALITY_TONE[p.quality]} ${saving ? "opacity-50" : "hover:opacity-80"}`}
      title="Click to set lead quality"
    >
      {saving ? <Loader2 size={9} className="animate-spin" /> : null}
      {QUALITY_LABELS[p.quality]}
    </button>
  );
}

export function OutboundClient({
  tenantSlug,
  tenantName,
  initialProspects,
  totalProspects,
  initialInbox,
  searches,
  initialDmsByProspect,
  initialTemplates,
  initialTodayData,
  campaigns,
  initialEventScraperRuns,
  eventScraperPlatforms,
  eventScraperEnabled,
  qualityKpis,
  kpis,
}: {
  tenantSlug: string;
  tenantName: string;
  initialProspects: ProspectRecord[];
  totalProspects: number;
  initialInbox: InboundMessageRecord[];
  searches: ProspectSearchRecord[];
  initialDmsByProspect: Array<[string, OutboundDmRecord[]]>;
  initialTemplates: OutboundTemplateRecord[];
  initialTodayData: OutreachTodayData;
  campaigns: OutreachCampaignRecord[];
  initialEventScraperRuns: EventScraperRunRecord[];
  eventScraperPlatforms: EventScraperPlatformOption[];
  eventScraperEnabled: boolean;
  qualityKpis: Record<ProspectQuality, number> & { duplicates: number };
  kpis: {
    total: number;
    active: number;
    qualified: number;
    drafted: number;
    sent: number;
    replied: number;
    inboxUnread: number;
    newThisWeek: number;
    silentOver7Days: number;
  };
}) {
  const dialogs = useDialogs();
  const searchParams = useSearchParams();
  const deeplinkProspectId = searchParams.get("prospect");
  const deeplinkAction = searchParams.get("action");

  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    if (t === "inbox" || t === "today" || t === "discovery" || t === "templates") {
      return t;
    }
    return "pipeline";
  });
  const [prospects, setProspects] = useState(initialProspects);
  const [inbox, setInbox] = useState(initialInbox);
  const dmsByProspect = useMemo(
    () => new Map(initialDmsByProspect),
    [initialDmsByProspect]
  );
  const [threadPanelProspect, setThreadPanelProspect] = useState<ProspectRecord | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importDidChange, setImportDidChange] = useState(false);
  const [editingProspect, setEditingProspect] = useState<ProspectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProspectStatus | "all">(
    "all"
  );
  const [qualityFilter, setQualityFilter] = useState<QualityTab>("all");
  const [sortBy, setSortBy] = useState<"updated" | "followup">("updated");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(totalProspects);
  const [pageLoading, startPageLoad] = useTransition();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const openThreadPanel = useCallback((prospect: ProspectRecord) => {
    setThreadPanelProspect(prospect);
  }, []);

  // Deeplink: open thread panel for ?prospect=id on mount
  useEffect(() => {
    if (!deeplinkProspectId) return;
    const found = initialProspects.find((p) => p.id === deeplinkProspectId);
    if (found) openThreadPanel(found);
    const el = document.getElementById(`prospect-${deeplinkProspectId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const base = prospects; // status filtering is server-side per page
    if (sortBy === "followup") {
      const urgency = (p: ProspectRecord): number => {
        if (p.status === "replied") return 0;
        if (p.status === "sent") {
          const days = p.lastTouchedAt ? (NOW_MS - new Date(p.lastTouchedAt).getTime()) / 86_400_000 : 999;
          return days > 7 ? 1 : 2;
        }
        if (p.status === "qualified") return 3;
        return 99;
      };
      return [...base].sort((a, b) => urgency(a) - urgency(b));
    }
    return base;
  }, [prospects, sortBy]);

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));

  const clearSelection = () => setSelectedIds(new Set());

  const goToPage = (
    nextPage: number,
    filterOverride?: string,
    qualityOverride?: QualityTab
  ) => {
    const activeFilter = filterOverride ?? statusFilter;
    const activeQuality = qualityOverride ?? qualityFilter;
    startPageLoad(async () => {
      const res = await fetchProspectsPage(
        tenantSlug,
        nextPage,
        activeFilter === "all" ? undefined : activeFilter,
        activeQuality
      );
      setProspects(res.data);
      setTotalCount(res.total);
      setPage(nextPage);
      setSelectedIds(new Set());
    });
  };

  const handleStatusChange = (val: ProspectStatus | "all") => {
    setStatusFilter(val);
    goToPage(0, val);
  };

  const handleQualityChange = (val: QualityTab) => {
    setQualityFilter(val);
    goToPage(0, undefined, val);
  };

  const handleBulkDelete = () => {
    const ids = [...selectedIds];
    startBulk(async () => {
      const res = await bulkDeleteProspects(tenantSlug, ids);
      if (res.success) {
        setProspects(prev => prev.filter(p => !ids.includes(p.id)));
        clearSelection();
      }
    });
  };

  const handleBulkStatus = (status: ProspectStatus) => {
    const ids = [...selectedIds];
    startBulk(async () => {
      const res = await bulkUpdateProspectStatus(tenantSlug, ids, status);
      if (res.success) {
        setProspects(prev => prev.map(p => ids.includes(p.id) ? { ...p, status } : p));
        clearSelection();
      }
    });
  };

  const updateProspect = (updated: ProspectRecord) => {
    setProspects((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  };

  const handleAddProspect = async (input: {
    platform: OutboundPlatform;
    handle: string;
    displayName?: string;
    bio?: string;
    signal?: string;
    profileUrl?: string;
  }) => {
    setError(null);
    const res = await createProspect(tenantSlug, {
      platform: input.platform,
      handle: input.handle,
      displayName: input.displayName,
      bio: input.bio,
      signalSummary: input.signal,
      profileUrl: input.profileUrl,
    });
    if (!res.success) {
      setError(res.error);
      return;
    }
    setProspects((prev) => {
      const without = prev.filter((p) => p.id !== res.prospect.id);
      return [res.prospect, ...without];
    });
    openThreadPanel(res.prospect);
    setTab("pipeline");
  };

  const handleQualify = async (prospect: ProspectRecord) => {
    setBusyId(prospect.id);
    setError(null);
    updateProspect({ ...prospect, status: "qualifying" });
    const res = await qualifyProspect(tenantSlug, prospect.id);
    setBusyId(null);
    if (!res.success) {
      setError(res.error);
      updateProspect({ ...prospect, status: "new" });
      return;
    }
    updateProspect({
      ...prospect,
      status: res.status,
      qualificationScore: res.score,
    });
  };

  const handleDraft = async (prospect: ProspectRecord) => {
    setBusyId(prospect.id);
    setError(null);
    const res = await draftProspectDm(tenantSlug, prospect.id);
    setBusyId(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    updateProspect({ ...prospect, status: "drafted" });
    location.reload();
  };

  const handleStatus = async (
    prospect: ProspectRecord,
    status: ProspectStatus
  ) => {
    setBusyId(prospect.id);
    const res = await updateProspectStatus(tenantSlug, prospect.id, status);
    setBusyId(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    updateProspect({ ...prospect, status });
  };

  const handleDelete = async (prospect: ProspectRecord) => {
    const ok = await dialogs.confirm({
      title: `Remove @${prospect.handle}?`,
      subtitle: "The prospect and any drafted DMs will be deleted.",
      tone: "destructive",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setBusyId(prospect.id);
    const res = await deleteProspect(tenantSlug, prospect.id);
    setBusyId(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setProspects((prev) => prev.filter((p) => p.id !== prospect.id));
    if (threadPanelProspect?.id === prospect.id) {
      setThreadPanelProspect(null);
    }
  };

  const handleInboxRead = async (message: InboundMessageRecord) => {
    if (message.readAt) return;
    setInbox((prev) =>
      prev.map((m) =>
        m.id === message.id
          ? { ...m, readAt: new Date().toISOString() }
          : m
      )
    );
    await markInboundRead(tenantSlug, message.id);
  };

  const todayUrgentCount =
    initialTodayData.overdue.length + initialTodayData.newReplies.length;

  return (
    <div>
      {threadPanelProspect && (
        <ProspectThreadPanel
          prospect={threadPanelProspect}
          tenantSlug={tenantSlug}
          tenantName={tenantName}
          campaigns={campaigns}
          templates={initialTemplates}
          onClose={() => setThreadPanelProspect(null)}
          onQualify={handleQualify}
          onDraft={handleDraft}
          onStatusChange={handleStatus}
          onDelete={handleDelete}
          onEdit={(p) => setEditingProspect(p)}
        />
      )}
      {importModalOpen && (
        <ImportProspectsModal
          tenantSlug={tenantSlug}
          onClose={() => {
            setImportModalOpen(false);
            if (importDidChange) location.reload();
          }}
          onImported={(count) => {
            // Don't close yet — let the Done step render so the user sees
            // created/updated/error counts before the page reloads.
            if (count > 0) setImportDidChange(true);
          }}
        />
      )}
      {editingProspect && (
        <EditProspectModal
          prospect={editingProspect}
          tenantSlug={tenantSlug}
          onClose={() => setEditingProspect(null)}
          onSaved={(patch) => {
            setProspects(prev =>
              prev.map(p => p.id === editingProspect.id ? { ...p, ...patch } : p)
            );
            setEditingProspect(null);
          }}
          onPartialUpdate={(patch) => {
            setProspects(prev =>
              prev.map(p => p.id === editingProspect.id ? { ...p, ...patch } : p)
            );
          }}
        />
      )}

      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {(
          [
            {
              key: "today" as const,
              label: "Today",
              count: todayUrgentCount,
            },
            { key: "pipeline" as const, label: "Pipeline", count: totalCount },
            {
              key: "inbox" as const,
              label: "Inbox",
              count: inbox.filter((m) => !m.readAt).length,
            },
            {
              key: "discovery" as const,
              label: "Discovery",
              count: searches.length,
            },
            {
              key: "templates" as const,
              label: "Templates",
              count: initialTemplates.length,
            },
          ] satisfies Array<{ key: Tab; label: string; count: number }>
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === t.key
                ? "border-primary-500 text-foreground"
                : "border-transparent text-text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 rounded-full ${
                t.key === "today" && t.count > 0
                  ? "bg-status-red/15 text-status-red"
                  : "bg-sidebar"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="mb-3 rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}

      {tab === "today" && (
        <TodayView
          data={initialTodayData}
          tenantSlug={tenantSlug}
          onOpenThread={openThreadPanel}
        />
      )}

      {tab === "pipeline" && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-3">
          <Kpi label="Active" value={kpis.active} />
          <Kpi label="New this week" value={kpis.newThisWeek} tone="primary" />
          <Kpi label="All" value={kpis.total} />
          <Kpi
            label="Silent >7 days"
            value={kpis.silentOver7Days}
            tone={kpis.silentOver7Days > 0 ? "yellow" : "default"}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Kpi label="Qualified" value={kpis.qualified} tone="primary" />
          <Kpi label="Ready to send" value={kpis.drafted} tone="yellow" />
          <Kpi label="Sent" value={kpis.sent} tone="green" />
          <Kpi
            label="Inbox"
            value={kpis.inboxUnread}
            tone={kpis.inboxUnread > 0 ? "primary" : "default"}
          />
        </div>
        <div className="space-y-3">
            <QualityTabs
              value={qualityFilter}
              counts={qualityKpis}
              onChange={handleQualityChange}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <StatusFilter value={statusFilter} onChange={handleStatusChange} />
              <button
                type="button"
                onClick={() => setSortBy(s => s === "updated" ? "followup" : "updated")}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                  sortBy === "followup"
                    ? "bg-primary-500/10 text-primary-500 border-primary-500/30"
                    : "text-text-muted border-border hover:text-foreground hover:bg-sidebar"
                }`}
              >
                {sortBy === "followup" ? "Needs follow-up first" : "Sort: most recent"}
              </button>
              <AddProspectQuickForm onSubmit={handleAddProspect} />
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground px-2.5 py-1.5 rounded-full border border-border hover:bg-sidebar transition-colors"
              >
                <Upload size={12} />
                Import
              </button>
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl bg-primary-500/5 border border-primary-500/20 animate-fade-scale-in">
                <span className="text-xs font-semibold text-primary-500">{selectedIds.size} selected</span>
                <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleBulkStatus("qualified")}
                    disabled={bulkPending}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-status-green/30 bg-status-green/10 text-status-green hover:bg-status-green/20 transition-colors disabled:opacity-50"
                  >
                    {bulkPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    Mark qualified
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkStatus("dismissed")}
                    disabled={bulkPending}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-border bg-sidebar text-text-muted hover:text-foreground hover:bg-sidebar/80 transition-colors disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    disabled={bulkPending}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-status-red/30 bg-status-red/5 text-status-red hover:bg-status-red/10 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="p-1 rounded text-text-muted hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-foreground font-semibold">
                  No prospects yet.
                </p>
                <p className="text-xs text-text-muted mt-2 mb-4">
                  Search your niche on Discovery, or add one manually above.
                </p>
                <button
                  type="button"
                  onClick={() => setTab("discovery")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                >
                  Go to Discovery
                  <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-border/30 rounded-xl border border-border bg-card overflow-hidden">
                <li className="px-4 py-2 border-b border-border/40 bg-sidebar/30">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground"
                  >
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={13} className="text-primary-500" />
                      : <Square size={13} />}
                    {selectedIds.size === filtered.length && filtered.length > 0 ? "Deselect all" : `Select all (${filtered.length})`}
                  </button>
                </li>
                {filtered.map((p) => (
                  <li
                    key={p.id}
                    id={`prospect-${p.id}`}
                    className={`group px-4 py-3.5 cursor-pointer transition-colors border-b border-border/30 last:border-0 ${
                      selectedIds.has(p.id) || threadPanelProspect?.id === p.id
                        ? "bg-primary-500/5"
                        : "hover:bg-sidebar/50"
                    }`}
                    onClick={() => openThreadPanel(p)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); toggleSelect(p.id); }}
                        className="shrink-0 mt-0.5 text-text-muted hover:text-primary-500"
                        aria-label={selectedIds.has(p.id) ? "Deselect" : "Select"}
                      >
                        {selectedIds.has(p.id) ? <CheckSquare size={14} className="text-primary-500" /> : <Square size={14} />}
                      </button>

                      {/* 4-column grid on desktop, single column on mobile */}
                      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_90px_160px_160px] gap-x-6 items-start">

                        {/* Col 1: Identity — display name headline, handle + status secondary, event title */}
                        <div className="min-w-0">
                          {/* Display Name — primary (never a raw scraped slug) */}
                          <p className="text-sm font-semibold text-foreground leading-snug truncate">
                            {primaryTitleFor(p)}
                          </p>
                          {/* Handle + status — secondary */}
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {p.displayName && (
                              <span className="text-[11px] text-text-muted/60">@{p.handle}</span>
                            )}
                            {isUnresolvedProspectHandle(p) && (
                              <span
                                className="text-[10px] italic text-text-muted/50"
                                title="We couldn't resolve a real social handle for this lead — this identifier was auto-generated, not verified."
                              >
                                (unverified)
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                STATUS_TONE[p.status]
                              }`}
                            >
                              {p.status === "qualifying" && <Loader2 size={9} className="animate-spin" />}
                              {STATUS_LABELS[p.status]}
                            </span>
                            <QualityBadge p={p} tenantSlug={tenantSlug} onUpdate={updateProspect} />
                            {p.qualificationScore != null && (
                              <span className="text-[10px] text-text-muted">
                                · {p.qualificationScore}
                              </span>
                            )}
                          </div>
                          {/* Event title — only when it isn't already shown as the primary title above */}
                          {p.eventTitle && p.eventTitle !== primaryTitleFor(p) && (
                            <p className="text-[11px] text-text-muted italic mt-0.5 truncate">
                              {p.eventTitle}
                            </p>
                          )}
                          {/* Mobile-only: platform + context + temporal */}
                          <div className="sm:hidden mt-1 flex flex-col gap-0.5">
                            <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border/50 bg-sidebar text-text-muted/70 w-fit">
                              {PLATFORM_LABELS[p.platform]}
                            </span>
                            {(p.category || p.location) && (
                              <div className="flex items-center gap-2 flex-wrap">
                                {p.category && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                                    <Tag size={12} />{p.category}
                                  </span>
                                )}
                                {p.location && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                                    <MapPin size={12} />{p.location}
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="mt-1">
                              <ProspectTemporalLine p={p} tenantSlug={tenantSlug} onUpdate={updateProspect} />
                            </div>
                          </div>
                        </div>

                        {/* Col 2: Platform (desktop only) */}
                        <div className="hidden sm:flex items-start pt-0.5">
                          <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border/50 bg-sidebar text-text-muted/70">
                            {PLATFORM_LABELS[p.platform]}
                          </span>
                        </div>

                        {/* Col 3: Context — category + location only (desktop only) */}
                        <div className="hidden sm:flex flex-col gap-1 pt-0.5">
                          {p.category && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                              <Tag size={12} className="shrink-0" />{p.category}
                            </span>
                          )}
                          {p.location && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                              <MapPin size={12} className="shrink-0" />{p.location}
                            </span>
                          )}
                        </div>

                        {/* Col 4: Last reachout (desktop only) */}
                        <div className="hidden sm:block pt-0.5">
                          <ProspectTemporalLine p={p} tenantSlug={tenantSlug} onUpdate={updateProspect} />
                        </div>

                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className={`flex items-center justify-between gap-2 pt-1 transition-opacity ${pageLoading ? "opacity-50 pointer-events-none" : ""}`}>
              <span className="text-xs text-text-muted">
                {totalPages > 1 ? `Page ${page + 1} of ${totalPages} · ` : ""}{totalCount} prospects
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => goToPage(page - 1)}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-xs rounded-full border border-border text-text-muted hover:text-foreground hover:bg-sidebar disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i).map(i => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => goToPage(i)}
                      className={`w-7 h-7 text-xs rounded-full border transition-colors ${
                        i === page
                          ? "bg-primary-500 text-white border-primary-500"
                          : "border-border text-text-muted hover:text-foreground hover:bg-sidebar"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 text-xs rounded-full border border-border text-text-muted hover:text-foreground hover:bg-sidebar disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
        </div>

        </>
      )}

      {tab === "inbox" && (
        <InboxView
          inbox={inbox}
          prospects={prospects}
          onRead={handleInboxRead}
          onOpenProspect={(pid) => {
            const found = prospects.find((p) => p.id === pid);
            if (found) openThreadPanel(found);
            setTab("pipeline");
          }}
        />
      )}

      {tab === "discovery" && (
        <DiscoveryView
          tenantSlug={tenantSlug}
          searches={searches}
          initialEventScraperRuns={initialEventScraperRuns}
          eventScraperPlatforms={eventScraperPlatforms}
          eventScraperEnabled={eventScraperEnabled}
        />
      )}

      {tab === "templates" && (
        <TemplatesView tenantSlug={tenantSlug} initial={initialTemplates} />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "yellow" | "green";
}) {
  const tones = {
    default: "text-foreground",
    primary: "text-primary-500",
    yellow: "text-status-yellow",
    green: "text-status-green",
  };
  return (
    <div className="bg-card rounded-xl p-4 border border-border/50">
      <p className="text-text-secondary text-xs">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function QualityTabs({
  value,
  counts,
  onChange,
}: {
  value: QualityTab;
  counts: Record<ProspectQuality, number> & { duplicates: number };
  onChange: (v: QualityTab) => void;
}) {
  const tabs: Array<{ key: QualityTab; label: string; count: number }> = [
    { key: "all", label: "All", count: 0 },
    { key: "hot", label: "Hot", count: counts.hot },
    { key: "warm", label: "Warm", count: counts.warm },
    { key: "cold", label: "Cold", count: counts.cold },
    { key: "dead", label: "Dead", count: counts.dead },
    { key: "duplicates", label: "Duplicates", count: counts.duplicates },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
            value === t.key
              ? "bg-primary-500/10 text-primary-500 border-primary-500/30 font-medium"
              : "text-text-muted border-border hover:text-foreground hover:bg-sidebar"
          }`}
        >
          {t.label}
          {t.count > 0 && (
            <span className="text-[10px] px-1 rounded-full bg-sidebar">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function StatusFilter({
  value,
  onChange,
}: {
  value: ProspectStatus | "all";
  onChange: (v: ProspectStatus | "all") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ProspectStatus | "all")}
      className="h-9 px-3 rounded-lg border border-border bg-card text-xs text-foreground"
    >
      <option value="all">All statuses</option>
      {(
        [
          "new",
          "qualified",
          "drafted",
          "approved",
          "sent",
          "replied",
          "handed_off",
          "closed_won",
          "unqualified",
          "dismissed",
        ] as ProspectStatus[]
      ).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function AddProspectQuickForm({
  onSubmit,
}: {
  onSubmit: (input: {
    platform: OutboundPlatform;
    handle: string;
    displayName?: string;
    bio?: string;
    signal?: string;
    profileUrl?: string;
  }) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<OutboundPlatform>("instagram");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [signal, setSignal] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [isPending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setHandle(""); setDisplayName(""); setBio(""); setSignal(""); setProfileUrl("");
  };

  const submit = () => {
    if (!handle.trim()) return;
    startTransition(async () => {
      await onSubmit({
        platform,
        handle: handle.trim(),
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        signal: signal.trim() || undefined,
        profileUrl: profileUrl.trim() || undefined,
      });
      close();
    });
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus size={14} />
        Add prospect
      </Button>
      <Dialog open={open} onClose={close} locked={isPending} size="lg">
        <div className="p-5 space-y-4">
          <h3 className="text-base font-semibold text-foreground">Add prospect</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label>Platform</Label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as OutboundPlatform)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
              >
                {OUTBOUND_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Handle</Label>
              <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@sarahbuilds" />
            </div>
            <div>
              <Label>Display name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Sarah Chen" />
            </div>
            <div>
              <Label>Profile URL</Label>
              <Input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://instagram.com/sarahbuilds" />
            </div>
          </div>
          <div>
            <Label>Bio (optional)</Label>
            <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Freelance brand strategist, helping startups find their voice" />
          </div>
          <div>
            <Label>Signal (why did we find them?)</Label>
            <Textarea rows={3} value={signal} onChange={(e) => setSignal(e.target.value)} placeholder="Posted about growing their newsletter to 5k. Used hashtag #creatoreconomy" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={close} disabled={isPending}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={isPending || !handle.trim()}>
              {isPending ? "Adding…" : "Add prospect"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function ProspectRowActions({
  prospect,
  busy,
  onQualify,
  onDraft,
  onDelete,
}: {
  prospect: ProspectRecord;
  busy: boolean;
  onQualify: (p: ProspectRecord) => void;
  onDraft: (p: ProspectRecord) => void;
  onDelete: (p: ProspectRecord) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {prospect.status === "new" || prospect.status === "qualifying" ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQualify(prospect);
          }}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600 px-2 py-1 rounded-md hover:bg-primary-500/10"
          title="AI qualify"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          Qualify
        </button>
      ) : null}
      {prospect.status === "qualified" ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDraft(prospect);
          }}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[11px] text-status-yellow hover:text-status-yellow px-2 py-1 rounded-md hover:bg-status-yellow/10"
          title="Draft DM"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          Draft DM
        </button>
      ) : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(prospect);
        }}
        disabled={busy}
        className="inline-flex items-center text-[11px] text-text-muted hover:text-status-red p-1.5 rounded-md hover:bg-status-red/10"
        title="Remove"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

// Some sources (scraped event platforms, manual entry) store a raw slug —
// e.g. "event-egotickets-summer-on-the-hills-luxury-lifestyle-accra-edition-with-our-"
// — as displayName. Never let that render as the primary title: prefer the
// human-written event title when the name is shaped like a slug.
function looksLikeRawSlug(name: string): boolean {
  return (
    !/\s/.test(name) &&
    name === name.toLowerCase() &&
    (name.match(/-/g) ?? []).length >= 3
  );
}

function primaryTitleFor(prospect: ProspectRecord): string {
  if (prospect.displayName && !looksLikeRawSlug(prospect.displayName)) {
    return prospect.displayName;
  }
  if (prospect.eventTitle) return prospect.eventTitle;
  return prospect.displayName || `@${prospect.handle}`;
}

function platformProfileUrl(prospect: ProspectRecord): string {
  if (prospect.profileUrl) return prospect.profileUrl;
  const h = prospect.handle;
  switch (prospect.platform) {
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "twitter":
      return `https://twitter.com/${h}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${h}/`;
    default:
      return "";
  }
}

function ProspectDetail({
  prospect,
  tenantSlug,
  dms,
  autoOpenReply,
  onStatusChange,
  onQualify,
  onDraft,
}: {
  prospect: ProspectRecord | null;
  tenantSlug: string;
  dms: OutboundDmRecord[];
  autoOpenReply: boolean;
  onStatusChange: (p: ProspectRecord, status: ProspectStatus) => void;
  onQualify: (p: ProspectRecord) => void;
  onDraft: (p: ProspectRecord) => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [isReplyOpen, setReplyOpen] = useState(autoOpenReply);
  const [isReplyPending, startReply] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editingDm, setEditingDm] = useState<{
    id: string;
    body: string;
  } | null>(null);
  const [isDmBusy, setDmBusy] = useState(false);

  if (!prospect) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-foreground font-semibold">
          Pick a prospect to see detail
        </p>
        <p className="text-xs text-text-muted mt-1">
          Actions, DM history, and conversation live here.
        </p>
      </div>
    );
  }

  const latestDm: OutboundDmRecord | null = dms[0] ?? null;

  const handleRecordReply = () => {
    if (!replyBody.trim()) return;
    setLocalError(null);
    startReply(async () => {
      const res = await recordInboundReply(tenantSlug, prospect.id, {
        body: replyBody,
        inReplyToDmId: latestDm?.id,
      });
      if (!res.success) {
        setLocalError(res.error);
        return;
      }
      setReplyBody("");
      setReplyOpen(false);
      location.reload();
    });
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setLocalError("Couldn't copy to clipboard.");
    }
  };

  const handleCopyAndOpen = async () => {
    if (!latestDm) return;
    await copyText("dm-and-open", latestDm.body);
    const url = platformProfileUrl(prospect);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCopyReplyLink = async () => {
    const url = `${window.location.origin}/leads?prospect=${prospect.id}&action=reply`;
    await copyText("reply-link", url);
  };

  const handleSaveDmEdit = async () => {
    if (!editingDm) return;
    setDmBusy(true);
    setLocalError(null);
    const res = await updateOutboundDm(tenantSlug, editingDm.id, {
      body: editingDm.body,
    });
    setDmBusy(false);
    if (!res.success) {
      setLocalError(res.error);
      return;
    }
    setEditingDm(null);
    location.reload();
  };

  const handleApproveDm = async () => {
    if (!latestDm) return;
    setDmBusy(true);
    const res = await updateOutboundDm(tenantSlug, latestDm.id, {
      status: "approved",
    });
    setDmBusy(false);
    if (!res.success) {
      setLocalError(res.error);
      return;
    }
    onStatusChange(prospect, "approved");
    location.reload();
  };

  const handleMarkSent = async () => {
    if (!latestDm) return;
    setDmBusy(true);
    const res = await updateOutboundDm(tenantSlug, latestDm.id, {
      status: "sent",
    });
    setDmBusy(false);
    if (!res.success) {
      setLocalError(res.error);
      return;
    }
    onStatusChange(prospect, "sent");
  };

  const profileUrl = platformProfileUrl(prospect);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2 flex-wrap">
          <h3
            className={`text-sm font-semibold ${isUnresolvedProspectHandle(prospect) ? "text-text-muted italic" : "text-foreground"}`}
          >
            @{prospect.handle}
          </h3>
          {isUnresolvedProspectHandle(prospect) && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-sidebar text-text-muted"
              title="We couldn't resolve a real social handle for this lead — this identifier was auto-generated, not verified."
            >
              Unverified
            </span>
          )}
          <span className="text-xs uppercase tracking-wide text-text-muted">
            {PLATFORM_LABELS[prospect.platform]}
          </span>
          <span
            className={`text-xs uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[prospect.status]}`}
          >
            {STATUS_LABELS[prospect.status]}
          </span>
        </div>
        {prospect.displayName && (
          <p className="text-xs text-text-muted mt-1">{prospect.displayName}</p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {profileUrl && (
            <a
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-600"
            >
              Open profile
              <ExternalLink size={11} />
            </a>
          )}
          <button
            type="button"
            onClick={handleCopyReplyLink}
            className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground"
            title="Share this link on Priye's phone — tap to jump to the reply form"
          >
            {copied === "reply-link" ? (
              <Check size={11} className="text-status-green" />
            ) : (
              <LinkIcon size={11} />
            )}
            {copied === "reply-link" ? "Copied" : "Copy reply link"}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {prospect.signalSummary && (
          <DetailRow label="Signal" value={prospect.signalSummary} />
        )}
        {prospect.bio && <DetailRow label="Bio" value={prospect.bio} />}
        {prospect.qualificationReason && (
          <DetailRow
            label={`AI fit · ${prospect.qualificationScore ?? "?"}/100`}
            value={prospect.qualificationReason}
          />
        )}

        <div className="flex flex-wrap gap-1.5">
          {(prospect.status === "new" || prospect.status === "qualifying") && (
            <Button
              size="sm"
              onClick={() => onQualify(prospect)}
              className="gap-1.5"
            >
              <Sparkles size={13} />
              AI qualify
            </Button>
          )}
          {prospect.status === "qualified" && (
            <Button size="sm" onClick={() => onDraft(prospect)} className="gap-1.5">
              <Send size={13} />
              Draft DM
            </Button>
          )}
          {(prospect.status === "sent" || prospect.status === "replied") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setReplyOpen((v) => !v)}
              className="gap-1.5"
            >
              <MessageCircle size={13} />
              Log reply
            </Button>
          )}
          {prospect.status !== "handed_off" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStatusChange(prospect, "handed_off")}
              title="Priye takes over from here"
            >
              Hand off
            </Button>
          )}
        </div>

        {latestDm && (
          <div className="rounded-lg border border-border/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">
                Latest DM draft · v{latestDm.version} ·{" "}
                <span className="text-foreground">{latestDm.status}</span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => copyText(`dm-${latestDm.id}`, latestDm.body)}
                  className="text-[11px] text-text-muted hover:text-foreground inline-flex items-center gap-1"
                >
                  {copied === `dm-${latestDm.id}` ? (
                    <Check size={11} className="text-status-green" />
                  ) : (
                    <Copy size={11} />
                  )}
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditingDm({ id: latestDm.id, body: latestDm.body })
                  }
                  className="text-[11px] text-text-muted hover:text-foreground"
                >
                  Edit
                </button>
              </div>
            </div>

            {editingDm && editingDm.id === latestDm.id ? (
              <>
                <Textarea
                  rows={5}
                  value={editingDm.body}
                  onChange={(e) =>
                    setEditingDm({ id: latestDm.id, body: e.target.value })
                  }
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingDm(null)}
                    disabled={isDmBusy}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveDmEdit}
                    disabled={isDmBusy}
                  >
                    {isDmBusy ? "Saving…" : "Save edit"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {latestDm.body}
              </p>
            )}

            {latestDm.followupBody && !editingDm && (
              <div className="pt-2 border-t border-border/30">
                <p className="text-xs uppercase tracking-wide text-text-muted">
                  Follow-up if no reply in 3d
                </p>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  {latestDm.followupBody}
                </p>
              </div>
            )}

            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
              {latestDm.status === "drafted" && (
                <Button
                  size="sm"
                  onClick={handleApproveDm}
                  disabled={isDmBusy}
                  className="gap-1.5"
                >
                  <Check size={13} />
                  Approve
                </Button>
              )}
              {(latestDm.status === "approved" || latestDm.status === "drafted") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopyAndOpen}
                  className="gap-1.5"
                  title="Copies this DM and opens the prospect's profile in a new tab"
                >
                  {copied === "dm-and-open" ? (
                    <Check size={13} className="text-status-green" />
                  ) : (
                    <Copy size={13} />
                  )}
                  Copy &amp; open profile
                </Button>
              )}
              {latestDm.status === "approved" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleMarkSent}
                  disabled={isDmBusy}
                  className="gap-1.5"
                  title="Mark sent once you've pasted it into IG / TikTok"
                >
                  <Send size={13} />
                  Mark sent
                </Button>
              )}
              {dms.length > 1 && (
                <span className="text-xs text-text-muted ml-auto">
                  {dms.length} versions
                </span>
              )}
            </div>
          </div>
        )}

        {isReplyOpen && (
          <div className="rounded-lg border border-border/60 p-3">
            <Label>Reply body</Label>
            <Textarea
              rows={3}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Paste what they replied on IG / TikTok / wherever"
            />
            {localError && (
              <p className="text-xs text-status-red mt-1">{localError}</p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReplyOpen(false)}
                disabled={isReplyPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRecordReply}
                disabled={isReplyPending || !replyBody.trim()}
              >
                {isReplyPending ? "Saving…" : "Save reply"}
              </Button>
            </div>
          </div>
        )}

        {!isReplyOpen && localError && (
          <p className="text-xs text-status-red" role="alert">
            {localError}
          </p>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p className="text-sm text-foreground mt-0.5 leading-relaxed">{value}</p>
    </div>
  );
}

function InboxView({
  inbox,
  prospects,
  onRead,
  onOpenProspect,
}: {
  inbox: InboundMessageRecord[];
  prospects: ProspectRecord[];
  onRead: (m: InboundMessageRecord) => void;
  onOpenProspect: (id: string) => void;
}) {
  const prospectMap = useMemo(() => {
    const m = new Map<string, ProspectRecord>();
    for (const p of prospects) m.set(p.id, p);
    return m;
  }, [prospects]);

  if (inbox.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <Mail size={20} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm text-foreground font-semibold">Inbox is empty</p>
        <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
          When prospects reply, the message surfaces here. Use &ldquo;Log
          reply&rdquo; on a prospect to mirror a reply you saw on mobile.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/30 rounded-xl border border-border bg-card">
      {inbox.map((message) => {
        const prospect = message.prospectId
          ? prospectMap.get(message.prospectId)
          : null;
        const unread = !message.readAt;
        return (
          <li
            key={message.id}
            onClick={() => {
              onRead(message);
              if (prospect) onOpenProspect(prospect.id);
            }}
            className={`px-4 py-3 cursor-pointer flex items-start gap-3 hover:bg-sidebar/30 transition-colors ${
              unread ? "bg-primary-500/5" : ""
            }`}
          >
            <div
              className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                unread ? "bg-primary-500" : "bg-transparent"
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">
                  @{prospect?.handle ?? "unknown"}
                </span>
                {prospect && isUnresolvedProspectHandle(prospect) && (
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-sidebar text-text-muted"
                    title="We couldn't resolve a real social handle for this lead — this identifier was auto-generated, not verified."
                  >
                    Unverified
                  </span>
                )}
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  {message.platform}
                </span>
                <span className="text-xs text-text-muted ml-auto">
                  {formatDateTime(message.receivedAt)}
                </span>
              </div>
              <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                {message.body}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DiscoveryView({
  tenantSlug,
  searches: initial,
  initialEventScraperRuns,
  eventScraperPlatforms,
  eventScraperEnabled,
}: {
  tenantSlug: string;
  searches: ProspectSearchRecord[];
  initialEventScraperRuns: EventScraperRunRecord[];
  eventScraperPlatforms: EventScraperPlatformOption[];
  eventScraperEnabled: boolean;
}) {
  const dialogs = useDialogs();
  const [searches, setSearches] = useState(initial);
  const [creating, setCreating] = useState(initial.length === 0);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{
    searchId: string;
    inserted: number;
    qualified: number;
    skipped: number;
    candidates: number;
    diagnostic?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (input: {
    name: string;
    platform: OutboundPlatform;
    signalType: SignalType;
    query: string;
    autoQualify: boolean;
  }) => {
    setError(null);
    const res = await createProspectSearch(tenantSlug, input);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setSearches((prev) => [res.search, ...prev]);
    setCreating(false);
  };

  const handleRun = async (search: ProspectSearchRecord) => {
    setRunningId(search.id);
    setError(null);
    setLastRun(null);
    const res = await runProspectSearchNow(tenantSlug, search.id);
    setRunningId(null);
    if (!res.success) {
      setError(`"${search.name}" — ${res.error}`);
      return;
    }
    setLastRun({
      searchId: search.id,
      inserted: res.inserted,
      qualified: res.qualified,
      skipped: res.skipped,
      candidates: res.candidates,
      diagnostic: res.diagnostic,
    });
    // Bump the last-run stamp locally for snappy UI.
    setSearches((prev) =>
      prev.map((s) =>
        s.id === search.id
          ? {
              ...s,
              lastRunAt: new Date().toISOString(),
              lastResultCount: res.inserted,
            }
          : s
      )
    );
  };

  const handleToggleAutoQualify = async (
    search: ProspectSearchRecord,
    next: boolean
  ) => {
    setError(null);
    const res = await updateProspectSearch(tenantSlug, search.id, {
      autoQualify: next,
    });
    if (!res.success) {
      setError(res.error);
      return;
    }
    setSearches((prev) =>
      prev.map((s) => (s.id === search.id ? { ...s, autoQualify: next } : s))
    );
  };

  const handleDelete = async (search: ProspectSearchRecord) => {
    const ok = await dialogs.confirm({
      title: `Delete "${search.name}"?`,
      subtitle:
        "The saved search is removed. Prospects already discovered stay — they're in the pipeline.",
      tone: "destructive",
      confirmLabel: "Delete search",
    });
    if (!ok) return;
    const res = await deleteProspectSearch(tenantSlug, search.id);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setSearches((prev) => prev.filter((s) => s.id !== search.id));
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
                Autonomous discovery
              </h3>
              <p className="text-xs text-text-muted leading-relaxed">
                Save searches like <em>&ldquo;freelance designer remote&rdquo;</em>.
                A nightly job runs them against Google site-search and adds
                fresh profiles to your pipeline — no scrolling required.
                Toggle <strong>auto-qualify</strong> to have the AI score
                each new prospect inline.
              </p>
            </div>
          </div>
          {!creating && (
            <Button
              size="sm"
              onClick={() => setCreating(true)}
              className="gap-1.5 shrink-0"
            >
              <Plus size={14} />
              New search
            </Button>
          )}
        </div>
      </div>

      <EventPlatformRuns
        tenantSlug={tenantSlug}
        initialRuns={initialEventScraperRuns}
        platforms={eventScraperPlatforms}
        enabledForTenant={eventScraperEnabled}
      />

      {error && (
        <div
          className="rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}

      {lastRun && (
        <div
          className="rounded-lg border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green"
          role="status"
        >
          Added {lastRun.inserted} new prospect
          {lastRun.inserted === 1 ? "" : "s"}
          {lastRun.qualified > 0 && ` · ${lastRun.qualified} auto-qualified`}
          {lastRun.skipped > 0 &&
            ` · ${lastRun.skipped} already in pipeline (skipped)`}
          {lastRun.candidates === 0 &&
            ` · ${lastRun.diagnostic ?? "no results came back — try a broader or different query"}`}
        </div>
      )}

      {creating && (
        <DiscoverySearchForm
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      )}

      {searches.length === 0 && !creating && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground font-semibold">
            No searches saved yet
          </p>
          <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
            Click <strong>New search</strong> above. Your first search could
            be a keyword your audience uses in bios or captions — e.g.
            &ldquo;freelance designer remote&rdquo; on Instagram.
          </p>
        </div>
      )}

      {searches.length > 0 && (
        <ul className="space-y-2">
          {searches.map((s) => {
            const busy = runningId === s.id;
            return (
              <li
                key={s.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {s.name}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {PLATFORM_LABELS[s.platform]} ·{" "}
                      {SIGNAL_LABELS[s.signalType]} · &ldquo;{s.query}&rdquo;
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      Last run{" "}
                      {s.lastRunAt
                        ? `${formatDateTime(s.lastRunAt)} · added ${s.lastResultCount}`
                        : "never"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.autoQualify}
                        onChange={(e) =>
                          handleToggleAutoQualify(s, e.target.checked)
                        }
                        className="accent-primary-500"
                      />
                      Auto-qualify
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRun(s)}
                      disabled={busy}
                      className="gap-1.5"
                    >
                      {busy ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RefreshCw size={11} />
                      )}
                      Run now
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s)}
                      disabled={busy}
                      className="p-1.5 rounded-md text-text-muted hover:text-status-red hover:bg-status-red/10"
                      title="Delete search"
                      aria-label="Delete search"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DiscoverySearchForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    platform: OutboundPlatform;
    signalType: SignalType;
    query: string;
    autoQualify: boolean;
  }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<OutboundPlatform>("instagram");
  const [signalType, setSignalType] = useState<SignalType>("keyword");
  const [query, setQuery] = useState("");
  const [autoQualify, setAutoQualify] = useState(true);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim() || !query.trim()) return;
    startTransition(async () => {
      await onSubmit({ name, platform, signalType, query, autoQualify });
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          New saved search
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      <div>
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. freelance designers on LinkedIn"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label>Platform</Label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as OutboundPlatform)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
          >
            {OUTBOUND_PLATFORMS.filter(
              (p) => p !== "manual" && p !== "other"
            ).map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Signal type</Label>
          <select
            value={signalType}
            onChange={(e) => setSignalType(e.target.value as SignalType)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
          >
            {SIGNAL_TYPES.filter((s) => s !== "manual").map((s) => (
              <option key={s} value={s}>
                {SIGNAL_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>Search query</Label>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            signalType === "hashtag"
              ? "#solopreneur"
              : 'freelance designer remote'
          }
        />
        <p className="text-[11px] text-text-muted mt-1">
          This becomes a Google search like{" "}
          <code>site:{platform}.com {query || "…"}</code> — the {SIGNAL_LABELS[signalType].toLowerCase()}{" "}
          signal type shapes the query further (e.g. hashtags are matched
          exactly, event-host/attendee signals add likely bio language).
          Your query itself isn&rsquo;t auto-quoted, so it stays a broad
          match unless you add quotes yourself.
        </p>
      </div>

      <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={autoQualify}
          onChange={(e) => setAutoQualify(e.target.checked)}
          className="mt-0.5 accent-primary-500"
        />
        <span>
          <span className="font-medium">Auto-qualify</span> new prospects — AI
          scores fit (0-100) and marks as qualified / skip, so your pipeline is
          already filtered when you open it.
        </span>
      </label>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={submit}
          disabled={isPending || !name.trim() || !query.trim()}
        >
          {isPending ? "Saving…" : "Save search"}
        </Button>
      </div>
    </div>
  );
}

function BulkQualifyButton({
  tenantSlug,
  prospects,
}: {
  tenantSlug: string;
  prospects: ProspectRecord[];
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  const newCount = prospects.filter((p) => p.status === "new").length;

  if (newCount === 0) return null;

  const handleClick = () => {
    startTransition(async () => {
      const res = await bulkQualifyNewProspects(tenantSlug);
      if (!res.success) {
        await dialogs.alert({
          title: "Bulk qualify failed",
          subtitle: res.error,
          tone: "warning",
        });
        return;
      }
      await dialogs.alert({
        title: `Scored ${res.scored} prospect${res.scored === 1 ? "" : "s"}`,
        subtitle: `${res.qualified} qualified · ${res.skipped} skipped`,
        tone: "success",
      });
      location.reload();
    });
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      disabled={isPending}
      className="gap-1.5"
      title="Run AI qualifier on every 'new' prospect"
    >
      {isPending ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Sparkles size={12} />
      )}
      Qualify {newCount} new
    </Button>
  );
}

function CopyPrimaryTemplateButton({
  tenantSlug,
  templates,
  prospect,
}: {
  tenantSlug: string;
  templates: OutboundTemplateRecord[];
  prospect: ProspectRecord | null;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // Resolve a sensible default platform — the selected prospect's,
  // or fall back to the platform with the most primary-having
  // templates, or 'any'.
  const platform: TemplatePlatform =
    prospect && prospect.platform !== "manual" && prospect.platform !== "other"
      ? (prospect.platform as TemplatePlatform)
      : (templates.find((t) => t.isPrimary)?.platform ?? "any");

  const hasAnyTemplate = templates.length > 0;

  const handleClick = () => {
    startTransition(async () => {
      const res = await resolvePrimaryTemplate(tenantSlug, platform);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't load template",
          subtitle: res.error,
          tone: "warning",
        });
        return;
      }
      if (!res.template) {
        await dialogs.alert({
          title: "No primary template set",
          subtitle: hasAnyTemplate
            ? `Mark one of your templates as Primary for ${platform} in the Templates tab.`
            : "Save a template first in the Templates tab, then mark it as primary.",
          tone: "info",
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(res.template.body);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        await dialogs.alert({
          title: "Couldn't copy",
          subtitle: "Clipboard access denied.",
          tone: "warning",
        });
      }
    });
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      disabled={isPending}
      className="gap-1.5"
      title={`Copy primary template for ${platform}`}
    >
      {isPending ? (
        <Loader2 size={12} className="animate-spin" />
      ) : copied ? (
        <Check size={12} className="text-status-green" />
      ) : (
        <Copy size={12} />
      )}
      {copied ? "Copied" : "Copy primary"}
    </Button>
  );
}
