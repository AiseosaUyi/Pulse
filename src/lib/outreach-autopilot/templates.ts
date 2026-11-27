// Pure helpers for follow-up copy and email threading.

export interface FollowUpVars {
  greeting: string;
  company: string;
  signature: string;
  firstName?: string | null;
}

/** Fills {greeting} {company} {signature} {first_name}. Unknown tokens are left as-is. */
export function renderFollowUp(template: string, vars: FollowUpVars): string {
  const map: Record<string, string> = {
    greeting: vars.greeting,
    company: vars.company,
    signature: vars.signature,
    first_name: vars.firstName || vars.company,
  };
  return template
    .replace(/\{(greeting|company|signature|first_name)\}/g, (_, k: string) => map[k] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "Re: <subject>" once, never "Re: Re:". */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: following up";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Domain part of the sending address, for Message-ID generation. */
export function messageIdDomain(fromEmail: string): string {
  const d = fromEmail.split("@")[1]?.trim().toLowerCase();
  return d || "pulse.local";
}

/** Plain text to minimal, safe HTML paragraphs. */
export function textToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

const QUOTE_MARKERS = [
  /^On .{0,200}wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^From: .+$/m,
  /^_{5,}/m,
];

/** Strips the quoted thread under a reply so only the new text is stored. */
export function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  const body = text
    .slice(0, cut)
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
  return body || text.trim();
}

const OPT_OUT = /\b(unsubscribe|remove me|stop (emailing|contacting|messaging) me|take me off)\b/i;

export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text);
}

/**
 * Rebuilds the banned-words regex from a plain list. Entries that were
 * already in the stored regex are kept as written (some are patterns, like
 * game-?changer); new entries are escaped so they only match literally. Any
 * tail after the word group (the punctuation rule) is preserved.
 */
export function rebuildBannedRegex(words: string[], existing: string | null | undefined): string {
  const m = /^\\b\((.*?)\)\\b/.exec(existing ?? "");
  const known = new Set(m ? m[1].split("|") : []);
  const tail = m ? (existing ?? "").slice(m[0].length) : "";
  const alts = [...new Set(words.map((w) => w.trim()).filter(Boolean))].map((w) =>
    known.has(w) ? w : w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const group = alts.length ? `\\b(${alts.join("|")})\\b` : "";
  const out = [group, tail.replace(/^\|/, "")].filter(Boolean).join("|");
  return out || "(?!)";
}

/** The word list shown in settings: the alternatives of the leading \b(...)\b group. */
export function bannedWordsFromRegex(re: string | null | undefined): string[] {
  const m = /^\\b\((.*?)\)\\b/.exec(re ?? "");
  return m ? m[1].split("|").filter(Boolean) : [];
}
