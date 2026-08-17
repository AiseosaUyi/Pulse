"use client";

// Message bubble states per the design spec: inbound (left, grey), outbound
// human (right, brand-filled), outbound AI (right, brand-filled + sparkle+
// "AI" text badge — never color-only, for colorblind users), and inline
// failed-to-send (dimmed bubble + "Failed — tap to retry" label, composer
// text is NOT cleared on failure elsewhere — see ThreadPanel/Composer).

import { Sparkles } from "lucide-react";

export interface BubbleData {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sentBy: "human" | "ai_auto" | null;
  createdAt: string | null; // null while a local optimistic send has no timestamp yet
  state: "sent" | "sending" | "failed";
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageBubble({
  data,
  onRetry,
}: {
  data: BubbleData;
  onRetry?: () => void;
}) {
  const isOutbound = data.direction === "outbound";
  const isAi = data.sentBy === "ai_auto";
  const isFailed = data.state === "failed";
  const isSending = data.state === "sending";

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[75%] flex flex-col gap-1"
        style={isOutbound ? { alignItems: "flex-end" } : { alignItems: "flex-start" }}
      >
        <div
          role={isFailed ? "button" : undefined}
          tabIndex={isFailed ? 0 : undefined}
          onClick={isFailed ? onRetry : undefined}
          onKeyDown={
            isFailed
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRetry?.();
                  }
                }
              : undefined
          }
          className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words transition-opacity ${
            isOutbound
              ? "bg-primary-500 text-white"
              : "bg-card border border-border/50 text-foreground"
          } ${isFailed ? "opacity-50 cursor-pointer" : ""} ${isSending ? "opacity-70" : ""}`}
        >
          {data.body}
        </div>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-text-muted">
          {isAi && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-primary-500">
              <Sparkles size={10} aria-hidden />
              AI
            </span>
          )}
          {isSending && <span>Sending…</span>}
          {isFailed && <span className="text-status-red font-medium">Failed — tap to retry</span>}
          {data.state === "sent" && data.createdAt && <span>{timeLabel(data.createdAt)}</span>}
        </div>
      </div>
    </div>
  );
}
