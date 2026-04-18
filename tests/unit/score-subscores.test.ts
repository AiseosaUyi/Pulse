import { describe, it, expect } from "vitest";
import { scoreSeo } from "@/lib/ai/score-subscores/seo";
import { scoreReadability, fleschReadingEase } from "@/lib/ai/score-subscores/readability";
import { scoreStructure } from "@/lib/ai/score-subscores/structure";
import { scoreFaq, extractFaqFromMarkdown } from "@/lib/ai/score-subscores/faq";

// These are CONTRACT tests — they lock in the rubric's specific
// thresholds so a future refactor of the scoring code doesn't silently
// shift what "80" means. If a threshold changes, bump the rubric doc
// version AND update the test.

describe("scoreSeo", () => {
  const baseContent = `# Event Ticketing in Lagos 2026

This complete guide covers everything you need to know about buying
tickets online in Nigeria, from pricing to platform reliability to
refund policies. Lagos events are increasingly moving to digital
platforms, which means the marketplace is both more convenient and
more crowded than ever before for organizers and audiences alike.

## What is Event Ticketing?

It is the process of selling admission to concerts, festivals, and
private functions through online tools rather than door sales. An
event platform manages pricing, seating, and access control so the
organizer can focus on the show itself.

## How Lagos Events Work Online

Modern event platforms handle booking, payment, confirmation, and
support. Gruve, Nairabox, and Eventbrite each take a slightly
different approach to the Nigerian market but share a core feature
set that most Lagos events now rely on during ticket sales.

## Conclusion

Choose the right platform for your needs and audience size.`;

  it("scores a solid post at 15+ / 20", () => {
    const r = scoreSeo({
      title: "Event Ticketing in Lagos 2026: Complete Guide",
      metaDescription:
        "Learn how event ticketing in Lagos works in 2026 — top platforms, pricing, booking tips, and refund policies for organizers and fans.",
      content: baseContent,
      targetKeyword: "event ticketing",
      secondaryKeywords: ["lagos events", "event platform"],
      slug: "event-ticketing-lagos-2026",
    });
    expect(r.max).toBe(20);
    expect(r.score).toBeGreaterThanOrEqual(15);
  });

  it("flags missing keyword placements as issues", () => {
    const r = scoreSeo({
      title: "Random unrelated headline",
      metaDescription:
        "Learn how event ticketing in Lagos works in 2026 — top platforms, pricing, booking tips, and refund policies for organizers and fans.",
      content: baseContent,
      targetKeyword: "event ticketing",
      secondaryKeywords: [],
      slug: "event-ticketing-lagos",
    });
    const placement = r.issues.find((i) =>
      i.message.includes("Target keyword")
    );
    expect(placement).toBeDefined();
    expect(placement?.message).toContain("title");
  });

  it("title over 60 chars gets dinged and suggests a trim", () => {
    const long = "A".repeat(90);
    const r = scoreSeo({
      title: long,
      metaDescription: "x".repeat(145),
      content: "# x\n\n## h2\ncontent",
      targetKeyword: "x",
      secondaryKeywords: [],
      slug: "x",
    });
    const titleIssue = r.issues.find((i) => i.message.includes("Title is"));
    expect(titleIssue).toBeDefined();
    expect(titleIssue?.suggestedFix).toMatch(/trim/i);
  });
});

describe("scoreReadability", () => {
  it("Flesch in 60-80 band gets 8", () => {
    // Short sentences, common words.
    const content = `# Title

The sun is up. Birds sing. The day is new.

## Section

We write short. Read fast. Feel good. Move on.`;
    const r = scoreReadability({ content });
    expect(r.max).toBe(15);
    expect(fleschReadingEase(content)).toBeGreaterThanOrEqual(60);
  });

  it("very dense prose flags readability issues", () => {
    const content = `# Dense article

Notwithstanding the aforementioned considerations regarding the multifaceted implications of institutional frameworks governing transnational remittance flows, the substantive heterogeneity of regulatory regimes necessitates a granular examination of the epistemological underpinnings of contemporary macroeconomic theorization.`;
    const r = scoreReadability({ content });
    expect(r.issues.some((i) => i.message.includes("Flesch"))).toBe(true);
  });
});

describe("scoreStructure", () => {
  it("well-structured post hits 8+ / 10", () => {
    const content = `# Title

Intro paragraph here.

## First section

- Bullet A
- Bullet B

## Second section

Content.

## Third section

Content.

## Conclusion

Wrap up.`;
    const r = scoreStructure({ content });
    expect(r.score).toBeGreaterThanOrEqual(8);
  });

  it("multiple H1s trigger a high-severity issue", () => {
    const content = `# First H1

## A

# Second H1

## B`;
    const r = scoreStructure({ content });
    expect(
      r.issues.some(
        (i) => i.severity === "high" && i.message.includes("Multiple H1")
      )
    ).toBe(true);
  });

  it("no conclusion section is flagged", () => {
    const content = `# Title

## A

## B

## C`;
    const r = scoreStructure({ content });
    expect(r.issues.some((i) => i.message.includes("conclusion"))).toBe(true);
  });
});

describe("extractFaqFromMarkdown", () => {
  it("pulls out Q/A pairs under ### questions", () => {
    const md = `## FAQ

### Is it safe?

Yes, it is safe.

### What about refunds?

Refunds are handled within 48hrs.`;
    const parsed = extractFaqFromMarkdown(md);
    expect(parsed.questions.length).toBe(2);
    expect(parsed.questions[0].q).toBe("Is it safe?");
    expect(parsed.questions[0].a).toContain("safe");
  });
});

describe("scoreFaq", () => {
  it("≥3 Q/A + valid JSON-LD scores near full", () => {
    const content = `# Title

## FAQ

### Is it safe?

Yes, our platforms are secured with bank-grade encryption and fraud checks.

### What about refunds?

Refunds are handled within 48 hours according to the seller's policy.

### How do I contact support?

Email support at help@example.com or use the in-app chat during business hours.`;
    const faqSchema = {
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Is it safe?", acceptedAnswer: { text: "Yes" } },
        { "@type": "Question", name: "Refunds?", acceptedAnswer: { text: "Yes" } },
        { "@type": "Question", name: "Support?", acceptedAnswer: { text: "Email" } },
      ],
    };
    const r = scoreFaq({ content, faqSchema });
    expect(r.score).toBeGreaterThanOrEqual(8);
    expect(r.max).toBe(10);
  });

  it("no FAQ at all is flagged high-severity", () => {
    const r = scoreFaq({
      content: "# Title\n\nJust prose, no FAQ section.",
      faqSchema: null,
    });
    const hi = r.issues.find((i) => i.severity === "high");
    expect(hi).toBeDefined();
    expect(hi?.message).toContain("FAQ");
  });
});
