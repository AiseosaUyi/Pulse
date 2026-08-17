"use client";

// Conversation list: search/filter bar, AI activity digest strip, rows
// (avatar/initials, channel icon, unread badge, assignee tag, resolved
// indicator). Keyboard-focusable native <button> rows — never a
// <div onClick> with no keyboard path.

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Search, RefreshCw } from "lucide-react";
import type { ConversationSummary } from "@/lib/types/conversations";
import { PLATFORM_META, platformMeta } from "./platform-meta";

const LAST_SEEN_AI_KEY = "pulse:conversations:last_seen_ai_activity_at";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ConversationListPane({
  conversations,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
  currentUserId,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  currentUserId: string;
}) {
  const [query, setQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">("open");
  const [digestDismissed, setDigestDismissed] = useState(false);
  const [digestOnly, setDigestOnly] = useState(false);
  const [lastSeenAi, setLastSeenAi] = useState<string | null>(null);

  useEffect(() => {
    // Reads a browser-only API after mount (SSR has no localStorage) —
    // unavoidable direct setState-in-effect for this one read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastSeenAi(window.localStorage.getItem(LAST_SEEN_AI_KEY));
  }, []);

  const unseenAiIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      if (c.lastAiSentAt && (!lastSeenAi || c.lastAiSentAt > lastSeenAi)) set.add(c.id);
    }
    return set;
  }, [conversations, lastSeenAi]);

  function dismissDigest() {
    const latest = conversations.reduce<string | null>((max, c) => {
      if (!c.lastAiSentAt) return max;
      if (!max || c.lastAiSentAt > max) return c.lastAiSentAt;
      return max;
    }, lastSeenAi);
    if (latest) {
      window.localStorage.setItem(LAST_SEEN_AI_KEY, latest);
      setLastSeenAi(latest);
    }
    setDigestDismissed(true);
    setDigestOnly(false);
  }

  const filtered = conversations.filter((c) => {
    if (digestOnly && !unseenAiIds.has(c.id)) return false;
    if (platformFilter !== "all" && c.platform !== platformFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${c.fromName} ${c.fromHandle ?? ""} ${c.lastMessageBody}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <nav aria-label="Conversations" className="w-full md:w-[320px] shrink-0 border-r border-border/50 flex flex-col bg-card md:h-full">
      <div className="p-3 border-b border-border/50 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full text-sm rounded-lg border border-border/50 bg-background pl-8 pr-2.5 py-2 text-foreground focus:outline-none focus:border-primary-500/50 min-h-[44px]"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            aria-label="Filter by channel"
            className="flex-1 text-xs rounded-lg border border-border/50 bg-background px-2 py-2 text-foreground min-h-[44px]"
          >
            <option value="all">All channels</option>
            {Object.entries(PLATFORM_META).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "open" | "resolved" | "all")}
            aria-label="Filter by status"
            className="flex-1 text-xs rounded-lg border border-border/50 bg-background px-2 py-2 text-foreground min-h-[44px]"
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {!digestDismissed && unseenAiIds.size > 0 && (
        <div className="p-3 border-b border-border/50 bg-primary-50 dark:bg-primary-500/10 flex items-start gap-2">
          <Sparkles size={14} className="text-primary-500 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 text-xs text-foreground">
            AI sent {unseenAiIds.size} {unseenAiIds.size === 1 ? "reply" : "replies"} while you were away —{" "}
            <button
              type="button"
              onClick={() => setDigestOnly(true)}
              className="font-semibold text-primary-500 hover:underline"
            >
              review
            </button>
          </div>
          <button
            type="button"
            onClick={dismissDigest}
            aria-label="Dismiss AI activity notice"
            className="text-text-muted hover:text-foreground text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && (
          <div className="p-3 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-white/5 animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
                  <div className="h-2.5 w-1/2 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="p-6 text-center space-y-2">
            <p className="text-sm text-text-secondary">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-500 hover:underline"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-sm font-medium text-foreground mb-1">No conversations yet</p>
            <p className="text-xs text-text-muted">
              {conversations.length === 0
                ? "Inbound messages from your connected channels will show up here."
                : "No conversations match your current filters."}
            </p>
          </div>
        )}

        {filtered.map((c) => {
          const meta = platformMeta(c.platform);
          const Icon = meta.icon;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={selectedId === c.id ? "true" : undefined}
              className={`w-full text-left flex items-start gap-3 p-3 min-h-[44px] border-b border-border/30 transition-colors ${
                selectedId === c.id
                  ? "bg-primary-50 dark:bg-primary-500/10"
                  : c.unreadCount > 0
                  ? "bg-primary-50/40 dark:bg-primary-500/5 hover:bg-primary-50 dark:hover:bg-primary-500/10"
                  : "hover:bg-card-hover"
              }`}
            >
              <div className="h-10 w-10 rounded-full bg-background border border-border/50 flex items-center justify-center text-xs font-semibold text-foreground shrink-0">
                {initials(c.fromName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground truncate">{c.fromName}</span>
                  {c.unreadCount > 0 && (
                    <span className="shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] font-semibold flex items-center justify-center">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
                  <Icon size={11} className={meta.colorClass} aria-hidden />
                  <span className="sr-only">{meta.label}</span>
                  <span className="truncate">{c.lastMessageBody}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] text-text-muted">{timeAgo(c.lastMessageAt)}</span>
                  {c.assignedTo && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-border/40 text-text-secondary">
                      {c.assignedTo === currentUserId ? "You" : "Assigned"}
                    </span>
                  )}
                  {c.status === "resolved" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-green/10 text-status-green">
                      Resolved
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
