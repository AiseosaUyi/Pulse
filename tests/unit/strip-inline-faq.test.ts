import { describe, it, expect } from "vitest";
import { extractAndStripFaqSection } from "@/lib/seo/strip-inline-faq";

// Regression coverage for the "AI writes an FAQ dump into the visible
// article body" bug: the model is instructed to keep FAQ content out of
// body_markdown, but this is the safety net for when it doesn't listen.

describe("extractAndStripFaqSection", () => {
  it("returns content unchanged when there's no FAQ section", () => {
    const raw = "# Title\n\nJust a normal article with no FAQ block.\n";
    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(false);
    expect(result.extractedFaq).toEqual([]);
    expect(result.cleanedContent).toBe(raw.trim() + "\n");
  });

  it("extracts Q/A pairs under a real H2 heading and removes the section", () => {
    const raw = [
      "# Title",
      "",
      "Some intro copy.",
      "",
      "## Frequently Asked Questions",
      "",
      "### Is this free?",
      "Yes, it's free.",
      "",
      "### How do I sign up?",
      "Click the button at the top.",
      "",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(true);
    expect(result.extractedFaq).toEqual([
      { question: "Is this free?", answer: "Yes, it's free." },
      { question: "How do I sign up?", answer: "Click the button at the top." },
    ]);
    expect(result.cleanedContent).not.toMatch(/Frequently Asked Questions/i);
    expect(result.cleanedContent).toMatch(/Some intro copy\./);
  });

  it("handles the bold-pseudo-heading style the model sometimes uses", () => {
    const raw = [
      "# Title",
      "",
      "**Frequently Asked Questions**",
      "",
      "**Is this free?**",
      "Yes, it's free.",
      "",
      "**How do I sign up?**",
      "Click the button.",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(true);
    expect(result.extractedFaq).toEqual([
      { question: "Is this free?", answer: "Yes, it's free." },
      { question: "How do I sign up?", answer: "Click the button." },
    ]);
  });

  it("matches an FAQ heading with qualifier text", () => {
    const raw = [
      "## FAQ About Our Pricing",
      "",
      "### Is there a free tier?",
      "Yes.",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(true);
    expect(result.extractedFaq).toEqual([{ question: "Is there a free tier?", answer: "Yes." }]);
  });

  it("strips a leaked FAQPage JSON-LD script block even with no visible FAQ heading", () => {
    const raw = [
      "# Title",
      "",
      '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
      "",
      "Rest of the article.",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(true);
    expect(result.cleanedContent).not.toMatch(/application\/ld\+json/);
    expect(result.cleanedContent).toMatch(/Rest of the article\./);
  });

  it("preserves trailing content (e.g. a closing CTA) written after the FAQ section", () => {
    const raw = [
      "# Title",
      "",
      "## Frequently Asked Questions",
      "",
      "### Is this free?",
      "Yes.",
      "",
      "## Conclusion",
      "",
      "Ready to get started? Sign up today.",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.extractedFaq).toEqual([{ question: "Is this free?", answer: "Yes." }]);
    expect(result.cleanedContent).toMatch(/## Conclusion/);
    expect(result.cleanedContent).toMatch(/Ready to get started\? Sign up today\./);
    expect(result.cleanedContent).not.toMatch(/Frequently Asked Questions/i);
  });

  it("ignores '---' separators between Q/A pairs", () => {
    const raw = [
      "## Frequently Asked Questions",
      "",
      "### Is this free?",
      "Yes.",
      "",
      "---",
      "",
      "### How do I sign up?",
      "Click here.",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.extractedFaq).toEqual([
      { question: "Is this free?", answer: "Yes." },
      { question: "How do I sign up?", answer: "Click here." },
    ]);
  });

  it("strips a ```json fenced FAQ array leaked into the body (regression: live production incident)", () => {
    // Reproduces the exact shape found on a real published post: a
    // "**FAQ**" bold-pseudo-heading followed by a fenced ```json code
    // block containing a raw [{question, answer}] array — from a
    // generator with no dedicated faq[] output field, so the model had
    // nowhere else to put it.
    const raw = [
      "Some real article content here.",
      "",
      "---",
      "",
      "**FAQ**",
      "",
      "```json",
      "[",
      '  {',
      '    "question": "What are the best ticket sales strategies?",',
      '    "answer": "Use early bird pricing and local influencer collabs."',
      '  },',
      '  {',
      '    "question": "Which platforms work best for Nigerian events?",',
      '    "answer": "Gruve, Tix Africa, and EventPorte all support local payments."',
      '  }',
      "]",
      "```",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(true);
    expect(result.extractedFaq).toEqual([
      {
        question: "What are the best ticket sales strategies?",
        answer: "Use early bird pricing and local influencer collabs.",
      },
      {
        question: "Which platforms work best for Nigerian events?",
        answer: "Gruve, Tix Africa, and EventPorte all support local payments.",
      },
    ]);
    expect(result.cleanedContent).not.toMatch(/```json/);
    expect(result.cleanedContent).not.toMatch(/"question"/);
    expect(result.cleanedContent).not.toMatch(/\*\*FAQ\*\*/);
    expect(result.cleanedContent).toMatch(/Some real article content here\./);
  });

  it("leaves a ```json fence alone when it isn't FAQ-shaped (a real code example)", () => {
    const raw = [
      "# How to use our API",
      "",
      "```json",
      '{ "endpoint": "/v1/events", "method": "GET" }',
      "```",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.stripped).toBe(false);
    expect(result.extractedFaq).toEqual([]);
    expect(result.cleanedContent).toMatch(/```json/);
    expect(result.cleanedContent).toMatch(/"endpoint"/);
  });

  it("joins multi-line answers into a single answer string", () => {
    const raw = [
      "## Frequently Asked Questions",
      "",
      "### Is this free?",
      "Yes, it's free for the first month.",
      "After that, it's $10/mo.",
    ].join("\n");

    const result = extractAndStripFaqSection(raw);
    expect(result.extractedFaq).toEqual([
      {
        question: "Is this free?",
        answer: "Yes, it's free for the first month. After that, it's $10/mo.",
      },
    ]);
  });
});
