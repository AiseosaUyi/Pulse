import { describe, it, expect } from "vitest";
import { replyDraftSchema } from "@/lib/ai/engagement-reply";

// Schema-only regression test for the AI reply-draft shape consumed by
// draftEngagementReply / approveEngagementReply / the conversations inbox's
// pending-review path, and (Track A Phase 3) lib/ai/shared-inbox-auto-reply.ts's
// auto-send confidence gate. `confidenceScore` is a required numeric field
// (0-1) alongside the existing `confidence` enum — required, not
// `.optional()`/`.default()`/`.nullable()`, per OpenAI strict structured-
// output mode's "every property must be in `required`" gotcha documented in
// CLAUDE.md.

describe("replyDraftSchema", () => {
  it("accepts a valid draft", () => {
    const result = replyDraftSchema.safeParse({
      body: "Thanks for reaching out — yes, that's still available!",
      confidence: "high",
      confidenceScore: 0.92,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = replyDraftSchema.safeParse({ body: "", confidence: "medium", confidenceScore: 0.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing body", () => {
    const result = replyDraftSchema.safeParse({ confidence: "low", confidenceScore: 0.1 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum confidence value", () => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidence: "certain", confidenceScore: 0.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing confidence", () => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidenceScore: 0.5 });
    expect(result.success).toBe(false);
  });

  it.each(["low", "medium", "high"] as const)("accepts confidence=%s", (confidence) => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidence, confidenceScore: 0.5 });
    expect(result.success).toBe(true);
  });

  it("rejects a missing confidenceScore", () => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidence: "high" });
    expect(result.success).toBe(false);
  });

  it.each([0, 0.5, 1])("accepts confidenceScore=%s (within 0-1)", (confidenceScore) => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidence: "high", confidenceScore });
    expect(result.success).toBe(true);
  });

  it.each([-0.01, 1.01])("rejects confidenceScore=%s (outside 0-1)", (confidenceScore) => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidence: "high", confidenceScore });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric confidenceScore", () => {
    const result = replyDraftSchema.safeParse({ body: "Hi there", confidence: "high", confidenceScore: "high" });
    expect(result.success).toBe(false);
  });
});
