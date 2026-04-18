// Deterministic half of E-E-A-T — 6 of 10 pts.
// Rubric v1 §7. Pure TS, no network.

import type { ScoreIssue } from "./types";

export interface EeatDetInputs {
  content: string;
  hasAuthorByline?: boolean;
}

export interface EeatDetResult {
  score: number;
  max: 6;
  issues: ScoreIssue[];
}

const AUTHORITY_DOMAINS = [
  /\.gov(\.[a-z]+)?$/i,
  /\.edu(\.[a-z]+)?$/i,
  /wikipedia\.org$/i,
  /nytimes\.com$/i,
  /reuters\.com$/i,
  /bbc\.co\.uk$/i,
  /ft\.com$/i,
  /hbr\.org$/i,
  /mit\.edu$/i,
];

function extractOutboundLinks(content: string): string[] {
  const out: string[] = [];
  const mdLink = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = mdLink.exec(content))) out.push(m[1]);
  const bare = /(?<![(\[])(https?:\/\/[^\s)]+)/g;
  while ((m = bare.exec(content))) out.push(m[1]);
  return out;
}

function isAuthoritative(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AUTHORITY_DOMAINS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

function hasCitationPattern(content: string): boolean {
  return /(?:\[source:\s*[^\]]+\]|according to\b|(?:via|per)\s+[A-Z][a-z]+)/i.test(
    content
  );
}

export function scoreEeatDeterministic(inp: EeatDetInputs): EeatDetResult {
  const issues: ScoreIssue[] = [];

  const links = extractOutboundLinks(inp.content);
  const authoritative = links.filter(isAuthoritative).length;
  let linksScore = 0;
  if (authoritative >= 2) linksScore = 3;
  else if (authoritative === 1) linksScore = 2;
  if (linksScore < 3) {
    issues.push({
      subScore: "eeat",
      severity: "med",
      message: `Only ${authoritative} authoritative outbound link${authoritative === 1 ? "" : "s"} (.gov, .edu, major news, etc.).`,
      suggestedFix: "Add 2+ citations to authoritative sources.",
    });
  }

  const citationScore = hasCitationPattern(inp.content) ? 2 : 0;
  if (citationScore < 2) {
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: "No inline citations (e.g. 'according to X', '[source: Y]').",
      suggestedFix: "Cite the source of any claim, stat, or study inline.",
    });
  }

  const bylineScore = inp.hasAuthorByline ? 1 : 0;
  if (bylineScore < 1) {
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: "No author byline.",
      suggestedFix: "Add a byline for Google's E-E-A-T signals.",
    });
  }

  return {
    score: linksScore + citationScore + bylineScore,
    max: 6,
    issues,
  };
}
