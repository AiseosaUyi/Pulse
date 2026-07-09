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
      const state: {
        filters: Array<(r: Record<string, unknown>) => boolean>;
        sorts: Array<{ field: string; ascending: boolean }>;
      } = { filters: [], sorts: [] };
      const builder = {
        // retireStaleSlots' and rolloverOverdueSlots' update chain — no
        // rows in these tests are old/overdue enough to match either
        // `.lt(...)` filter, so this is a no-op; the select chain below
        // is what these tests actually assert on.
        update(_patch: Record<string, unknown>) {
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
              state.sorts.push({ field, ascending: opts.ascending });
              return this;
            },
            limit: () => ({
              maybeSingle: async () => {
                const matched = rows.filter((r) => state.filters.every((f) => f(r)));
                matched.sort((a, b) => {
                  for (const { field, ascending } of state.sorts) {
                    const av = a[field] as string | number;
                    const bv = b[field] as string | number;
                    if (av === bv) continue;
                    const cmp = av < bv ? -1 : 1;
                    return ascending ? cmp : -cmp;
                  }
                  return 0;
                });
                return { data: matched[0] ?? null, error: null };
              },
            }),
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
  scheduled_date: new Date().toISOString().slice(0, 10),
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

  it("orders by scheduled_date first, position only as a same-day tiebreaker", async () => {
    const rows = [
      { ...BASE, id: "1", position: 1, scheduled_date: "2026-08-01", status: "assigned" },
      { ...BASE, id: "2", position: 5, scheduled_date: "2026-07-15", status: "assigned" },
      { ...BASE, id: "3", position: 3, scheduled_date: "2026-07-15", status: "assigned" },
    ];
    const admin = makeFakeAdmin(rows);
    const next = await getNextUnpostedSlot(admin, "aiseosa-space");
    // Earliest date wins (2 and 3 beat 1); within that date, lower
    // position wins (3 beats 2).
    expect(next?.id).toBe("3");
  });
});
