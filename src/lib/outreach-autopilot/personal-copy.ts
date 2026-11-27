// Pure helpers for AI-written first-email lines. No server or AI imports, so
// composition and unit tests can use them. See personalize.ts.

export interface PersonalCopy {
  subject: string;
  hook: string;
  idea: string;
}

export type Personalizer = (prospect: Record<string, unknown>) => Promise<PersonalCopy | null>;

const MAX_SITE_CHARS = 3000;

const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();

/** Visible text of a page, scripts and styles removed, capped. Pure. */
export function pageTextForPrompt(html: string, max = MAX_SITE_CHARS): string {
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, max);
}

/**
 * Make model output fit the house rules it most often slips on, without
 * changing what it says: no banned punctuation, idea starts with the
 * prefix and ends with a question mark. Pure.
 */
export function tidyPersonalCopy(copy: PersonalCopy, ideaPrefix: string): PersonalCopy {
  const fix = (s: string) =>
    clean(s)
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/ - /g, ", ")
      .replace(/;/g, ",")
      .replace(/!/g, ".")
      .replace(/,\s*,/g, ",");
  const subject = fix(copy.subject).replace(/[.,]+$/, "");
  let hook = fix(copy.hook);
  if (hook && !/[.?]$/.test(hook)) hook += ".";
  let idea = fix(copy.idea).replace(/[.,]+$/, "");
  const prefix = clean(ideaPrefix);
  if (prefix && !idea.toLowerCase().startsWith(prefix.toLowerCase())) {
    idea = `${prefix} ${idea.charAt(0).toLowerCase()}${idea.slice(1)}`;
  }
  if (idea && !idea.endsWith("?")) idea += "?";
  return { subject, hook, idea };
}

/** A link or address in AI copy is never expected: flag it for the approver. Pure. */
export function personalCopyWarnings(copy: PersonalCopy): string[] {
  const all = `${copy.subject} ${copy.hook} ${copy.idea}`;
  if (/https?:\/\/|www\.|\b[\w.-]+\.(com|ng|io|net|org|co)\b|@/i.test(all)) {
    return ["The AI-written lines contain a link or address. Check them before approving."];
  }
  return [];
}
