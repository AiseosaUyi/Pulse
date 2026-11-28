// Pure helpers for drafted answers to replies. No server or AI imports, so
// tests can use them. See reply-draft.ts.

export const REPLY_INTENTS = ["interested", "question", "not_now", "not_interested", "wrong_person", "other"] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const INTENT_LABEL: Record<ReplyIntent, string> = {
  interested: "Interested",
  question: "Asked a question",
  not_now: "Not now",
  not_interested: "Not interested",
  wrong_person: "Wrong person",
  other: "Other",
};

export interface ReplyWriterResult {
  intent: ReplyIntent;
  summary: string;
  /** null = no answer is needed or none could be written. */
  body: string | null;
  /** Something the model could not answer from what it knows. */
  needsHuman: string | null;
}

export interface ReplyWriterInput {
  tenantSlug: string;
  senderName: string;
  signature: string;
  prospectName: string;
  company: string;
  /** Oldest first. */
  thread: Array<{ direction: "outbound" | "inbound"; body: string }>;
  latest: string;
  /** Where the answer goes. Chat answers are shorter and more casual. Default email. */
  channel?: "email" | "whatsapp" | "instagram";
}

export type ReplyWriter = (input: ReplyWriterInput) => Promise<ReplyWriterResult | null>;

const clean = (s: string) => s.replace(/[ \t]+/g, " ").trim();

/** House style on the drafted answer, and the signature once at the end. Pure. */
export function finishReplyBody(body: string, signature: string): string {
  let b = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) =>
      clean(l)
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/!/g, ".")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const sig = signature.trim();
  if (sig && !b.toLowerCase().includes(sig.toLowerCase())) b = `${b}\n\n${sig}`;
  return b;
}

/** Notes shown to the approver beside the draft. Pure. */
export function replyNotes(r: ReplyWriterResult, theirWords: string): string[] {
  const quote = clean(theirWords).slice(0, 220);
  const notes = [`Their reply (${INTENT_LABEL[r.intent]}): "${quote}"`];
  if (r.needsHuman) notes.push(`Check before approving: ${clean(r.needsHuman)}`);
  if (r.body && /https?:\/\/|www\./i.test(r.body)) notes.push("The draft contains a link. Check it before approving.");
  if (r.body && /(₦|\bngn\b|\$|\bnaira\b|\bdiscount\b|\bfree\b)/i.test(r.body)) {
    notes.push("The draft mentions money or a discount. Check it before approving.");
  }
  return notes;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface ReplyAlertItem {
  from: string;
  company: string | null;
  snippet: string;
  optOut: boolean;
  intent: ReplyIntent | null;
  draft: string | null;
}

/** The "someone replied" email to the approver, with the drafted answers. Pure. */
export function buildReplyAlertEmail(opts: {
  tenantName: string;
  items: ReplyAlertItem[];
  approveUrl: string | null;
  autopilotUrl: string;
  /** Replies that went to their lead owners instead (workspace approver only). */
  routedToOwners?: number;
}): { subject: string; html: string; text: string } {
  const n = opts.items.length;
  const drafts = opts.items.filter((i) => i.draft).length;
  const routedN = opts.routedToOwners ?? 0;
  const routed = routedN > 0
    ? `${routedN} ${routedN === 1 ? "reply" : "replies"} went to ${routedN === 1 ? "its lead owner" : "their lead owners"}.`
    : "";

  // Only replies for lead owners this pass: a short heads-up, nothing to act on.
  if (n === 0) {
    const subject = `${opts.tenantName}: ${routed.replace(/\.$/, "")}`;
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<p style="color:#444">${esc(routed)} They will approve the answers.</p>
<p><a href="${esc(opts.autopilotUrl)}" style="color:#ad112c">Open Autopilot</a></p></body></html>`;
    return { subject, html, text: `${routed} They will approve the answers.\n\nOpen Autopilot: ${opts.autopilotUrl}` };
  }

  const subject = `${opts.tenantName}: ${n} new repl${n === 1 ? "y" : "ies"}${drafts ? `, ${drafts} answer${drafts === 1 ? "" : "s"} ready` : ""}`;

  const rows = opts.items
    .map((i) => {
      const who = `${esc(i.company ? `${i.company} (${i.from})` : i.from)}`;
      const tag = i.optOut ? "Asked to stop" : i.intent ? INTENT_LABEL[i.intent] : "";
      const draft = i.draft
        ? `<div style="margin-top:8px;padding:10px 12px;background:#f6f6f6;border-radius:10px;white-space:pre-wrap;color:#222">${esc(i.draft)}</div>`
        : "";
      return `<li style="margin-bottom:18px"><strong>${who}</strong>${tag ? ` <span style="color:#ad112c">· ${esc(tag)}</span>` : ""}<br>` +
        `<span style="color:#444">${esc(i.snippet)}</span>${draft}</li>`;
    })
    .join("");

  const button = opts.approveUrl
    ? `<p><a href="${esc(opts.approveUrl)}" style="display:inline-block;background:#ad112c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Review and send ${drafts === 1 ? "the answer" : "answers"}</a></p>`
    : "";

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 12px">New replies</h2><ul style="padding-left:18px">${rows}</ul>
<p style="color:#444">Follow-ups to these people have been stopped.${drafts ? " Nothing is sent until you approve it." : ""}</p>
${button}
${routed ? `<p style="color:#444">${esc(routed)}</p>` : ""}
<p><a href="${esc(opts.autopilotUrl)}" style="color:#ad112c">Open Autopilot</a></p></body></html>`;

  const text = [
    ...opts.items.map((i) => `${i.from}${i.intent ? ` [${INTENT_LABEL[i.intent]}]` : ""}: ${i.snippet}${i.draft ? `\n  Draft answer:\n  ${i.draft.replace(/\n/g, "\n  ")}` : ""}`),
    opts.approveUrl ? `Review and send: ${opts.approveUrl}` : `Open Autopilot: ${opts.autopilotUrl}`,
    routed,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}
