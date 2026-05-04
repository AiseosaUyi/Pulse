"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteEngagementItem,
  markAsRead,
  markAsReplied,
  sendEngagementReply,
} from "@/lib/actions/engagement";
import { useDialogs } from "@/components/ui/Dialog";
import {
  ENGAGEMENT_PLATFORM_LABELS,
  ENGAGEMENT_TYPE_LABELS,
  type EngagementItem,
  type EngagementPlatform,
  type EngagementSentiment,
} from "@/lib/types/engagement";

const platformColors: Record<EngagementPlatform, string> = {
  instagram: "text-primary-500",
  tiktok: "text-foreground",
  twitter: "text-status-teal",
  linkedin: "text-blue-500",
};

const sentimentStyles: Record<EngagementSentiment, string> = {
  positive: "bg-status-green/10 text-status-green",
  neutral: "bg-border/50 text-text-muted",
  negative: "bg-status-red/10 text-status-red",
  question: "bg-status-yellow/10 text-status-yellow",
};

const typeIcons: Record<string, string> = {
  dm: "✉",
  comment: "💬",
  mention: "@",
  reply: "↩",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EngagementInbox({ items }: { items: EngagementItem[] }) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  const canReplyVia = (platform: EngagementPlatform, type: string): boolean => {
    if (platform === "instagram") {
      return type === "comment" || type === "mention" || type === "dm";
    }
    if (platform === "linkedin") return type === "comment" || type === "reply";
    return false;
  };

  const onSendReply = (id: string) => {
    if (!draft.trim()) return;
    setReplyError(null);
    startTransition(async () => {
      const res = await sendEngagementReply(id, draft);
      if (res.success) {
        setOpenReplyId(null);
        setDraft("");
      } else {
        setReplyError(res.error);
      }
    });
  };

  if (items.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border/50 p-8 max-w-[720px] mx-auto">
        <p className="text-sm text-foreground font-semibold mb-2">
          Inbox is empty
        </p>
        <p className="text-text-secondary text-xs leading-relaxed">
          This is the unified inbox for comments, DMs, and @-mentions across IG,
          TikTok, X, and LinkedIn. Pulse can&apos;t auto-pull them yet —
          that needs Meta Messenger Webhook approval + TikTok Business API access
          (both free but require app review, a few days each).
        </p>
        <p className="text-text-secondary text-xs leading-relaxed mt-2">
          Until then, use <span className="font-medium text-foreground">Log Message</span>{" "}
          top-right to mirror in a notable comment or DM so it doesn&apos;t get lost.
          Replies you log on a prospect from the Outbound tab also surface here.
        </p>
      </div>
    );
  }

  const onToggleRead = (id: string, read: boolean) => {
    startTransition(() => {
      markAsRead(id, !read);
    });
  };

  const onToggleReplied = (id: string, replied: boolean) => {
    startTransition(() => {
      markAsReplied(id, !replied);
    });
  };

  const onDelete = async (id: string) => {
    const ok = await dialogs.confirm({
      title: "Delete this message?",
      subtitle:
        "The engagement item will be removed from the inbox permanently.",
      tone: "destructive",
      confirmLabel: "Delete message",
    });
    if (!ok) return;
    startTransition(() => {
      deleteEngagementItem(id);
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
      <div className="divide-y divide-border/30">
        {items.map((item) => (
          <div
            key={item.id}
            className={`p-5 hover:bg-card-hover transition-colors ${!item.read ? "bg-primary-50" : ""}`}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-lg flex-shrink-0">
                {item.fromAvatar ?? "👤"}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-foreground text-sm font-semibold">{item.fromName}</span>
                  {item.fromHandle && (
                    <span className="text-text-muted text-xs">{item.fromHandle}</span>
                  )}
                  <span className="text-text-muted text-xs">·</span>
                  <span className={`text-xs font-medium ${platformColors[item.platform]}`}>
                    {ENGAGEMENT_PLATFORM_LABELS[item.platform]}
                  </span>
                  <span className="text-text-muted text-xs">·</span>
                  <span className="text-text-muted text-xs">{timeAgo(item.receivedAt)}</span>
                  {!item.read && (
                    <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
                  )}
                </div>

                <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
                  {item.content}
                </p>

                {item.postTitle && (
                  <p className="text-text-muted text-xs mt-1">
                    On: <span className="text-text-secondary">{item.postTitle}</span>
                  </p>
                )}

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-text-muted">
                    {typeIcons[item.type]} {ENGAGEMENT_TYPE_LABELS[item.type]}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${sentimentStyles[item.sentiment]}`}
                  >
                    {item.sentiment}
                  </span>
                  {item.externalUrl && (
                    <a
                      href={item.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] px-1.5 py-0.5 rounded text-text-muted hover:text-foreground underline-offset-2 hover:underline"
                    >
                      Open original
                    </a>
                  )}

                  <div className="flex-1" />

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onToggleRead(item.id, item.read)}
                    className="text-[10px] px-2 py-1 rounded border border-border/50 text-text-secondary hover:border-primary-500/50 hover:text-primary-500 transition-colors disabled:opacity-50"
                  >
                    {item.read ? "Mark unread" : "Mark read"}
                  </button>

                  {canReplyVia(item.platform, item.type) && !item.replied && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setOpenReplyId(
                          openReplyId === item.id ? null : item.id
                        );
                        setDraft("");
                        setReplyError(null);
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 transition-colors disabled:opacity-50 font-medium"
                    >
                      Reply
                    </button>
                  )}

                  {item.replied ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onToggleReplied(item.id, item.replied)}
                      className="text-[10px] px-2 py-1 rounded bg-status-green/10 text-status-green hover:bg-status-green/20 transition-colors disabled:opacity-50"
                    >
                      Replied ✓
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onToggleReplied(item.id, item.replied)}
                      className="text-[10px] px-2 py-1 rounded bg-primary-50 text-primary-500 hover:bg-primary-500/15 transition-colors disabled:opacity-50 font-medium"
                    >
                      Mark replied
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onDelete(item.id)}
                    className="p-1 rounded text-text-muted hover:text-status-red transition-colors disabled:opacity-50"
                    aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {openReplyId === item.id && (
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={`Reply via ${ENGAGEMENT_PLATFORM_LABELS[item.platform]}…`}
                      rows={3}
                      className="w-full text-sm rounded border border-border/50 bg-background p-2 text-foreground focus:outline-none focus:border-primary-500/50"
                      disabled={isPending}
                    />
                    {replyError && (
                      <p className="text-xs text-status-red">{replyError}</p>
                    )}
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setOpenReplyId(null);
                          setDraft("");
                        }}
                        className="text-[11px] px-3 py-1.5 rounded border border-border/50 text-text-secondary hover:border-foreground/30"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isPending || !draft.trim()}
                        onClick={() => onSendReply(item.id)}
                        className="text-[11px] px-3 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-500/90 disabled:opacity-50 font-medium"
                      >
                        {isPending ? "Sending…" : "Send reply"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
