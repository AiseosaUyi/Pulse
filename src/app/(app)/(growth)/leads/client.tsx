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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDialogs } from "@/components/ui/Dialog";
import {
  bulkQualifyNewProspects,
  createProspect,
  deleteProspect,
  draftProspectDm,
  qualifyProspect,
  recordInboundReply,
  updateOutboundDm,
  updateProspectStatus,
  markInboundRead,
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
  SIGNAL_LABELS,
  SIGNAL_TYPES,
  STATUS_LABELS,
  type InboundMessageRecord,
  type OutboundDmRecord,
  type OutboundPlatform,
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
import type { OutreachTodayData } from "@/lib/services/outreach-intelligence";
import type { OutreachCampaignRecord } from "@/lib/types/outreach-intelligence";

type Tab = "today" | "pipeline" | "inbox" | "discovery" | "templates";

const STATUS_TONE: Record<ProspectStatus, string> = {
  new: "bg-sidebar text-text-muted",
  qualifying: "bg-primary-500/10 text-primary-500",
  qualified: "bg-status-green/10 text-status-green",
  unqualified: "bg-status-red/10 text-status-red",
  drafted: "bg-status-yellow/10 text-status-yellow",
  approved: "bg-primary-500/10 text-primary-500",
  sent: "bg-primary-500/10 text-primary-500",
  replied: "bg-status-green/15 text-status-green",
  handed_off: "bg-status-green/10 text-status-green",
  closed_won: "bg-status-green/20 text-status-green",
  closed_lost: "bg-sidebar text-text-muted",
  dismissed: "bg-sidebar text-text-muted line-through",
};

export function OutboundClient({
  tenantSlug,
  initialProspects,
  initialInbox,
  searches,
  initialDmsByProspect,
  initialTemplates,
  initialTodayData,
  campaigns,
}: {
  tenantSlug: string;
  initialProspects: ProspectRecord[];
  initialInbox: InboundMessageRecord[];
  searches: ProspectSearchRecord[];
  initialDmsByProspect: Array<[string, OutboundDmRecord[]]>;
  initialTemplates: OutboundTemplateRecord[];
  initialTodayData: OutreachTodayData;
  campaigns: OutreachCampaignRecord[];
}) {
  const dialogs = useDialogs();
  const searchParams = useSearchParams();
  const deeplinkProspectId = searchParams.get("prospect");
  const deeplinkAction = searchParams.get("action");

  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    if (t === "inbox") return "inbox";
    if (t === "today") return "today";
    return "pipeline";
  });
  const [prospects, setProspects] = useState(initialProspects);
  const [inbox, setInbox] = useState(initialInbox);
  const dmsByProspect = useMemo(
    () => new Map(initialDmsByProspect),
    [initialDmsByProspect]
  );
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(
    () =>
      deeplinkProspectId ??
      initialProspects[0]?.id ??
      null
  );
  const [threadPanelProspect, setThreadPanelProspect] = useState<ProspectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProspectStatus | "all">(
    "all"
  );

  const openThreadPanel = useCallback((prospect: ProspectRecord) => {
    setThreadPanelProspect(prospect);
  }, []);

  // Respond to ?action=reply query param — auto-open reply form.
  const autoOpenReply = deeplinkAction === "reply";

  const selectedProspect = useMemo(
    () => prospects.find((p) => p.id === selectedProspectId) ?? null,
    [prospects, selectedProspectId]
  );
  const selectedDms = useMemo(
    () => (selectedProspectId ? (dmsByProspect.get(selectedProspectId) ?? []) : []),
    [dmsByProspect, selectedProspectId]
  );

  // Scroll the selected prospect into view on load if it came from a deep link.
  useEffect(() => {
    if (deeplinkProspectId) {
      const el = document.getElementById(`prospect-${deeplinkProspectId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [deeplinkProspectId]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return prospects;
    return prospects.filter((p) => p.status === statusFilter);
  }, [prospects, statusFilter]);

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
    setSelectedProspectId(res.prospect.id);
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
    setSelectedProspectId(prospect.id);
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
    if (selectedProspectId === prospect.id) {
      setSelectedProspectId(null);
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
          campaigns={campaigns}
          onClose={() => setThreadPanelProspect(null)}
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
            { key: "pipeline" as const, label: "Pipeline", count: prospects.length },
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
              <span className={`ml-1.5 text-[10px] px-1.5 rounded-full ${
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
        <div className="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusFilter value={statusFilter} onChange={setStatusFilter} />
              <AddProspectQuickForm onSubmit={handleAddProspect} />
              <BulkQualifyButton tenantSlug={tenantSlug} prospects={prospects} />
              <CopyPrimaryTemplateButton
                tenantSlug={tenantSlug}
                templates={initialTemplates}
                prospect={selectedProspect}
              />
            </div>

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
                  className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                >
                  → Go to Discovery
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-border/30 rounded-xl border border-border bg-card overflow-hidden">
                {filtered.map((p) => (
                  <li
                    key={p.id}
                    id={`prospect-${p.id}`}
                    className={`px-4 py-3 cursor-pointer transition-colors ${
                      selectedProspectId === p.id
                        ? "bg-primary-500/5"
                        : "hover:bg-sidebar/40"
                    }`}
                    onClick={() => setSelectedProspectId(p.id)}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            @{p.handle}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-text-muted">
                            {PLATFORM_LABELS[p.platform]}
                          </span>
                          <span
                            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                              STATUS_TONE[p.status]
                            }`}
                          >
                            {STATUS_LABELS[p.status]}
                          </span>
                          {p.qualificationScore != null && (
                            <span className="text-[10px] text-primary-500">
                              {p.qualificationScore}/100
                            </span>
                          )}
                        </div>
                        {p.displayName && (
                          <p className="text-xs text-text-muted mt-0.5">
                            {p.displayName}
                          </p>
                        )}
                        {p.signalSummary && (
                          <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">
                            {p.signalSummary}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openThreadPanel(p);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground px-2 py-1 rounded-md hover:bg-sidebar"
                          title="View thread"
                        >
                          <MessagesSquare size={11} />
                          Thread
                        </button>
                        <ProspectRowActions
                          prospect={p}
                          busy={busyId === p.id}
                          onQualify={handleQualify}
                          onDraft={handleDraft}
                          onDelete={handleDelete}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="lg:sticky lg:top-4">
            <ProspectDetail
              prospect={selectedProspect}
              tenantSlug={tenantSlug}
              dms={selectedDms}
              autoOpenReply={autoOpenReply}
              onStatusChange={handleStatus}
              onQualify={handleQualify}
              onDraft={handleDraft}
            />
          </aside>
        </div>
      )}

      {tab === "inbox" && (
        <InboxView
          inbox={inbox}
          prospects={prospects}
          onRead={handleInboxRead}
          onOpenProspect={(pid) => {
            setSelectedProspectId(pid);
            setTab("pipeline");
          }}
        />
      )}

      {tab === "discovery" && (
        <DiscoveryView tenantSlug={tenantSlug} searches={searches} />
      )}

      {tab === "templates" && (
        <TemplatesView tenantSlug={tenantSlug} initial={initialTemplates} />
      )}
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
      setHandle("");
      setDisplayName("");
      setBio("");
      setSignal("");
      setProfileUrl("");
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Plus size={14} />
        Add prospect
      </Button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Add prospect</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted text-xs hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        <div>
          <Label>Platform</Label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as OutboundPlatform)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
          >
            {OUTBOUND_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Handle</Label>
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@sarahbuilds"
          />
        </div>
        <div>
          <Label>Display name</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Sarah Chen"
          />
        </div>
        <div>
          <Label>Profile URL</Label>
          <Input
            value={profileUrl}
            onChange={(e) => setProfileUrl(e.target.value)}
            placeholder="https://instagram.com/sarahbuilds"
          />
        </div>
      </div>
      <div>
        <Label>Bio (optional)</Label>
        <Input
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Freelance brand strategist, helping startups find their voice"
        />
      </div>
      <div>
        <Label>Signal (why did we find them?)</Label>
        <Textarea
          rows={2}
          value={signal}
          onChange={(e) => setSignal(e.target.value)}
          placeholder="Posted about growing their newsletter to 5k. Used hashtag #creatoreconomy"
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={isPending || !handle.trim()}>
          {isPending ? "Adding…" : "Add prospect"}
        </Button>
      </div>
    </div>
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
          <h3 className="text-sm font-semibold text-foreground">
            @{prospect.handle}
          </h3>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">
            {PLATFORM_LABELS[prospect.platform]}
          </span>
          <span
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[prospect.status]}`}
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
                <p className="text-[10px] uppercase tracking-wide text-text-muted">
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
                <span className="text-[10px] text-text-muted ml-auto">
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
      <p className="text-[10px] uppercase tracking-wide text-text-muted">
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
                <span className="text-[10px] uppercase tracking-wide text-text-muted">
                  {message.platform}
                </span>
                <span className="text-[10px] text-text-muted ml-auto">
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
}: {
  tenantSlug: string;
  searches: ProspectSearchRecord[];
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
          {lastRun.candidates === 0 && " · no results came back — try broader keywords"}
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
                    <p className="text-[10px] text-text-muted mt-1">
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
          <code>site:{platform}.com &ldquo;{query || "…"}&rdquo;</code> — include
          quotes in the query itself if you want exact-match.
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
