"use client";

// Text input + send button. Enter sends, Shift+Enter inserts a newline
// (Slack/WhatsApp Web/iMessage mental model — design spec decision). The
// send button is the only send affordance on mobile (no hardware-Enter
// reliance). Quick-reply chips populate the draft for edit-then-send,
// they don't send immediately.

import { useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

const QUICK_REPLIES = [
  "Thanks for reaching out — we'll get back to you shortly.",
  "Could you share a few more details?",
  "Yes, that's available right now.",
];

export function Composer({
  onSend,
  disabled,
  disabledNote,
}: {
  /** Returns true on a successful dispatch (clears the draft), false on
   * failure (draft is preserved — the caller renders a failed bubble with
   * its own retry, per the design spec). */
  onSend: (body: string) => Promise<boolean>;
  disabled?: boolean;
  disabledNote?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const body = text.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    const ok = await onSend(body);
    setSending(false);
    if (ok) setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (disabled) {
    return (
      <div className="p-3 border-t border-border/50 text-xs text-text-muted bg-card/50">
        {disabledNote}
      </div>
    );
  }

  return (
    <div className="border-t border-border/50 p-3 flex flex-col gap-2">
      <div className="flex gap-1.5 flex-wrap">
        {QUICK_REPLIES.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setText(chip);
              inputRef.current?.focus();
            }}
            className="text-[11px] px-2.5 py-1 rounded-full border border-border/50 text-text-secondary hover:border-primary-500/50 hover:text-primary-500 transition-colors"
          >
            {chip.length > 30 ? `${chip.slice(0, 30)}…` : chip}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <label htmlFor="conversation-composer-input" className="sr-only">
          Reply message
        </label>
        <textarea
          id="conversation-composer-input"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
          rows={1}
          disabled={sending}
          className="flex-1 resize-none text-sm rounded-lg border border-border/50 bg-background p-2.5 text-foreground focus:outline-none focus:border-primary-500/50 min-h-[44px] max-h-32"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          aria-label="Send message"
          className="shrink-0 h-11 w-11 rounded-full bg-primary-500 text-white flex items-center justify-center hover:bg-primary-600 disabled:opacity-50 transition-colors"
        >
          {sending ? (
            <span
              className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
              aria-hidden
            />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
