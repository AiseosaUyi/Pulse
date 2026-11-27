import { describe, expect, it } from "vitest";
import { FEATURES, featureForPath, resolveFeatures } from "@/lib/features/registry";
import { navGroups, navGroupsForAccountType, navGroupsForFeatures, navGroupsForRole } from "@/lib/nav-config";

describe("resolveFeatures", () => {
  it("keeps an explicit switch over data", () => {
    const r = resolveFeatures({ video: false, tasks: true }, { video: true, tasks: false });
    expect(r.video).toBe(false);
    expect(r.tasks).toBe(true);
  });

  it("switches a feature on when the workspace has data for it", () => {
    expect(resolveFeatures({}, { video: true }).video).toBe(true);
  });

  it("keeps a feature on when the data check failed", () => {
    expect(resolveFeatures({}, { video: null }).video).toBe(true);
  });

  it("falls back to the default when there is no data", () => {
    const r = resolveFeatures({}, Object.fromEntries(FEATURES.map((f) => [f.key, false])));
    for (const f of FEATURES) expect(r[f.key]).toBe(f.defaultOn);
  });
});

describe("featureForPath", () => {
  it("maps routes and sub-routes, not look-alikes", () => {
    expect(featureForPath("/video")).toBe("video");
    expect(featureForPath("/video/abc")).toBe("video");
    expect(featureForPath("/videos")).toBeNull();
    expect(featureForPath("/leads")).toBeNull();
    expect(featureForPath("/dashboard")).toBeNull();
  });
});

describe("navGroupsForFeatures", () => {
  const startup = navGroupsForAccountType("startup");
  const hrefs = (g: typeof navGroups) => g.flatMap((x) => x.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]));

  it("hides switched-off features and keeps core items", () => {
    const out = hrefs(navGroupsForFeatures(startup, { video: false, ads: false }));
    expect(out).not.toContain("/video");
    expect(out).not.toContain("/ads-tracker");
    expect(out).toContain("/leads");
    expect(out).toContain("/conversations");
    expect(out).toContain("/dashboard");
  });

  it("changes nothing without switches", () => {
    expect(navGroupsForFeatures(startup, undefined)).toEqual(startup);
  });

  it("drops a parent whose children are all off", () => {
    const out = hrefs(navGroupsForFeatures(startup, { content_library: false }));
    expect(out).not.toContain("/content-vault");
    expect(out).not.toContain("/ai-content");
  });
});

describe("simple sidebar", () => {
  const top = (g: typeof navGroups) => g.flatMap((x) => x.items.map((i) => i.label));
  const hrefs = (g: typeof navGroups) => g.flatMap((x) => x.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]));

  it("startup sees four jobs", () => {
    expect(top(navGroupsForAccountType("startup"))).toEqual(["Home", "Leads", "Content", "Insights"]);
  });

  it("every page reachable before is still in the nav for some persona", () => {
    const all = new Set([...hrefs(navGroupsForAccountType("startup")), ...hrefs(navGroupsForAccountType("individual"))]);
    for (const h of [
      "/dashboard", "/tasks", "/own-analytics", "/leads", "/autopilot", "/conversations", "/intel-feed",
      "/seo-tracker", "/composer", "/ai-content", "/content-vault", "/video", "/content-calendar",
      "/schedule", "/broadcasts", "/post-history", "/platform-score", "/ads-tracker",
    ]) expect(all.has(h), h).toBe(true);
  });

  it("a job with one tool left becomes a plain link to it", () => {
    const g = navGroupsForFeatures(navGroupsForAccountType("startup"), { tasks: false });
    const home = g[0].items.find((i) => i.href === "/dashboard")!;
    expect(home.children).toBeUndefined();
    expect(home.label).toBe("Home");
  });

  it("support sees only Home and Conversations", () => {
    const g = navGroupsForRole(navGroupsForAccountType("startup"), "support");
    expect(hrefs(g)).toEqual(["/dashboard", "/conversations"]);
  });
});
