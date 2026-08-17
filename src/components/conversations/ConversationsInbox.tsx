"use client";

// Two-pane shared-inbox shell (replaces <EngagementInbox> in the
// Conversations "inbox" tab). Desktop: list + thread side by side. Mobile
// (< md breakpoint): single-pane drill-down — list-only until a row is
// tapped, then a full-screen thread with a back arrow (design spec).

import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { ConversationSummary } from "@/lib/types/conversations";
import { ConversationListPane } from "./ConversationListPane";
import { ThreadPanel } from "./ThreadPanel";

const LIST_POLL_MS = 20000;

export function ConversationsInbox({
  initialConversations,
  currentUserId,
}: {
  initialConversations: ConversationSummary[];
  currentUserId: string;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchList = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/conversations/list");
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations ?? []);
      setError(null);
    } catch {
      setError("Couldn't load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const iv = setInterval(() => fetchList(true), LIST_POLL_MS);
    return () => clearInterval(iv);
  }, [fetchList]);

  return (
    <div className="flex flex-col md:flex-row border border-border/50 rounded-2xl overflow-hidden bg-card h-[calc(100vh-260px)] min-h-[520px]">
      <div className={selectedId ? "hidden md:flex md:shrink-0" : "flex w-full md:w-auto md:shrink-0"}>
        <ConversationListPane
          conversations={conversations}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRetry={() => fetchList(false)}
          currentUserId={currentUserId}
        />
      </div>

      <div className={selectedId ? "flex flex-1 min-w-0" : "hidden md:flex flex-1 min-w-0"}>
        {selectedId ? (
          <ThreadPanel
            key={selectedId}
            conversationId={selectedId}
            currentUserId={currentUserId}
            onBack={() => setSelectedId(null)}
            onConversationsChanged={() => fetchList(true)}
          />
        ) : (
          <div
            role="main"
            aria-label="Conversation thread"
            className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8"
          >
            <MessageSquare size={28} className="text-text-muted" aria-hidden />
            <p className="text-sm text-text-secondary">Select a conversation to view the thread</p>
          </div>
        )}
      </div>
    </div>
  );
}
