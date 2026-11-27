import { describe, it, expect } from "vitest";
import {
  buildGreeting,
  lintDraftCopy,
  dealIntoBatches,
} from "@/lib/services/outreach-composition";
import type { OutreachDraftMessage } from "@/lib/types/outreach-config";

describe("Outreach Composition & Lint Rules", () => {
  describe("buildGreeting", () => {
    it("handles single first names correctly", () => {
      expect(buildGreeting("Priye", "Acme")).toBe("Hi Priye,");
      expect(buildGreeting("Tunde Bakare", "Lagos Events")).toBe("Hi Tunde,");
    });

    it("handles honorifics gracefully", () => {
      expect(buildGreeting("Dr. Emeka Okonjo", "HealthFest")).toBe("Hi Emeka,");
      expect(buildGreeting("Ms. Folake", "Beauty Expo")).toBe("Hi Folake,");
    });

    it("handles East Asian / Vietnamese surname-first naming conventions", () => {
      expect(buildGreeting("Nguyen Van Minh", "Venture")).toBe("Hi Nguyen Van Minh,");
      expect(buildGreeting("Kim Min-jun", "Seoul Bar")).toBe("Hi Kim Min-jun,");
      expect(buildGreeting("Chen Wei", "Tea Co")).toBe("Hi Chen Wei,");
    });

    it("falls back to Brand team when no person name is provided", () => {
      expect(buildGreeting("", "Hard Rock Cafe")).toBe("Hi Hard Rock Cafe team,");
      expect(buildGreeting(null, "Eko Hotel")).toBe("Hi Eko Hotel team,");
      expect(buildGreeting("", "")).toBe("Hi there,");
    });
  });

  describe("lintDraftCopy", () => {
    const defaultLimits: { subject: [number, number]; hook: [number, number]; idea: [number, number] } = {
      subject: [3, 7],
      hook: [8, 22],
      idea: [25, 45],
    };

    const gruveConfig = {
      bannedRegex: "\\b(amazing|exciting|incredible|huge|revolutionary|game-?changer|leverage|synergy|cutting-edge|caught my eye|stood out|immersive|engaging|unlocks?|elevate|seamless|engagement|retention|showcase|impressive|testament|AI|budget|price|partnership)\\b|[!;–—]| - ",
      promiseRegex: "\\b(I('ll| will| can) (make|build|send|create|mock|put together)|for free|free (demo|sample|prototype|mock-?up)|demo|mock-?up|prototype|sample)\\b",
      badSubjectRegex: "\\b(idea for|quick idea|a thought on|quick question)\\b",
      verdictRegex: "\\b(impressive|love|great|beautiful|stunning|awesome)\\b",
      wordLimits: defaultLimits,
      blockedCountries: "belarus|iran|north korea|syria",
      ideaPrefix: "What if there was",
    };

    const cleanDraft = {
      subject: "ticketing for your summer festival", // 5 words
      hook: "Saw your announced December concert series at Landmark Beach with tickets opening on Friday.", // 14 words
      idea: "What if there was a fast QR entry system that eliminated paper gate tickets and gave your box office live attendance analytics on any mobile device?", // 27 words
      body: "Hi team,\n\nBody text",
    };

    it("produces zero warnings on a clean draft", () => {
      const warnings = lintDraftCopy(cleanDraft, gruveConfig);
      expect(warnings).toEqual([]);
    });

    it("flags banned words (and 'partnership' for Gruve)", () => {
      const withBanned = {
        ...cleanDraft,
        hook: "Saw your exciting concert series at Landmark Beach with tickets opening on Friday.",
      };
      const warnings = lintDraftCopy(withBanned, gruveConfig);
      expect(warnings.some((w) => w.includes("Banned word"))).toBe(true);

      const withPartnership = {
        ...cleanDraft,
        idea: "What if there was a partnership between our ticketing team and your festival to streamline entry at your upcoming events in Lagos?",
      };
      const pWarnings = lintDraftCopy(withPartnership, gruveConfig);
      expect(pWarnings.some((w) => w.includes("partnership"))).toBe(true);
    });

    it("flags forbidden punctuation (!, ;, em dashes)", () => {
      const withExclamation = {
        ...cleanDraft,
        hook: "Saw your concert series at Landmark Beach with tickets opening on Friday!",
      };
      expect(lintDraftCopy(withExclamation, gruveConfig)).toContain(
        "Hook contains banned punctuation (!, ;, em-dash or spaced dash)"
      );

      const withEmDash = {
        ...cleanDraft,
        subject: "fast ticketing — for summer festival",
      };
      expect(lintDraftCopy(withEmDash, gruveConfig)).toContain(
        "Subject contains banned punctuation (!, ;, em-dash or spaced dash)"
      );

      const withSemicolon = {
        ...cleanDraft,
        idea: "What if there was a fast QR entry system; could that eliminate paper gate tickets and give your box office live mobile attendance analytics?",
      };
      expect(lintDraftCopy(withSemicolon, gruveConfig)).toContain(
        "Idea contains banned punctuation (!, ;, em-dash or spaced dash)"
      );
    });

    it("flags promises and free work offers", () => {
      const withPromise = {
        ...cleanDraft,
        idea: "What if there was a time when I will build a free demo for your venue check-in system?",
      };
      const warnings = lintDraftCopy(withPromise, gruveConfig);
      expect(warnings).toContain("Promise or free work language detected in idea or hook");
    });

    it("flags subjective verdicts or praise in the hook", () => {
      const withPraise = {
        ...cleanDraft,
        hook: "We love your stunning festival setup at Landmark Beach with tickets opening on Friday.",
      };
      const warnings = lintDraftCopy(withPraise, gruveConfig);
      expect(warnings.some((w) => w.includes("Subjective verdict or praise"))).toBe(true);
    });

    it("flags bad subject lines", () => {
      const withBadSubj = {
        ...cleanDraft,
        subject: "quick question for you",
      };
      const warnings = lintDraftCopy(withBadSubj, gruveConfig);
      expect(warnings.some((w) => w.includes("Generic subject line pattern"))).toBe(true);
    });

    it("flags word count bounds", () => {
      const shortSubject = {
        ...cleanDraft,
        subject: "event ticketing", // 2 words (min 3)
      };
      expect(lintDraftCopy(shortSubject, gruveConfig).some((w) => w.includes("Subject length"))).toBe(true);
    });

    it("flags missing question mark or missing idea prefix", () => {
      const noQuestion = {
        ...cleanDraft,
        idea: "What if there was a fast QR entry system that eliminated paper gate tickets and gave your box office live mobile attendance analytics.",
      };
      expect(lintDraftCopy(noQuestion, gruveConfig)).toContain("Idea must end with a question mark (?)");

      const wrongPrefix = {
        ...cleanDraft,
        idea: "Consider having a fast QR entry system that eliminated paper gate tickets and gave your box office live mobile attendance analytics?",
      };
      expect(lintDraftCopy(wrongPrefix, gruveConfig)).toContain('Idea must start with "What if there was"');
    });
  });

  describe("dealIntoBatches", () => {
    it("deals drafts round-robin into batches ~40, interleaving segments with named contacts first", () => {
      const mockDrafts: OutreachDraftMessage[] = [];
      const segments = ["organizers", "venues", "pageants"];

      for (let i = 0; i < 90; i++) {
        mockDrafts.push({
          prospectId: `p-${i}`,
          subject: `Subject ${i}`,
          body: `Body ${i}`,
          segment: segments[i % segments.length],
          hasNamedContact: i % 2 === 0,
          warnings: [],
        });
      }

      const batches = dealIntoBatches(mockDrafts, 40);
      expect(batches.length).toBe(3); // 90 / 40 -> 3 batches
      expect(batches[0].drafts.length).toBeGreaterThan(0);
      expect(batches[0].drafts.length).toBeLessThanOrEqual(40);

      // Confirm segments are interleaved in batch 1
      const firstThreeSegments = batches[0].drafts.slice(0, 3).map((d) => d.segment);
      expect(new Set(firstThreeSegments).size).toBeGreaterThan(1);
    });
  });
});
