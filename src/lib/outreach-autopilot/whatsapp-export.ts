// Parses a WhatsApp "Export chat" .txt file (Android or iPhone) into
// messages. Pure: runs in the browser, no server imports.
//
//   Android: 27/11/2026, 10:15 - Ada Obi: hello
//            1/2/26, 9:05 pm - Ada: hi
//   iPhone:  [27/11/2026, 10:15:32] Ada Obi: hello
//            [1/2/26, 9:05:12 PM] Ada: hi
//
// Times in the file are the phone's local time with no zone, so the caller
// passes the workspace's UTC offset (Lagos = +01:00).

export interface ParsedLine {
  sender: string;
  text: string;
  /** ISO time in UTC. */
  at: string;
}

export interface ParsedChat {
  /** Everyone who wrote, in order of first message. */
  senders: string[];
  lines: ParsedLine[];
}

// Invisible marks WhatsApp puts in exports (left-to-right marks, narrow and
// non-breaking spaces before am/pm).
const MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;
const SPACES = /[   ]/g;

const DATE = String.raw`(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*([ap])\.?\s?m\.?)?`;
const IOS_RE = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s*(.*)$`, "i");
const ANDROID_RE = new RegExp(String.raw`^${DATE},?\s+${TIME}\s*[-–]\s*(.*)$`, "i");

// Messages that carry no words worth answering.
const SKIP_TEXT = [
  /^<media omitted>$/i,
  /^(image|video|audio|sticker|gif|document|contact card) omitted$/i,
  /^<attached: [^>]+>$/i,
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^null$/i,
  /^missed (voice|video) call/i,
  /^waiting for this message/i,
];
const EDITED = /\s*<this message was edited>\s*$/i;

function parseOffset(offset: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!m) return 60;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

function toIso(
  a: number,
  b: number,
  yearRaw: string,
  hourRaw: number,
  minute: number,
  second: number,
  ampm: string | undefined,
  dayFirst: boolean,
  offsetMinutes: number
): string | null {
  // Which number is the day: forced when one of them can't be a month.
  let day: number;
  let month: number;
  if (a > 12) [day, month] = [a, b];
  else if (b > 12) [day, month] = [b, a];
  else [day, month] = dayFirst ? [a, b] : [b, a];
  const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);

  let hour = hourRaw;
  if (ampm) {
    const pm = ampm.toLowerCase() === "p";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  const d = new Date(utc);
  // Rejects 31/02 and the like (Date.UTC rolls them over).
  if (new Date(utc + offsetMinutes * 60_000).getUTCDate() !== day) return null;
  return d.toISOString();
}

export function parseWhatsAppExport(
  raw: string,
  opts: { dayFirst?: boolean; utcOffset?: string } = {}
): ParsedChat {
  const dayFirst = opts.dayFirst ?? true;
  const offset = parseOffset(opts.utcOffset ?? "+01:00");
  const lines: ParsedLine[] = [];
  const senders: string[] = [];
  let current: ParsedLine | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(MARKS, "").replace(SPACES, " ").trimEnd();
    if (!line.trim()) continue;

    const m = IOS_RE.exec(line.trim()) ?? ANDROID_RE.exec(line.trim());
    if (!m) {
      // A message that runs over several lines.
      if (current) current.text += "\n" + line;
      continue;
    }

    const [, a, b, y, h, mi, s, ampm, rest] = m;
    const at = toIso(Number(a), Number(b), y, Number(h), Number(mi), Number(s ?? 0), ampm, dayFirst, offset);
    const colon = rest.indexOf(": ");
    // "Ada joined", "Messages are end-to-end encrypted": no sender, skip.
    if (!at || colon <= 0) {
      current = null;
      continue;
    }
    const sender = rest.slice(0, colon).trim();
    current = { sender, text: rest.slice(colon + 2), at };
    lines.push(current);
    if (!senders.includes(sender)) senders.push(sender);
  }

  for (const l of lines) l.text = l.text.replace(EDITED, "").trim();
  return { senders, lines };
}

/** The lead's lines become "them", everyone else's "us". Drops media and deleted messages. */
export function toImportMessages(
  chat: ParsedChat,
  leadSender: string
): Array<{ from: "them" | "us"; text: string; at: string }> {
  return chat.lines
    .filter((l) => l.text && !SKIP_TEXT.some((re) => re.test(l.text)))
    .map((l) => ({ from: l.sender === leadSender ? ("them" as const) : ("us" as const), text: l.text, at: l.at }));
}

/** A sender shown as a raw number (an unsaved contact) is the lead's phone. */
export function phoneFromSender(sender: string): string | null {
  const digits = sender.replace(/[^\d+]/g, "");
  return /^\+?\d{8,15}$/.test(digits) && /^[\d+\s()-]+$/.test(sender) ? digits : null;
}

/**
 * Best guess at which sender is the lead: the only one that isn't one of our
 * names. Null when it can't tell (the person picks).
 */
export function guessLeadSender(senders: string[], ourNames: string[]): string | null {
  const ours = ourNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const others = senders.filter((s) => !ours.some((o) => s.toLowerCase() === o || s.toLowerCase().startsWith(o + " ")));
  return others.length === 1 ? others[0] : null;
}
