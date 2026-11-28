"use client";

import { useState, useTransition } from "react";
import { Check, X, Save, AlertTriangle, Send, Copy } from "lucide-react";
import {
  decideFromDigest,
  decideInApp,
  editFromDigest,
  editInApp,
  markSentFromDigest,
  markSentInApp,
} from "@/lib/actions/outreach-autopilot";
import type { ReviewDraft } from "@/lib/outreach-autopilot/review";

type Mode = { kind: "token"; token: string } | { kind: "app" };

const KIND_LABEL: Record<string, string> = {
  cold_open: "First email",
  follow_up_1: "Follow-up 1",
  follow_up_2: "Follow-up 2",
  reply: "Reply",
};

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };

type RowState = "open" | "approved" | "skipped" | "sent";

const isChat = (d: ReviewDraft) => d.channel !== "email";
// An approved chat draft is still on screen: it waits for someone to send it from their phone.
const initialState = (d: ReviewDraft): RowState => (d.status === "approved" ? "approved" : "open");

export function DraftReview({ drafts, mode }: { drafts: ReviewDraft[]; mode: Mode }) {
  const [state, setState] = useState<Record<string, RowState>>({});
  // Latest version stamp per draft (changes after "Save only").
  const [versions, setVersions] = useState<Record<string, string>>({});
  const versionOf = (d: ReviewDraft) => versions[d.id] ?? d.updatedAt;
  const [bulkPending, startBulk] = useTransition();
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const stateOf = (d: ReviewDraft) => state[d.id] ?? initialState(d);
  const open = drafts.filter((d) => stateOf(d) === "open");
  const decide = (input: DecideInput) =>
    mode.kind === "token" ? decideFromDigest(mode.token, input) : decideInApp(input);

  const approveAll = () =>
    startBulk(async () => {
      let ok = 0;
      let failed = 0;
      let chats = 0;
      for (const d of open) {
        const r = await decide({ dmId: d.id, action: "approve", expectedUpdatedAt: versionOf(d) });
        if (r.ok) {
          ok++;
          if (isChat(d)) chats++;
          setState((s) => ({ ...s, [d.id]: "approved" }));
        } else failed++;
      }
      const emails = ok - chats;
      const parts = [
        `${ok} approved${failed ? `, ${failed} could not be approved` : ""}.`,
        emails ? `${emails === 1 ? "The email goes" : "Emails go"} out inside your send window.` : "",
        chats ? `Send the ${chats === 1 ? "chat reply" : `${chats} chat replies`} from your phone below.` : "",
      ];
      setBulkMsg(parts.filter(Boolean).join(" "));
    });

  if (drafts.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center text-sm text-gray-1000 dark:text-text-muted">
        Nothing is waiting for approval.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-1000 dark:text-text-muted">
          {open.length} of {drafts.length} still need a decision. Nothing is sent until you approve it.
          {drafts.some(isChat) && " WhatsApp and Instagram replies are sent by you, from your phone."}
        </p>
        {open.length > 1 && (
          <button
            type="button"
            onClick={approveAll}
            disabled={bulkPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {bulkPending ? "Approving..." : `Approve all ${open.length}`}
          </button>
        )}
      </div>
      {bulkMsg && <p className="text-sm text-green-700 dark:text-green-400">{bulkMsg}</p>}

      {drafts.map((d) => (
        <DraftCard
          key={d.id}
          draft={d}
          version={versionOf(d)}
          onSaved={(v) => setVersions((p) => ({ ...p, [d.id]: v }))}
          rowState={stateOf(d)}
          onDecided={(s) => setState((prev) => ({ ...prev, [d.id]: s }))}
          decide={decide}
          save={(input) => (mode.kind === "token" ? editFromDigest(mode.token, input) : editInApp(input))}
          markSent={() => (mode.kind === "token" ? markSentFromDigest(mode.token, d.id) : markSentInApp(d.id))}
        />
      ))}
    </div>
  );
}

type DecideInput = {
  dmId: string;
  action: "approve" | "skip";
  subject?: string;
  body?: string;
  expectedUpdatedAt?: string;
};
type Result = { ok: true; status: string; updatedAt?: string } | { ok: false; error: string };

function DraftCard({
  draft,
  version,
  onSaved,
  rowState,
  onDecided,
  decide,
  save,
  markSent,
}: {
  draft: ReviewDraft;
  version: string;
  onSaved: (updatedAt: string) => void;
  rowState: RowState;
  onDecided: (s: RowState) => void;
  decide: (i: DecideInput) => Promise<Result>;
  save: (i: { dmId: string; subject: string; body: string; expectedUpdatedAt: string }) => Promise<Result>;
  markSent: () => Promise<Result>;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  // Text as last stored, so "edited" resets after Save only.
  const [saved, setSaved] = useState({ subject: draft.subject, body: draft.body });
  const edited = subject !== saved.subject || body !== saved.body;

  const chat = isChat(draft);
  const who = draft.companyName ?? draft.toContact ?? draft.toEmail;

  if (rowState === "approved" && chat) {
    return <SendFromPhone draft={draft} body={body} who={who} markSent={markSent} onSent={() => onDecided("sent")} />;
  }

  if (rowState !== "open") {
    const label =
      rowState === "approved" ? "approved, will send in your window" : rowState === "sent" ? "marked as sent" : "skipped";
    return (
      <div className="bg-card border border-border rounded-2xl px-5 py-4 text-sm flex items-center gap-2 text-gray-1000 dark:text-text-muted">
        {rowState === "skipped" ? <X className="h-4 w-4" /> : <Check className="h-4 w-4 text-green-600" />}
        <span className="font-medium text-gray-1100 dark:text-foreground">{who}</span>
        <span>{label}</span>
      </div>
    );
  }

  const run = (fn: () => Promise<Result>, onOk: (r: Extract<Result, { ok: true }>) => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.ok) onOk(r);
      else setMsg({ tone: "err", text: r.error });
    });

  return (
    <article className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-1100 dark:text-foreground">{draft.companyName ?? "Unknown company"}</p>
          <p className="text-xs text-gray-1000 dark:text-text-muted">to {chat ? draft.toContact : draft.toEmail}</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-gray-1000 dark:text-text-muted">
          {chat ? `${CHANNEL_LABEL[draft.channel]} reply` : (KIND_LABEL[draft.kind] ?? draft.kind)}
        </span>
      </header>

      {draft.lintWarnings.length > 0 && (
        <ul className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          {draft.lintWarnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {!chat && (
        <label className="block">
          <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-gray-1100 dark:text-foreground"
          />
        </label>
      )}
      <label className="block">
        <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">Message</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(16, Math.max(6, body.split("\n").length + 1))}
          maxLength={5000}
          className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm leading-relaxed text-gray-1100 dark:text-foreground"
        />
      </label>

      {msg && (
        <p className={msg.tone === "ok" ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-red-600"}>{msg.text}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                decide({
                  dmId: draft.id,
                  action: "approve",
                  expectedUpdatedAt: version,
                  ...(edited ? { subject, body } : {}),
                }),
              () => onDecided("approved")
            )
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Check className="h-4 w-4" /> {edited ? "Save and approve" : "Approve"}
        </button>
        {edited && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => save({ dmId: draft.id, subject, body, expectedUpdatedAt: version }),
                (r) => {
                  if (r.updatedAt) onSaved(r.updatedAt);
                  setSaved({ subject, body });
                  setMsg({ tone: "ok", text: "Saved. Still waiting for approval." });
                }
              )
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-gray-1100 dark:text-foreground disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> Save only
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => decide({ dmId: draft.id, action: "skip" }), () => onDecided("skipped"))}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-gray-1000 dark:text-text-muted disabled:opacity-60"
        >
          <X className="h-4 w-4" /> Skip
        </button>
      </div>
    </article>
  );
}

/** wa.me wants digits only: country code and number, no "+". */
const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
const igLink = (handle: string) => `https://ig.me/m/${encodeURIComponent(handle.replace(/^@/, ""))}`;

/**
 * An approved WhatsApp / Instagram reply. Pulse never sends these: the button
 * opens the chat on this phone with the text ready, the person presses send
 * there, then taps "I sent it" so Pulse knows.
 */
function SendFromPhone({
  draft,
  body,
  who,
  markSent,
  onSent,
}: {
  draft: ReviewDraft;
  body: string;
  who: string | null;
  markSent: () => Promise<Result>;
  onSent: () => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const contact = draft.toContact ?? "";

  const openInstagram = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setMsg({ tone: "ok", text: "Message copied. Paste it in the Instagram chat and send." });
    } catch {
      setMsg({ tone: "err", text: "Could not copy. Select the message above and copy it." });
    }
    window.open(igLink(contact), "_blank", "noopener,noreferrer");
  };

  return (
    <article className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-1100 dark:text-foreground">{who ?? "Unknown lead"}</p>
          <p className="text-xs text-gray-1000 dark:text-text-muted">
            Approved. Send it from your phone to {contact}.
          </p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-gray-1000 dark:text-text-muted">
          {CHANNEL_LABEL[draft.channel]} reply
        </span>
      </header>
      <p className="whitespace-pre-wrap rounded-lg border border-border px-3 py-2 text-sm leading-relaxed text-gray-1100 dark:text-foreground">
        {body}
      </p>
      {msg && (
        <p className={msg.tone === "ok" ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-red-600"}>{msg.text}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {draft.channel === "whatsapp" ? (
          <a
            href={waLink(contact, body)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Send className="h-4 w-4" /> Open in WhatsApp
          </a>
        ) : (
          <button
            type="button"
            onClick={openInstagram}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Copy className="h-4 w-4" /> Copy and open Instagram
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await markSent();
              if (r.ok) onSent();
              else setMsg({ tone: "err", text: r.error });
            })
          }
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-gray-1100 dark:text-foreground disabled:opacity-60"
        >
          <Check className="h-4 w-4" /> {pending ? "Saving..." : "I sent it"}
        </button>
      </div>
    </article>
  );
}
