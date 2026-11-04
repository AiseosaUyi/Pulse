"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Send,
  CalendarClock,
  UserPlus,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  Clock,
  Search,
  Settings,
} from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OwnerChip } from "@/components/dashboard/OwnerChip";
import { PriorityChip } from "@/components/dashboard/PriorityChip";
import type {
  MyDayData,
  ReplyNowItem,
  ReadyToSendItem,
  FollowUpTodayItem,
  FindContactItem,
} from "@/lib/services/my-day";
import { fetchMyDayAction } from "@/lib/actions/my-day";
import {
  markProspectSentAction,
  setProspectContactAction,
  setProspectOwnerAction,
  setProspectPriorityAction,
  markInboundRead,
} from "@/lib/actions/outbound";
import { setRowStatus, setRowOwner } from "@/lib/actions/action-queue";
import { snoozeFollowUp, clearFollowUp } from "@/lib/actions/conversation-intelligence";

const LOCAL_STORAGE_KEY = "pulse-my-day-person";

export function MyDayView({
  initialData,
  tenantSlug,
  currentUserName,
}: {
  initialData: MyDayData;
  tenantSlug: string;
  currentUserName?: string | null;
}) {
  const [data, setData] = useState<MyDayData>(initialData);
  const [selectedPerson, setSelectedPerson] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(LOCAL_STORAGE_KEY) || initialData.owner || "all";
    }
    return initialData.owner || "all";
  });
  const [, startTransition] = useTransition();

  // Collapsed states per section
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    replyNow: false,
    readyToSend: false,
    followUp: false,
    findContact: false,
    scoreboard: false,
  });
  const [waitingOnAiseOpen, setWaitingOnAiseOpen] = useState(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Section d contact inputs: prospectId -> string
  const [contactInputs, setContactInputs] = useState<Record<string, string>>({});
  const [savingContactId, setSavingContactId] = useState<string | null>(null);

  // Snooze dropdown open: itemId -> boolean
  const [snoozeMenuOpenId, setSnoozeMenuOpenId] = useState<string | null>(null);

  // Initialize selected person on mount from localStorage or user mapping
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      if (saved !== initialData.owner) {
        startTransition(async () => {
          setSelectedPerson(saved);
          const fresh = await fetchMyDayAction(saved);
          if (fresh) setData(fresh);
        });
      }
    } else if (currentUserName) {
      const match = initialData.team.find(
        (m) => m.name.toLowerCase() === currentUserName.toLowerCase()
      );
      if (match) {
        localStorage.setItem(LOCAL_STORAGE_KEY, match.name);
        startTransition(async () => {
          setSelectedPerson(match.name);
          const fresh = await fetchMyDayAction(match.name);
          if (fresh) setData(fresh);
        });
      }
    }
  }, [currentUserName, initialData.owner, initialData.team]);

  // List of team members
  const teamMemberNames = useMemo(() => {
    const names = data.team.map((m) => m.name);
    // Ensure default roster is present if unmigrated
    if (names.length === 0) {
      return ["Aise", "Abas", "Abdul", "Olamide", "Ambassador 1", "Ambassador 2"];
    }
    return names;
  }, [data.team]);

  function switchPerson(newPerson: string) {
    setSelectedPerson(newPerson);
    localStorage.setItem(LOCAL_STORAGE_KEY, newPerson);
    startTransition(async () => {
      const fresh = await fetchMyDayAction(newPerson);
      if (fresh) setData(fresh);
    });
  }

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function triggerCopy(id: string, text: string, label = "Copied to clipboard") {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      toast.success(label);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  // ── Section a: Reply Now Handlers ─────────────────────────────────────────

  function handleMarkHandled(item: ReplyNowItem) {
    // Optimistic removal
    setData((prev) => ({
      ...prev,
      replyNow: prev.replyNow.filter((r) => r.id !== item.id),
      waitingOnAise: prev.waitingOnAise.filter((r) => r.id !== item.id),
    }));

    startTransition(async () => {
      if (item.source === "inbound_message") {
        const res = await markInboundRead(tenantSlug, item.id);
        if (!res.success) toast.error("Failed to mark handled", res.error);
        else toast.success("Marked handled");
      } else {
        const res = await setRowStatus({ source: item.source, id: item.id }, "resolved");
        if (!res.success) toast.error("Failed to mark handled", res.error);
        else toast.success("Marked handled");
      }
    });
  }

  function handleReassignReply(item: ReplyNowItem, newOwner: string | null) {
    setData((prev) => {
      const update = (list: ReplyNowItem[]) =>
        list.map((r) => (r.id === item.id ? { ...r, owner: newOwner } : r));
      return {
        ...prev,
        replyNow: selectedPerson === "all" ? update(prev.replyNow) : prev.replyNow.filter((r) => r.id !== item.id),
        waitingOnAise: selectedPerson === "all" ? update(prev.waitingOnAise) : prev.waitingOnAise.filter((r) => r.id !== item.id),
      };
    });

    startTransition(async () => {
      if (item.source === "inbound_message") {
        if (item.prospectId) {
          await setProspectOwnerAction(tenantSlug, item.prospectId, newOwner);
        }
      } else {
        await setRowOwner({ source: item.source, id: item.id }, newOwner);
      }
      toast.success(newOwner ? `Reassigned to ${newOwner}` : "Unassigned");
    });
  }

  // ── Section b: Ready to send Handlers ──────────────────────────────────────

  function handleMarkSent(item: ReadyToSendItem) {
    const sender = selectedPerson !== "all" ? selectedPerson : currentUserName ?? null;
    setData((prev) => ({
      ...prev,
      readyToSend: prev.readyToSend.filter((r) => r.id !== item.id),
      scoreboard: {
        ...prev.scoreboard,
        messagesSent: prev.scoreboard.messagesSent + 1,
      },
    }));

    startTransition(async () => {
      const res = await markProspectSentAction(tenantSlug, item.id, sender);
      if (!res.success) {
        toast.error("Couldn't record sent status", res.error);
      } else {
        toast.success(`Marked sent by ${sender || "team"}`);
      }
    });
  }

  function handleReassignReady(item: ReadyToSendItem, newOwner: string | null) {
    setData((prev) => ({
      ...prev,
      readyToSend:
        selectedPerson === "all"
          ? prev.readyToSend.map((r) => (r.id === item.id ? { ...r, owner: newOwner } : r))
          : prev.readyToSend.filter((r) => r.id !== item.id),
    }));

    startTransition(async () => {
      await setProspectOwnerAction(tenantSlug, item.id, newOwner);
      toast.success(newOwner ? `Reassigned to ${newOwner}` : "Unassigned");
    });
  }

  function handlePriorityChangeReady(item: ReadyToSendItem, newPriority: string) {
    setData((prev) => ({
      ...prev,
      readyToSend: prev.readyToSend.map((r) => (r.id === item.id ? { ...r, priority: newPriority } : r)),
    }));

    startTransition(async () => {
      await setProspectPriorityAction(tenantSlug, item.id, newPriority);
    });
  }

  // ── Section c: Follow up Handlers ─────────────────────────────────────────

  function handleSnoozeFollowUp(item: FollowUpTodayItem, days: number) {
    setSnoozeMenuOpenId(null);
    setData((prev) => ({
      ...prev,
      followUpToday: prev.followUpToday.filter((f) => f.id !== item.id),
    }));

    startTransition(async () => {
      if (item.source === "prospect" && item.prospectId) {
        await snoozeFollowUp(tenantSlug, item.prospectId, days);
      } else {
        const snoozedUntil = new Date(Date.now() + days * 86400000).toISOString();
        await setRowStatus({ source: "action", id: item.id }, "snoozed", { snoozedUntil });
      }
      toast.success(`Snoozed for ${days} day${days === 1 ? "" : "s"}`);
    });
  }

  function handleDoneFollowUp(item: FollowUpTodayItem) {
    setData((prev) => ({
      ...prev,
      followUpToday: prev.followUpToday.filter((f) => f.id !== item.id),
    }));

    startTransition(async () => {
      if (item.source === "prospect" && item.prospectId) {
        await clearFollowUp(tenantSlug, item.prospectId);
      } else {
        await setRowStatus({ source: "action", id: item.id }, "resolved");
      }
      toast.success("Follow-up completed");
    });
  }

  // ── Section d: Find contact Handlers ──────────────────────────────────────

  function handleSaveContact(item: FindContactItem) {
    const val = (contactInputs[item.id] ?? "").trim();
    if (!val) {
      toast.error("Please enter a handle, number or email");
      return;
    }

    setSavingContactId(item.id);
    startTransition(async () => {
      const res = await setProspectContactAction(tenantSlug, item.id, val);
      setSavingContactId(null);
      if (!res.success) {
        toast.error("Failed to save contact", res.error);
      } else {
        toast.success("Contact saved · moving to Ready to send");
        // Refetch to cleanly move between sections
        const fresh = await fetchMyDayAction(selectedPerson);
        if (fresh) setData(fresh);
      }
    });
  }

  // ── Scoreboard Calculations ───────────────────────────────────────────────
  const { scoreboard } = data;
  const targets = scoreboard.targets;

  const targetEvents = targets.eventsCreated ?? 25;
  const targetConvs = targets.conversations ?? 40;
  const targetReach = targets.reachOuts ?? 100;
  const targetOrganic = targets.organicDms ?? 20;

  return (
    <div className="space-y-6">
      {/* ── Person Switcher ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/40">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
          <button
            type="button"
            onClick={() => switchPerson("all")}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap",
              selectedPerson === "all"
                ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                : "border-border/60 bg-card text-text-secondary hover:text-foreground hover:bg-card-hover"
            )}
          >
            Everyone
          </button>
          {teamMemberNames.map((name) => {
            const isSelected = selectedPerson.toLowerCase() === name.toLowerCase();
            return (
              <button
                key={name}
                type="button"
                onClick={() => switchPerson(name)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap",
                  isSelected
                    ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                    : "border-border/60 bg-card text-text-secondary hover:text-foreground hover:bg-card-hover"
                )}
              >
                {name}
              </button>
            );
          })}
        </div>

        <Link
          href="/settings/team"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground self-start sm:self-center transition-colors"
        >
          <Settings size={13} />
          <span>Team settings</span>
        </Link>
      </div>

      {/* ── One-line Summary ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3 shadow-xs">
        <p className="text-sm font-medium text-foreground tracking-tight">
          {data.summary}
        </p>
      </div>

      {/* ── Section A: Reply now ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div
          onClick={() => toggleSection("replyNow")}
          className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-card-hover transition-colors border-b border-border/40"
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-primary-500" />
            <h2 className="text-sm font-semibold text-foreground">Reply now</h2>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-bold",
                data.replyNow.length > 0
                  ? "bg-primary-500/15 text-primary-500"
                  : "bg-sidebar text-text-muted"
              )}
            >
              {data.replyNow.length}
            </span>
          </div>
          {collapsed.replyNow ? (
            <ChevronRight size={16} className="text-text-muted" />
          ) : (
            <ChevronDown size={16} className="text-text-muted" />
          )}
        </div>

        {!collapsed.replyNow && (
          <div className="divide-y divide-border/30">
            {data.replyNow.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto text-status-green mb-1.5 opacity-80" />
                <p className="text-sm font-medium text-foreground">No replies waiting</p>
                <p className="text-xs text-text-muted mt-0.5">Every message has been answered.</p>
              </div>
            ) : (
              data.replyNow.map((item) => (
                <div key={item.id} className="p-4 hover:bg-sidebar/30 transition-colors space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">
                        {item.displayName || `@${item.handle}`}
                      </span>
                      {item.displayName && (
                        <span className="text-xs text-text-muted">@{item.handle}</span>
                      )}
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border/50 bg-sidebar text-text-muted">
                        {item.platform}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] font-medium px-2 py-0.5 rounded-full",
                          item.isUrgentWait
                            ? "bg-status-red/15 text-status-red border border-status-red/30 font-semibold"
                            : "text-text-muted"
                        )}
                      >
                        waited {item.daysWaited}d{item.isUrgentWait ? " (urgent)" : ""}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <OwnerChip
                        owner={item.owner}
                        teamMembers={teamMemberNames}
                        onChange={(newOwner) => handleReassignReply(item, newOwner)}
                        compact
                      />
                    </div>
                  </div>

                  {/* Message body line */}
                  <p className="text-xs text-foreground/90 line-clamp-2 bg-sidebar/50 rounded-lg p-2 border border-border/30">
                    &ldquo;{item.body}&rdquo;
                  </p>

                  {/* Proposed reply if available */}
                  {item.proposedReply && (
                    <div className="flex items-center justify-between gap-2 bg-primary-500/5 border border-primary-500/20 rounded-lg p-2">
                      <p className="text-xs text-foreground/90 italic truncate">
                        Draft: &ldquo;{item.proposedReply}&rdquo;
                      </p>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => triggerCopy(item.id, item.proposedReply!, "Reply copied")}
                        className="shrink-0 text-primary-500 hover:text-primary-600"
                      >
                        {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedId === item.id ? "Copied" : "Copy"}</span>
                      </Button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {item.externalUrl ? (
                      <a
                        href={item.externalUrl}
                        target={item.externalUrl.startsWith("http") ? "_blank" : undefined}
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline"
                      >
                        <ExternalLink size={12} />
                        <span>Open thread</span>
                      </a>
                    ) : item.prospectId ? (
                      <Link
                        href={`/leads?prospect=${item.prospectId}`}
                        className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline"
                      >
                        <ExternalLink size={12} />
                        <span>Open lead</span>
                      </Link>
                    ) : <span />}

                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleMarkHandled(item)}
                      className="border-status-green/30 text-status-green hover:bg-status-green/10"
                    >
                      <Check size={12} />
                      <span>Mark handled</span>
                    </Button>
                  </div>
                </div>
              ))
            )}

            {/* Waiting on Aise collapsible sub-section */}
            {data.waitingOnAise.length > 0 && (
              <div className="border-t border-border/40 bg-sidebar/20 p-3">
                <button
                  type="button"
                  onClick={() => setWaitingOnAiseOpen((v) => !v)}
                  className="flex items-center justify-between w-full text-xs text-text-muted hover:text-foreground font-medium"
                >
                  <span>Waiting on Aise ({data.waitingOnAise.length})</span>
                  {waitingOnAiseOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>

                {waitingOnAiseOpen && (
                  <div className="mt-2 space-y-2">
                    {data.waitingOnAise.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-lg border border-border/30 bg-card text-xs flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">
                            {item.displayName || `@${item.handle}`} · {item.platform}
                          </p>
                          <p className="text-text-muted truncate mt-0.5">&ldquo;{item.body}&rdquo;</p>
                        </div>
                        <OwnerChip
                          owner={item.owner}
                          teamMembers={teamMemberNames}
                          onChange={(newOwner) => handleReassignReply(item, newOwner)}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section B: Ready to send ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div
          onClick={() => toggleSection("readyToSend")}
          className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-card-hover transition-colors border-b border-border/40"
        >
          <div className="flex items-center gap-2">
            <Send size={16} className="text-primary-500" />
            <h2 className="text-sm font-semibold text-foreground">Ready to send</h2>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-bold",
                data.readyToSend.length > 0
                  ? "bg-status-green/15 text-status-green"
                  : "bg-sidebar text-text-muted"
              )}
            >
              {data.readyToSend.length}
            </span>
          </div>
          {collapsed.readyToSend ? (
            <ChevronRight size={16} className="text-text-muted" />
          ) : (
            <ChevronDown size={16} className="text-text-muted" />
          )}
        </div>

        {!collapsed.readyToSend && (
          <div className="divide-y divide-border/30">
            {data.readyToSend.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto text-status-green mb-1.5 opacity-80" />
                <p className="text-sm font-medium text-foreground">No leads ready to send</p>
                <p className="text-xs text-text-muted mt-0.5">Approved leads with verified contacts will appear here.</p>
              </div>
            ) : (
              data.readyToSend.map((item) => (
                <div key={item.id} className="p-4 hover:bg-sidebar/30 transition-colors space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PriorityChip
                        priority={item.priority}
                        editable
                        onChange={(p) => handlePriorityChangeReady(item, p)}
                      />
                      <span className="text-sm font-semibold text-foreground">{item.name}</span>
                      <span className="text-xs text-text-muted">@{item.handle}</span>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border/50 bg-sidebar text-text-muted">
                        {item.channel}: {item.contact}
                      </span>
                    </div>

                    <OwnerChip
                      owner={item.owner}
                      teamMembers={teamMemberNames}
                      onChange={(newOwner) => handleReassignReady(item, newOwner)}
                      compact
                    />
                  </div>

                  {/* Approved message text box with copy button */}
                  <div className="rounded-lg border border-border/50 bg-sidebar/50 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Approved message to send:
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => triggerCopy(item.id, item.approvedMessage, "Message copied")}
                        className="text-primary-500 hover:text-primary-600"
                      >
                        {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedId === item.id ? "Copied!" : "Copy message"}</span>
                      </Button>
                    </div>
                    <p className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed bg-card p-2.5 rounded border border-border/30">
                      {item.approvedMessage}
                    </p>
                  </div>

                  {/* Footer actions */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Link
                      href={`/leads?prospect=${item.id}`}
                      className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary-500 transition-colors"
                    >
                      <ExternalLink size={12} />
                      <span>View full lead</span>
                    </Link>

                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleMarkSent(item)}
                      className="bg-status-green hover:bg-status-green/90 text-white font-semibold text-xs"
                    >
                      <Check size={13} />
                      <span>Mark sent</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Section C: Follow up today ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div
          onClick={() => toggleSection("followUp")}
          className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-card-hover transition-colors border-b border-border/40"
        >
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-primary-500" />
            <h2 className="text-sm font-semibold text-foreground">Follow up today</h2>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-bold",
                data.followUpToday.length > 0
                  ? "bg-amber-500/15 text-amber-500"
                  : "bg-sidebar text-text-muted"
              )}
            >
              {data.followUpToday.length}
            </span>
          </div>
          {collapsed.followUp ? (
            <ChevronRight size={16} className="text-text-muted" />
          ) : (
            <ChevronDown size={16} className="text-text-muted" />
          )}
        </div>

        {!collapsed.followUp && (
          <div className="divide-y divide-border/30">
            {data.followUpToday.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto text-status-green mb-1.5 opacity-80" />
                <p className="text-sm font-medium text-foreground">No follow-ups due</p>
                <p className="text-xs text-text-muted mt-0.5">All scheduled follow-ups are completed.</p>
              </div>
            ) : (
              data.followUpToday.map((item) => (
                <div key={item.id} className="p-4 hover:bg-sidebar/30 transition-colors space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{item.name}</span>
                      <span className="text-xs text-text-muted">@{item.handle}</span>
                      <span
                        className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
                          item.daysOverdue > 0
                            ? "bg-status-red/15 text-status-red border border-status-red/30"
                            : "bg-sidebar text-text-muted border border-border"
                        )}
                      >
                        {item.daysOverdue > 0 ? `${item.daysOverdue}d overdue` : "Due today"}
                      </span>
                      {item.isFinalAttempt && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-status-red text-white">
                          Final attempt
                        </span>
                      )}
                    </div>

                    <OwnerChip
                      owner={item.owner}
                      teamMembers={teamMemberNames}
                      compact
                    />
                  </div>

                  <p className="text-xs text-text-secondary bg-sidebar/50 rounded-lg p-2 border border-border/30">
                    <span className="font-semibold text-foreground">Suggested step: </span>
                    {item.suggestedNextStep}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    {item.externalUrl ? (
                      <Link
                        href={item.externalUrl}
                        className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline"
                      >
                        <ExternalLink size={12} />
                        <span>View thread</span>
                      </Link>
                    ) : <span />}

                    <div className="flex items-center gap-2 relative">
                      <button
                        type="button"
                        onClick={() =>
                          setSnoozeMenuOpenId((cur) => (cur === item.id ? null : item.id))
                        }
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border bg-card text-text-secondary hover:text-foreground hover:bg-card-hover transition-colors"
                      >
                        <Clock size={12} />
                        <span>Snooze</span>
                        <ChevronDown size={11} />
                      </button>

                      {snoozeMenuOpenId === item.id && (
                        <div className="absolute right-12 bottom-full mb-1 z-20 min-w-[110px] rounded-lg border border-border bg-card shadow-xl py-1 text-xs">
                          <button
                            type="button"
                            onClick={() => handleSnoozeFollowUp(item, 1)}
                            className="block w-full text-left px-3 py-1.5 hover:bg-card-hover text-foreground"
                          >
                            +1 day
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnoozeFollowUp(item, 3)}
                            className="block w-full text-left px-3 py-1.5 hover:bg-card-hover text-foreground"
                          >
                            +3 days
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnoozeFollowUp(item, 7)}
                            className="block w-full text-left px-3 py-1.5 hover:bg-card-hover text-foreground"
                          >
                            +1 week
                          </button>
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleDoneFollowUp(item)}
                        className="border-status-green/30 text-status-green hover:bg-status-green/10"
                      >
                        <Check size={12} />
                        <span>Done</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Section D: Find the contact ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div
          onClick={() => toggleSection("findContact")}
          className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-card-hover transition-colors border-b border-border/40"
        >
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-primary-500" />
            <h2 className="text-sm font-semibold text-foreground">Find the contact</h2>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-bold",
                data.findContact.length > 0
                  ? "bg-primary-500/15 text-primary-500"
                  : "bg-sidebar text-text-muted"
              )}
            >
              {data.findContact.length}
            </span>
          </div>
          {collapsed.findContact ? (
            <ChevronRight size={16} className="text-text-muted" />
          ) : (
            <ChevronDown size={16} className="text-text-muted" />
          )}
        </div>

        {!collapsed.findContact && (
          <div className="divide-y divide-border/30">
            {data.findContact.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto text-status-green mb-1.5 opacity-80" />
                <p className="text-sm font-medium text-foreground">All leads have contacts</p>
                <p className="text-xs text-text-muted mt-0.5">No missing contact details on qualified leads.</p>
              </div>
            ) : (
              data.findContact.map((item) => (
                <div key={item.id} className="p-4 hover:bg-sidebar/30 transition-colors space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PriorityChip priority={item.priority} />
                      <span className="text-sm font-semibold text-foreground">{item.name}</span>
                      <span className="text-xs text-text-muted">@{item.handle}</span>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border/50 bg-sidebar text-text-muted">
                        {item.status}
                      </span>
                    </div>

                    <OwnerChip
                      owner={item.owner}
                      teamMembers={teamMemberNames}
                      compact
                    />
                  </div>

                  {/* Input row */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="Paste Instagram handle (@...), WhatsApp (+234...), or email"
                      value={contactInputs[item.id] ?? ""}
                      onChange={(e) =>
                        setContactInputs((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="flex-1 rounded-md border border-border/70 bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-text-muted outline-none focus-visible:border-primary-500 focus-visible:ring-1 focus-visible:ring-primary-500/30"
                    />

                    <div className="flex items-center gap-2 shrink-0">
                      {item.sourceUrl && (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border bg-card text-text-secondary hover:text-foreground hover:bg-card-hover transition-colors"
                        >
                          <Search size={12} />
                          <span>Source</span>
                        </a>
                      )}

                      <Button
                        variant="default"
                        size="xs"
                        disabled={savingContactId === item.id}
                        onClick={() => handleSaveContact(item)}
                        className="bg-primary-500 hover:bg-primary-600 text-white font-semibold"
                      >
                        {savingContactId === item.id ? "Saving…" : "Save contact"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Section E: This week's scoreboard ────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div
          onClick={() => toggleSection("scoreboard")}
          className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-card-hover transition-colors border-b border-border/40"
        >
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-primary-500" />
            <h2 className="text-sm font-semibold text-foreground">
              This week&apos;s scoreboard (Monday – Sunday)
            </h2>
          </div>
          {collapsed.scoreboard ? (
            <ChevronRight size={16} className="text-text-muted" />
          ) : (
            <ChevronDown size={16} className="text-text-muted" />
          )}
        </div>

        {!collapsed.scoreboard && (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Messages sent */}
            <div className="rounded-xl border border-border/50 bg-sidebar/30 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-text-secondary">Messages sent</span>
                <span className="font-bold text-foreground">
                  {scoreboard.messagesSent} / {targetReach}
                </span>
              </div>
              <div className="w-full bg-border/50 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (scoreboard.messagesSent / targetReach) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Replies received */}
            <div className="rounded-xl border border-border/50 bg-sidebar/30 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-text-secondary">Replies received</span>
                <span className="font-bold text-foreground">
                  {scoreboard.repliesReceived} / {targetConvs}
                </span>
              </div>
              <div className="w-full bg-border/50 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (scoreboard.repliesReceived / targetConvs) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Calls booked */}
            <div className="rounded-xl border border-border/50 bg-sidebar/30 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-text-secondary">Calls booked</span>
                <span className="font-bold text-foreground">
                  {scoreboard.callsBooked} / {targetOrganic}
                </span>
              </div>
              <div className="w-full bg-border/50 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (scoreboard.callsBooked / targetOrganic) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Events created */}
            <div className="rounded-xl border border-border/50 bg-sidebar/30 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-text-secondary">Events created</span>
                <span className="font-bold text-foreground">
                  {scoreboard.eventsCreated} / {targetEvents}
                </span>
              </div>
              <div className="w-full bg-border/50 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-status-green h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (scoreboard.eventsCreated / targetEvents) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
