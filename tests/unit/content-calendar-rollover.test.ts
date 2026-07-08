import { describe, it, expect } from "vitest";
import { getNextUnpostedSlot } from "@/lib/services/content-calendar-lifecycle";

// Minimal fake Supabase client covering only the chained calls
// retireStaleSlots/getNextUnpostedSlot actually use, in-memory. Verifies the
// rollover worked example flagged during adversarial review: positions
// 1-3 posted, 4 skipped, 5 in_progress -> next = 5 (1-3 excluded by
// status, 4 excluded by status, 5 is the lowest remaining position).
function makeFakeAdmin(rows: Array<Record<string, unknown>>) {
  return {
    from(_table: string) {
      const state: { filters: Array<(r: Record<string, unknown>) => boolean> } = {
        filters: [],
      };
      const builder = {
        update(_patch: Record<string, unknown>) {
          // retireStaleSlots' update chain — no rows in these tests are
          // ever old enough to match its `.lt("generated_at", cutoff)`,
          // so it's a no-op here; the important assertion is the select
          // chain below.
          return {
            eq: () => ({ in: () => ({ lt: async () => ({ error: null }) }) }),
          };
        },
        select(_cols: string) {
          return {
            eq(field: string, value: unknown) {
              state.filters.push((r) => r[field] === value);
              return this;
            },
            in(field: string, values: unknown[]) {
              state.filters.push((r) => values.includes(r[field]));
              return this;
            },
            order(field: string, opts: { ascending: boolean }) {
              return {
                limit: () => ({
                  maybeSingle: async () => {
                    const matched = rows.filter((r) =>
                      state.filters.every((f) => f(r))
                    );
                    matched.sort((a, b) =>
                      opts.ascending
                        ? (a[field] as number) - (b[field] as number)
                        : (b[field] as number) - (a[field] as number)
                    );
                    return { data: matched[0] ?? null, error: null };
                  },
                }),
              };
            },
          };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const BASE = {
  tenant_slug: "aiseosa-space",
  topic_title: "t",
  topic_brief: {},
  notes: null,
  video_asset_url: null,
  platforms: [],
  retired_reason: null,
  generated_at: new Date().toISOString(),
  posted_at: null,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("getNextUnpostedSlot rollover", () => {
  it("skips posted and skipped slots, returns the lowest-position remaining slot", async () => {
    const rows = [
      { ...BASE, id: "1", position: 1, status: "posted" },
      { ...BASE, id: "2", position: 2, status: "posted" },
      { ...BASE, id: "3", position: 3, status: "posted" },
      { ...BASE, id: "4", position: 4, status: "skipped" },
      { ...BASE, id: "5", position: 5, status: "in_progress" },
    ];
    const admin = makeFakeAdmin(rows);
    const next = await getNextUnpostedSlot(admin, "aiseosa-space");
    expect(next?.id).toBe("5");
  });

  it("returns null when every slot is posted or skipped", async () => {
    const rows = [
      { ...BASE, id: "1", position: 1, status: "posted" },
      { ...BASE, id: "2", position: 2, status: "skipped" },
    ];
    const admin = makeFakeAdmin(rows);
    const next = await getNextUnpostedSlot(admin, "aiseosa-space");
    expect(next).toBeNull();
  });

  it("prefers an earlier assigned slot over a later in_progress one", async () => {
    const rows = [
      { ...BASE, id: "1", position: 1, status: "assigned" },
      { ...BASE, id: "2", position: 2, status: "in_progress" },
    ];
    const admin = makeFakeAdmin(rows);
    const next = await getNextUnpostedSlot(admin, "aiseosa-space");
    expect(next?.id).toBe("1");
  });
});
