"use client";

import { useState, useTransition } from "react";
import { Check, X, Save, AlertTriangle } from "lucide-react";
import {
  decideFromDigest,
  decideInApp,
  editFromDigest,
  editInApp,
} from "@/lib/actions/outreach-autopilot";
import type { ReviewDraft } from "@/lib/outreach-autopilot/review";

type Mode = { kind: "token"; token: string } | { kind: "app" };

const KIND_LABEL: Record<string, string> = {
  cold_open: "First email",
  follow_up_1: "Follow-up 1",
  follow_up_2: "Follow-up 2",
  reply: "Reply",
};

type RowState = "open" | "approved" | "skipped";

export function DraftReview({ drafts, mode }: { drafts: ReviewDraft[]; mode: Mode }) {
  const [state, setState] = useState<Record<string, RowState>>({});
  const [bulkPending, startBulk] = useTransition();
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const open = drafts.filter((d) => (state[d.id] ?? "open") === "open");
  const decide = (input: { dmId: string; action: "approve" | "skip"; subject?: string; body?: string }) =>
    mode.kind === "token" ? decideFromDigest(mode.token, input) : decideInApp(input);

  const approveAll = () =>
    startBulk(async () => {
      let ok = 0;
      let failed = 0;
      for (const d of open) {
        const r = await decide({ dmId: d.id, action: "approve" });
        if (r.ok) {
          ok++;
          setState((s) => ({ ...s, [d.id]: "approved" }));
        } else failed++;
      }
      setBulkMsg(`${ok} approved${failed ? `, ${failed} could not be approved` : ""}. They go out inside your send window.`);
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
          rowState={state[d.id] ?? "open"}
          onDecided={(s) => setState((prev) => ({ ...prev, [d.id]: s }))}
          decide={decide}
          save={(input) => (mode.kind === "token" ? editFromDigest(mode.token, input) : editInApp(input))}
        />
      ))}
    </div>
  );
}

function DraftCard({
  draft,
  rowState,
  onDecided,
  decide,
  save,
}: {
  draft: ReviewDraft;
  rowState: RowState;
  onDecided: (s: RowState) => void;
  decide: (i: { dmId: string; action: "approve" | "skip"; subject?: string; body?: string }) => Promise<
    { ok: true; status: string } | { ok: false; error: string }
  >;
  save: (i: { dmId: string; subject: string; body: string }) => Promise<
    { ok: true; status: string } | { ok: false; error: string }
  >;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const edited = subject !== draft.subject || body !== draft.body;

  if (rowState !== "open") {
    return (
      <div className="bg-card border border-border rounded-2xl px-5 py-4 text-sm flex items-center gap-2 text-gray-1000 dark:text-text-muted">
        {rowState === "approved" ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4" />}
        <span className="font-medium text-gray-1100 dark:text-foreground">{draft.companyName ?? draft.toEmail}</span>
        <span>{rowState === "approved" ? "approved, will send in your window" : "skipped"}</span>
      </div>
    );
  }

  const run = (fn: () => Promise<{ ok: true; status: string } | { ok: false; error: string }>, onOk: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.ok) onOk();
      else setMsg({ tone: "err", text: r.error });
    });

  return (
    <article className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-1100 dark:text-foreground">{draft.companyName ?? "Unknown company"}</p>
          <p className="text-xs text-gray-1000 dark:text-text-muted">to {draft.toEmail}</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-gray-1000 dark:text-text-muted">
          {KIND_LABEL[draft.kind] ?? draft.kind}
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

      <label className="block">
        <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-gray-1100 dark:text-foreground"
        />
      </label>
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
                () => save({ dmId: draft.id, subject, body }),
                () => setMsg({ tone: "ok", text: "Saved. Still waiting for approval." })
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
