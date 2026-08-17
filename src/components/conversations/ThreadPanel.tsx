"use client";

// Thread pane: header (name, channel badge, assign/resolve), message list,
// composer. Polls the thread every 15s while open. Session-authed via
// /api/conversations/thread (RLS applies).

import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus, UserMinus, CheckCircle2, RotateCcw, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { sendEngagementReply } from "@/lib/actions/engagement";
import {
  sendInboundMessageReply,
  assignConversation,
  setConversationStatus,
} from "@/lib/actions/inbound-messages";
import type { ConversationThread, ConversationStatus } from "@/lib/types/conversations";
import { platformMeta } from "./platform-meta";
import { MessageBubble, type BubbleData } from "./MessageBubble";
import { Composer } from "./Composer";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 15000;

interface PendingSend {
  id: string;
  body: string;
  status: "sending" | "failed";
}

export function ThreadPanel({
  conversationId,
  currentUserId,
  onBack,
  onConversationsChanged,
}: {
  conversationId: string;
  currentUserId: string;
  /** Present only on mobile drill-down — renders the back arrow. */
  onBack?: () => void;
  /** Lets the list pane refresh sooner than its own poll after a local action. */
  onConversationsChanged?: () => void;
}) {
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [optimistic, setOptimistic] = useState<{
    assignedTo?: string | null;
    status?: ConversationStatus;
  } | null>(null);
  const [, startActionTransition] = useTransition();
  const sendCounter = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/conversations/thread?id=${encodeURIComponent(conversationId)}`);
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as ConversationThread;
        setThread(data);
        setOptimistic(null);
        setError(null);
      } catch {
        setError("Couldn't load this conversation");
      } finally {
        setLoading(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    setThread(null);
    setPending([]);
    setOptimistic(null);
    fetchThread(false);
    const iv = setInterval(() => fetchThread(true), POLL_MS);
    return () => clearInterval(iv);
  }, [conversationId, fetchThread]);

  // Focus management: selecting a conversation moves focus to the thread
  // panel's heading (not silently left in the list, not force-focused
  // into the composer input, which would be surprising).
  useEffect(() => {
    // Keyed only on the conversation id, not the whole `thread` object,
    // which gets a new reference on every 15s poll — refocusing the
    // heading on every poll would steal focus from whatever the user is
    // doing (typing a reply, reading, etc).
    headingRef.current?.focus();
  }, [thread?.conversation.id]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, pending.length]);

  async function attemptSend(body: string, existingId?: string): Promise<boolean> {
    const id = existingId ?? `pending-${++sendCounter.current}`;
    setPending((prev) => {
      if (prev.some((p) => p.id === id)) {
        return prev.map((p) => (p.id === id ? { ...p, status: "sending" } : p));
      }
      return [...prev, { id, body, status: "sending" }];
    });

    if (!thread) return false;
    const { conversation } = thread;
    const result =
      conversation.source === "whatsapp"
        ? await sendInboundMessageReply(conversation.latestRowId, body)
        : await sendEngagementReply(conversation.latestRowId, body);

    if (result.success) {
      setPending((prev) => prev.filter((p) => p.id !== id));
      toast.success("Reply sent");
      fetchThread(true);
      onConversationsChanged?.();
      return true;
    }

    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, status: "failed" } : p)));
    toast.error("Couldn't send message", result.error);
    return false;
  }

  function handleAssignToggle() {
    if (!thread) return;
    const isMine = displayed().assignedTo === currentUserId;
    const prevAssignedTo = displayed().assignedTo;
    setOptimistic((o) => ({ ...o, assignedTo: isMine ? null : currentUserId }));
    startActionTransition(async () => {
      const res = await assignConversation(thread.conversation.id, isMine ? null : "me");
      if (!res.success) {
        setOptimistic((o) => ({ ...o, assignedTo: prevAssignedTo }));
        toast.error("Couldn't update assignment", res.error);
      } else {
        onConversationsChanged?.();
      }
    });
  }

  function handleStatusToggle() {
    if (!thread) return;
    const isResolved = displayed().status === "resolved";
    const prevStatus = displayed().status;
    const next: ConversationStatus = isResolved ? "open" : "resolved";
    setOptimistic((o) => ({ ...o, status: next }));
    startActionTransition(async () => {
      const res = await setConversationStatus(thread.conversation.id, next);
      if (!res.success) {
        setOptimistic((o) => ({ ...o, status: prevStatus }));
        toast.error("Couldn't update status", res.error);
      } else {
        onConversationsChanged?.();
      }
    });
  }

  function displayed() {
    if (!thread) return { assignedTo: null as string | null, status: "open" as ConversationStatus };
    return {
      assignedTo: optimistic?.assignedTo !== undefined ? optimistic.assignedTo : thread.conversation.assignedTo,
      status: optimistic?.status ?? thread.conversation.status,
    };
  }

  if (loading && !thread) {
    return (
      <div role="main" aria-label="Conversation thread" className="flex-1 flex flex-col bg-card">
        <div className="p-4 border-b border-border/50 h-16 bg-gray-100 dark:bg-white/5 animate-pulse" />
        <div className="flex-1 p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-10 rounded-2xl bg-gray-100 dark:bg-white/5 animate-pulse ${
                i % 2 === 0 ? "w-2/3" : "w-1/2 ml-auto"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error && !thread) {
    return (
      <div role="main" aria-label="Conversation thread" className="flex-1 flex flex-col items-center justify-center gap-3 bg-card p-8 text-center">
        <p className="text-sm text-text-secondary">{error}</p>
        <button
          type="button"
          onClick={() => fetchThread(false)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-500 hover:underline"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (!thread) return null;

  const { conversation } = thread;
  const meta = platformMeta(conversation.platform);
  const Icon = meta.icon;
  const state = displayed();
  const isMine = state.assignedTo === currentUserId;
  const isResolved = state.status === "resolved";

  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
  const windowClosed =
    conversation.platform === "whatsapp" &&
    !!lastInbound &&
    Date.now() - new Date(lastInbound.createdAt).getTime() > WHATSAPP_WINDOW_MS;

  const bubbles: BubbleData[] = [
    ...thread.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      sentBy: m.sentBy,
      createdAt: m.createdAt,
      state: "sent" as const,
    })),
    ...pending.map((p) => ({
      id: p.id,
      direction: "outbound" as const,
      body: p.body,
      sentBy: "human" as const,
      createdAt: null,
      state: p.status,
    })),
  ];

  return (
    <div role="main" aria-label="Conversation thread" className="flex-1 flex flex-col bg-card min-w-0">
      <div className="p-4 border-b border-border/50 flex items-center gap-3 flex-wrap">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversation list"
            className="md:hidden shrink-0 h-11 w-11 -ml-2 flex items-center justify-center rounded-full hover:bg-background text-foreground"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-foreground font-semibold text-base truncate outline-none"
          >
            {conversation.fromName}
          </h2>
          <div className={`flex items-center gap-1 text-xs ${meta.colorClass}`}>
            <Icon size={12} aria-hidden />
            <span>{meta.label}</span>
            {isResolved && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-green/10 text-status-green">
                Resolved
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleAssignToggle}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full text-xs font-medium border border-border/50 text-text-secondary hover:border-primary-500/50 hover:text-primary-500 transition-colors"
          >
            {isMine ? <UserMinus size={13} /> : <UserPlus size={13} />}
            {isMine ? "Unassign" : "Assign to me"}
          </button>
          <button
            type="button"
            onClick={handleStatusToggle}
            className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full text-xs font-medium transition-colors ${
              isResolved
                ? "border border-border/50 text-text-secondary hover:text-foreground"
                : "bg-status-green/10 text-status-green hover:bg-status-green/20"
            }`}
          >
            {isResolved ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
            {isResolved ? "Reopen" : "Mark resolved"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {bubbles.map((b) => (
          <MessageBubble
            key={b.id}
            data={b}
            onRetry={
              b.state === "failed" ? () => attemptSend(b.body, b.id) : undefined
            }
          />
        ))}
        <div ref={listEndRef} />
      </div>

      <Composer
        onSend={(body) => attemptSend(body)}
        disabled={windowClosed}
        disabledNote={
          <>
            This WhatsApp conversation window closed 24 hours after the last
            reply — free-text replies aren&apos;t deliverable anymore.{" "}
            <Link href="/broadcasts" className="text-primary-500 font-medium hover:underline">
              Send a template via Broadcasts →
            </Link>
          </>
        }
      />
    </div>
  );
}
