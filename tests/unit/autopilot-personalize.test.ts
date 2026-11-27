import { describe, it, expect, vi } from "vitest";
import { FakeDb, fakeClient } from "../helpers/fake-db";
import { pageTextForPrompt, personalCopyWarnings, tidyPersonalCopy } from "@/lib/outreach-autopilot/personal-copy";
import { composeAndSaveDrafts, plainHook } from "@/lib/services/outreach-composition";

const T = "acme";

const config = {
  workspace: T,
  tenant_slug: T,
  default_segment: "bars",
  segments: { bars: { proof: ["We work with 40 bars."], offer: ["Next-day delivery."], ask: ["Worth a chat?"] } },
  banned_regex: "\\bpartnership\\b",
  promise_regex: "\\bguarantee\\b",
  bad_subject_regex: "\\bquick idea\\b",
  verdict_regex: "\\bamazing\\b",
  word_limits: { subject: [3, 7], hook: [8, 22], idea: [10, 45] },
  signature: "Jane, Acme",
  blocked_countries: "^$",
  idea_prefix: "What if",
};

const lead = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  tenant_slug: T,
  status: "new",
  segment: "bars",
  platform: "instagram",
  handle: "thelounge",
  company_name: "The Lounge",
  email: "hello@thelounge.ng",
  email_status: "verified",
  signal_data: {},
  ...over,
});

describe("personal copy helpers", () => {
  it("keeps visible text only", () => {
    const html = "<html><script>var x=1</script><style>a{}</style><h1>Rooftop bar</h1><p>Live jazz &amp; cocktails</p></html>";
    expect(pageTextForPrompt(html)).toBe("Rooftop bar Live jazz & cocktails");
    expect(pageTextForPrompt("<p>" + "a".repeat(5000) + "</p>", 100)).toHaveLength(100);
  });

  it("fixes punctuation and idea shape without changing meaning", () => {
    const out = tidyPersonalCopy(
      { subject: "Jazz nights at The Lounge.", hook: "You run jazz nights every Friday — on the rooftop", idea: "we could stock your bar for those nights!" },
      "What if"
    );
    expect(out.subject).toBe("Jazz nights at The Lounge");
    expect(out.hook).toBe("You run jazz nights every Friday, on the rooftop.");
    expect(out.idea).toBe("What if we could stock your bar for those nights?");
  });

  it("flags links or addresses in AI lines", () => {
    expect(personalCopyWarnings({ subject: "a", hook: "see www.evil.com", idea: "x" })).toHaveLength(1);
    expect(personalCopyWarnings({ subject: "a", hook: "mail me@x.ng", idea: "x" })).toHaveLength(1);
    expect(personalCopyWarnings({ subject: "Jazz nights", hook: "You host jazz.", idea: "What if?" })).toEqual([]);
  });

  it("plain hook is neutral and names the platform", () => {
    expect(plainHook("The Lounge", "instagram")).toBe("I came across The Lounge on Instagram.");
    expect(plainHook("The Lounge", "manual")).toBe("I came across The Lounge recently.");
  });
});

describe("composeAndSaveDrafts with a personaliser", () => {
  it("uses AI lines for leads with no researched hook, and keeps researched ones", async () => {
    const plain = lead();
    const researched = lead({ handle: "b", signal_data: { hook: "You opened a second branch in Lekki.", idea: "What if we supplied both?" } });
    const db = new FakeDb({ outreach_configs: [config], prospects: [plain, researched], outbound_dms: [] });
    const personalize = vi.fn(async () => ({
      subject: "Jazz nights at The Lounge",
      hook: "You host live jazz on the rooftop every Friday.",
      idea: "What if your Friday bar never ran short of the drinks your crowd orders most?",
    }));

    await composeAndSaveDrafts(fakeClient(db), T, { prospectIds: [plain.id, researched.id], personalize });

    expect(personalize).toHaveBeenCalledTimes(1);
    const dms = db.rows("outbound_dms");
    const a = dms.find((d) => d.prospect_id === plain.id)!;
    const b = dms.find((d) => d.prospect_id === researched.id)!;
    expect(a.subject).toBe("Jazz nights at The Lounge");
    expect(String(a.body)).toContain("You host live jazz on the rooftop every Friday.");
    expect(a.lint_warnings).not.toContainEqual(expect.stringContaining("No personal opening line"));
    expect(String(b.body)).toContain("You opened a second branch in Lekki.");
    expect(a.status).toBe("drafted");
  });

  it("falls back to neutral copy with a warning when there is nothing to go on", async () => {
    const p = lead({ platform: "manual" });
    const db = new FakeDb({ outreach_configs: [config], prospects: [p], outbound_dms: [] });

    await composeAndSaveDrafts(fakeClient(db), T, { prospectIds: [p.id], personalize: async () => null });

    const dm = db.rows("outbound_dms")[0];
    expect(String(dm.body)).toContain("I came across The Lounge recently.");
    expect(String(dm.body)).not.toMatch(/event/i);
    expect(dm.lint_warnings).toContainEqual(expect.stringContaining("No personal opening line"));
  });

  it("a personaliser that throws never stops drafting", async () => {
    const p = lead();
    const db = new FakeDb({ outreach_configs: [config], prospects: [p], outbound_dms: [] });
    await composeAndSaveDrafts(fakeClient(db), T, {
      prospectIds: [p.id],
      personalize: async () => {
        throw new Error("model down");
      },
    });
    expect(db.rows("outbound_dms")).toHaveLength(1);
  });
});
