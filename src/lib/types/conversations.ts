// Types for the unified /conversations shared-inbox UI (Track A Phase 2).
//
// There is no `conversations` table (deliberate v1 decision, see the plan) —
// a "conversation" is computed virtually at read time by grouping rows from
// two existing tables on a shared participant key:
//   - `engagement_items` (Instagram/TikTok/Twitter/LinkedIn, via the
//      composio-sync-engagement cron)
//   - `inbound_messages`, filtered to platform='whatsapp' only (via the
//      WhatsApp webhook). Non-whatsapp rows in `inbound_messages` belong to
//      the separate Outbound/prospect-reply pipeline and are NOT surfaced
//      here — see conversations.ts's `sourceForPlatform`.
//
// Each row in either table represents one inbound message plus (optionally)
// a single inline reply (`sent_body`) — there's no per-message reply table.
// A "thread" is therefore reconstructed by flattening every row in a group
// into up to two virtual messages (the inbound one, and the reply one if
// `sent_body` is set) and sorting by time.

export type ConversationPlatform =
  | "instagram"
  | "tiktok"
  | "twitter"
  | "linkedin"
  | "whatsapp";

// Which underlying table a conversation's rows live in. 1:1 with platform:
// whatsapp -> inbound_messages, everything else -> engagement_items.
export type ConversationSource = "engagement" | "whatsapp";

export type ConversationStatus = "open" | "resolved";

// Derived from `approved_by IS NULL` on a sent reply row — human-typed vs.
// AI-auto-sent (Phase 3 territory; always "human" until that ships).
export type SentBy = "human" | "ai_auto";

export interface ConversationMessage {
  /** Stable per-message id: `${rowId}:in` or `${rowId}:out`. */
  id: string;
  /** The underlying engagement_items/inbound_messages row this came from. */
  rowId: string;
  direction: "inbound" | "outbound";
  body: string;
  /** Set only for outbound (reply) messages. */
  sentBy: SentBy | null;
  /** Only meaningful for inbound messages. */
  read: boolean;
  createdAt: string;
}

export interface ConversationSummary {
  /** `${platform}::${participantKey}` — stable, computed, never stored. */
  id: string;
  source: ConversationSource;
  platform: ConversationPlatform;
  participantKey: string;
  fromName: string;
  fromHandle: string | null;
  fromAvatar: string | null;
  lastMessageBody: string;
  lastMessageAt: string;
  unreadCount: number;
  messageCount: number;
  status: ConversationStatus;
  assignedTo: string | null;
  /** Most recent AI-authored (`approved_by IS NULL`) sent reply, if any —
   * feeds the AI activity digest strip. Null until Phase 3 auto-send ships. */
  lastAiSentAt: string | null;
  lastAiSentBody: string | null;
  /** The most recent underlying row's id — replies attach here. */
  latestRowId: string;
}

export interface ConversationThread {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}
