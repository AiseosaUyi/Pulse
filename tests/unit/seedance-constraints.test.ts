import { describe, it, expect } from "vitest";
import {
  validateSeedanceParams,
  estimateSeedanceCredits,
  getSeedanceModel,
} from "@/lib/video/providers/seedance-constraints";

describe("validateSeedanceParams — §4.2 constraints", () => {
  it("accepts a valid identity clip (reference images)", () => {
    const r = validateSeedanceParams("seedance-2.0", {
      prompt: "a person waves",
      resolution: "1080p",
      duration: 10,
      imageUrls: ["https://x/1.jpg", "https://x/2.jpg"],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects 1080p on a fast tier", () => {
    const r = validateSeedanceParams("seedance-2.0-fast", {
      prompt: "b-roll",
      resolution: "1080p",
      duration: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/1080p/);
  });

  it("rejects frames combined with references (identity XOR continuity)", () => {
    const r = validateSeedanceParams("seedance-2.0", {
      prompt: "x",
      duration: 8,
      startFrame: "https://x/frame.jpg",
      imageUrls: ["https://x/ref.jpg"],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/continuity mode/);
  });

  it("rejects audio as the sole input", () => {
    const r = validateSeedanceParams("seedance-2.0", {
      prompt: "x",
      duration: 8,
      audioUrls: ["https://x/a.mp3"],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/audioUrls requires/);
  });

  it("accepts audio when paired with an image", () => {
    const r = validateSeedanceParams("seedance-2.0", {
      prompt: "x",
      duration: 8,
      audioUrls: ["https://x/a.mp3"],
      imageUrls: ["https://x/ref.jpg"],
    });
    expect(r.ok).toBe(true);
  });

  it("enforces the 4..15s duration window", () => {
    expect(validateSeedanceParams("seedance-2.0", { prompt: "x", duration: 3 }).ok).toBe(false);
    expect(validateSeedanceParams("seedance-2.0", { prompt: "x", duration: 16 }).ok).toBe(false);
    expect(validateSeedanceParams("seedance-2.0", { prompt: "x", duration: 15 }).ok).toBe(true);
  });

  it("requires a source video for video-edit (replicate)", () => {
    expect(validateSeedanceParams("seedance-2.0-video-edit", { duration: 5, imageUrls: ["https://x/c.jpg"] }).ok).toBe(false);
    expect(validateSeedanceParams("seedance-2.0-video-edit", { duration: 5, videoUrl: "https://x/src.mp4", imageUrls: ["https://x/c.jpg"] }).ok).toBe(true);
  });

  it("requires source videos for video-extend (assemble)", () => {
    expect(validateSeedanceParams("seedance-2.0-video-extend", { duration: 15 }).ok).toBe(false);
    expect(validateSeedanceParams("seedance-2.0-video-extend", { duration: 15, videoUrls: ["https://x/1.mp4", "https://x/2.mp4"] }).ok).toBe(true);
  });

  it("rejects an unknown model", () => {
    expect(validateSeedanceParams("nope", { duration: 10 }).ok).toBe(false);
  });
});

describe("estimateSeedanceCredits — offline preview", () => {
  it("matches the §4.3 table for 720p Pro 10s", () => {
    expect(estimateSeedanceCredits("seedance-2.0", { duration: 10, resolution: "720p" })).toBe(100);
  });
  it("applies the 1080p multiplier", () => {
    expect(estimateSeedanceCredits("seedance-2.0", { duration: 10, resolution: "1080p" })).toBe(150);
  });
  it("uses the fast rate", () => {
    expect(estimateSeedanceCredits("seedance-2.0-fast", { duration: 10, resolution: "720p" })).toBe(80);
  });
  it("returns 0 for unknown models", () => {
    expect(estimateSeedanceCredits("nope", { duration: 10 })).toBe(0);
    expect(getSeedanceModel("nope")).toBeUndefined();
  });
});
