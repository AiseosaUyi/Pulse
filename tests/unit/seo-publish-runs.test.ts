import { describe, it, expect, vi } from "vitest";

// Regression coverage for: post.status alone can't tell a staging-only
// publish from a live one (publish-runner.ts mark_published sets
// blog_posts.status to "published" identically for target "test" and
// "live"). getSucceededPublishTargets(ForTenant) is what the editor + post
// list actually gate the "View live" / "View on staging" links on — see
// src/lib/services/seo-publish-runs.ts.

type Row = { blog_post_id?: string; target: string; status?: string };

function chainable(rows: Row[]) {
  // Minimal thenable query-builder stub: every .eq() call just returns
  // itself so the real service's `.eq().eq().eq()` chains work regardless
  // of length, and awaiting the chain resolves to the fixture rows.
  const builder: PromiseLike<{ data: Row[]; error: null }> & {
    eq: (...args: unknown[]) => typeof builder;
  } = {
    eq: () => builder,
    then: (resolve) =>
      Promise.resolve({ data: rows, error: null }).then(resolve as never),
  };
  return builder;
}

function mockSupabaseWith(rows: Row[]) {
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: vi.fn().mockResolvedValue({
      from: () => ({
        select: () => chainable(rows),
      }),
    }),
  }));
}

describe("getSucceededPublishTargets", () => {
  it("reports only the targets with a succeeded row", async () => {
    vi.resetModules();
    mockSupabaseWith([{ target: "test" }]);
    const { getSucceededPublishTargets } = await import(
      "@/lib/services/seo-publish-runs"
    );
    const result = await getSucceededPublishTargets("gruve", "post-1");
    expect(result).toEqual({ live: false, test: true });
  });

  it("reports both when both targets have succeeded", async () => {
    vi.resetModules();
    mockSupabaseWith([{ target: "test" }, { target: "live" }]);
    const { getSucceededPublishTargets } = await import(
      "@/lib/services/seo-publish-runs"
    );
    const result = await getSucceededPublishTargets("gruve", "post-1");
    expect(result).toEqual({ live: true, test: true });
  });

  it("reports neither when there are no succeeded runs yet", async () => {
    vi.resetModules();
    mockSupabaseWith([]);
    const { getSucceededPublishTargets } = await import(
      "@/lib/services/seo-publish-runs"
    );
    const result = await getSucceededPublishTargets("gruve", "post-1");
    expect(result).toEqual({ live: false, test: false });
  });
});

describe("getSucceededPublishTargetsForTenant", () => {
  it("groups succeeded runs by blog_post_id", async () => {
    vi.resetModules();
    mockSupabaseWith([
      { blog_post_id: "post-1", target: "test" },
      { blog_post_id: "post-2", target: "live" },
      { blog_post_id: "post-2", target: "test" },
    ]);
    const { getSucceededPublishTargetsForTenant } = await import(
      "@/lib/services/seo-publish-runs"
    );
    const result = await getSucceededPublishTargetsForTenant("gruve");
    expect(result).toEqual({
      "post-1": { live: false, test: true },
      "post-2": { live: true, test: true },
    });
    // A post with no succeeded run at all is simply absent from the map.
    expect(result["post-3"]).toBeUndefined();
  });
});
