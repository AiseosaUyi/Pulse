import { describe, it, expect, beforeEach } from "vitest";
import {
  loadPrompt,
  renderTemplate,
  _resetPromptCache,
} from "@/lib/ai/prompts";

describe("loadPrompt", () => {
  beforeEach(() => _resetPromptCache());

  it("loads blog/expand and parses frontmatter", () => {
    const p = loadPrompt("blog/expand");
    expect(p.name).toBe("blog/expand");
    expect(p.version).toBe(1);
    expect(p.model).toBe("gpt-4.1");
    expect(p.temperature).toBeCloseTo(0.4);
  });

  it("splits system and user template sections", () => {
    const p = loadPrompt("blog/expand");
    expect(p.system).toContain("expert editor");
    expect(p.system).toContain("Hard rules");
    expect(p.userTemplate).toContain("{current_word_count}");
    expect(p.userTemplate).toContain("{target_word_count}");
    expect(p.userTemplate).toContain("{shortfall}");
    expect(p.userTemplate).toContain("{voice_block}");
    expect(p.userTemplate).toContain("{current_content}");
  });

  it("caches — same object on repeat load", () => {
    const a = loadPrompt("blog/expand");
    const b = loadPrompt("blog/expand");
    expect(a).toBe(b);
  });
});

describe("renderTemplate", () => {
  it("interpolates provided keys", () => {
    expect(renderTemplate("Hello {name}", { name: "Alice" })).toBe(
      "Hello Alice"
    );
    expect(renderTemplate("{a} + {b} = {c}", { a: 1, b: 2, c: 3 })).toBe(
      "1 + 2 = 3"
    );
  });

  it("leaves unknown keys in place (so typos surface)", () => {
    expect(renderTemplate("Hello {name}", {})).toBe("Hello {name}");
    expect(renderTemplate("{known} and {unknown}", { known: "x" })).toBe(
      "x and {unknown}"
    );
  });

  it("doesn't touch punctuation or whitespace", () => {
    expect(renderTemplate("A\n{x}\nB", { x: "middle" })).toBe(
      "A\nmiddle\nB"
    );
  });
});
