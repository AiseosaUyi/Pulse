import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, visibleSettings } from "@/components/settings/SettingsNav";

const tabs = (s: ReturnType<typeof visibleSettings>) => s.flatMap((x) => x.tabs.map((t) => t.href));

describe("settings sections", () => {
  it("has six sections", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      "Account",
      "Workspace",
      "Leads",
      "Content",
      "Connections",
      "Usage",
    ]);
  });

  it("every settings page is in a section", () => {
    const dir = join(process.cwd(), "src/app/(app)/settings");
    const pages = readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory() && !d.startsWith("_"));
    const linked = new Set(SETTINGS_SECTIONS.flatMap((s) => s.tabs.map((t) => t.href)));
    for (const p of pages) expect(linked.has(`/settings/${p}`), p).toBe(true);
  });

  it("hides pages of switched-off features", () => {
    const out = tabs(visibleSettings("startup", "owner", { intel: false, video: false }));
    expect(out).not.toContain("/settings/x-listening");
    expect(out).not.toContain("/settings/trend-scouts");
    expect(out).not.toContain("/settings/content-engine");
    expect(out).toContain("/settings/social-publishing");
  });

  it("support only sees Account", () => {
    expect(visibleSettings("startup", "support", undefined).map((s) => s.label)).toEqual(["Account"]);
  });
});
