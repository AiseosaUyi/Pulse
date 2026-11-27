/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { upsertEngagementItem, applyStatusConsistency } from "@/lib/services/action-queue";

function createMockSupabase(initialData: Record<string, any[]>) {
  const data: Record<string, any[]> = JSON.parse(JSON.stringify(initialData));

  return {
    rawDb: data,
    from(table: string) {
      if (!data[table]) data[table] = [];
      const filters: Array<(row: any) => boolean> = [];

      const chain: any = {
        select(_cols = "*") {
          return chain;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return chain;
        },
        insert(payload: any) {
          const row = { id: `id-${Math.random().toString(36).slice(2, 8)}`, ...payload };
          data[table].push(row);
          return {
            select() {
              return {
                single: async () => ({ data: row, error: null }),
                maybeSingle: async () => ({ data: row, error: null }),
              };
            },
          };
        },
        update(patch: any) {
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              const matching = data[table].filter((r) => filters.every((f) => f(r)));
              matching.forEach((r) => Object.assign(r, patch));
              return {
                select() {
                  return {
                    single: async () => ({ data: matching[0] ?? null, error: null }),
                    maybeSingle: async () => ({ data: matching[0] ?? null, error: null }),
                  };
                },
              };
            },
          };
        },
        maybeSingle: async () => {
          const found = data[table].find((r) => filters.every((f) => f(r)));
          return { data: found ?? null, error: null };
        },
        single: async () => {
          const found = data[table].find((r) => filters.every((f) => f(r)));
          return { data: found ?? null, error: null };
        },
      };

      return chain;
    },
  } as any;
}

describe("Inbox Status & Consistency Invariants (Step 5a)", () => {
  it("enforces applyStatusConsistency rules", () => {
    // Open status sets replied = false and nulls resolved_at
    const openRes = applyStatusConsistency("open");
    expect(openRes.status).toBe("open");
    expect(openRes.replied).toBe(false);
    expect(openRes.resolved_at).toBeNull();

    // Resolved status sets replied = true and stamps resolved_at
    const resRes = applyStatusConsistency("resolved");
    expect(resRes.status).toBe("resolved");
    expect(resRes.replied).toBe(true);
    expect(resRes.resolved_at).not.toBeNull();

    // chk_engagement_items_no_open_replied invariant: (status = 'open' and replied = true) is IMPOSSIBLE
    expect(openRes.status === "open" && openRes.replied === true).toBe(false);
  });

  it("never reopens a row a human resolved when caller passes status 'open'", async () => {
    const mockDb = createMockSupabase({
      engagement_items: [
        {
          id: "item-resolved-1",
          tenant_slug: "gruve",
          platform: "instagram",
          external_id: "ig:dm:thread1:msg1",
          status: "resolved",
          replied: true,
          resolved_at: "2026-11-10T12:00:00Z",
          content: "Original question",
          from_name: "Event Planner Lagos",
        },
      ],
      engagement_item_messages: [],
    });

    const res = await upsertEngagementItem(mockDb, "gruve", {
      platform: "instagram",
      type: "dm",
      externalId: "ig:dm:thread1:msg1",
      fromName: "Event Planner Lagos",
      content: "Follow up comment or repeated poll",
      receivedAt: "2026-11-13T10:00:00Z",
      status: "open", // Attempting to reopen!
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.statusIgnored).toBe(true);
      expect(res.warnings).toBeDefined();
      expect(res.warnings?.[0]).toContain("Ignored status 'open'");
    }

    // Verify row was NOT reopened in database
    const updatedRow = mockDb.rawDb.engagement_items.find((r: any) => r.id === "item-resolved-1");
    expect(updatedRow.status).toBe("resolved");
    expect(updatedRow.replied).toBe(true);
    expect(updatedRow.resolved_at).toBe("2026-11-10T12:00:00Z");

    // Verify content was updated and message history was appended
    expect(updatedRow.content).toBe("Follow up comment or repeated poll");
    expect(mockDb.rawDb.engagement_item_messages.length).toBe(1);
    expect(mockDb.rawDb.engagement_item_messages[0].content).toBe("Follow up comment or repeated poll");
  });
});
