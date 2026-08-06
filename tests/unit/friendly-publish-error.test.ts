import { describe, it, expect } from "vitest";
import { friendlyPublishError } from "@/app/(app)/(intelligence)/seo-tracker/blog-writer/[id]/client";

describe("friendlyPublishError", () => {
  it("translates a Contentful field-type mismatch into plain English (the readTime/Symbol bug)", () => {
    const raw = `Publish failed at "upsert_entry": ${JSON.stringify({
      message: "Validation error",
      details: {
        errors: [
          {
            path: ["fields", "readTime", "en-US"],
            name: "type",
            details: 'The type of "value" is incorrect, expected type: Symbol',
          },
        ],
      },
    })}`;

    const { headline, detail } = friendlyPublishError(raw);

    expect(headline).not.toMatch(/expected type/i);
    expect(headline).toContain("Read time");
    expect(headline).toMatch(/should be short text/i);
    expect(detail).toContain("upsert_entry");
  });

  it("translates a required-field validation error using the human field label", () => {
    const raw = `Publish failed at "upsert_entry": ${JSON.stringify({
      details: {
        errors: [
          { path: ["fields", "question", "en-US"], name: "required", details: undefined },
        ],
      },
    })}`;

    const { headline } = friendlyPublishError(raw);
    expect(headline).toContain("Question / hook");
    expect(headline).toMatch(/required/i);
  });

  it("falls back to the raw message for non-JSON / unrecognized errors without hiding it", () => {
    const raw = 'Publish failed at "publish_entry": something unexpected happened';
    const { headline, detail } = friendlyPublishError(raw);
    expect(headline).toBe(raw);
    expect(detail).toBeNull();
  });

  it("keeps the raw message as a fallback detail when JSON parses but has no recognizable shape", () => {
    const raw = `Publish failed at "publish_entry": ${JSON.stringify({ unexpected: "shape" })}`;
    const { headline, detail } = friendlyPublishError(raw);
    expect(headline).toContain("publish_entry");
    expect(detail).toBe(raw);
  });

  it("passes through errors that don't match the publish-runner shape at all", () => {
    const raw = "Contentful is not configured for this workspace";
    const { headline, detail } = friendlyPublishError(raw);
    expect(headline).toBe(raw);
    expect(detail).toBeNull();
  });
});
