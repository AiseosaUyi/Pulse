import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveHandoffStaleDays } from "../../src/lib/actions/handoff-settings";

// Inline mock mirroring the action's exact call chains:
//   from("tenants").select("settings").eq("slug", s).maybeSingle()
//   from("tenants").update({ settings }).eq("slug", s)
function mockTenant(settings: Record<string, unknown> | null) {
  const update = vi.fn();
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { settings }, error: null }),
        }),
      }),
      update: (payload: unknown) => {
        update(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
  return update;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1" } as never);
});

describe("saveHandoffStaleDays", () => {
  it.each([0, 91, 1.5, -1])("rejects %s without touching the DB", async (days) => {
    const res = await saveHandoffStaleDays("acme", days);
    expect(res.success).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
    const res = await saveHandoffStaleDays("acme", 14);
    expect(res.success).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("merges into existing settings, preserving sibling keys", async () => {
    const update = mockTenant({ sharedInbox: { enabled: true }, other: "keep" });
    const res = await saveHandoffStaleDays("acme", 30);
    expect(res.success).toBe(true);
    expect(update).toHaveBeenCalledWith({
      settings: { sharedInbox: { enabled: true }, other: "keep", handoffStaleAfterDays: 30 },
    });
  });

  it("handles null existing settings", async () => {
    const update = mockTenant(null);
    const res = await saveHandoffStaleDays("acme", 5);
    expect(res.success).toBe(true);
    expect(update).toHaveBeenCalledWith({ settings: { handoffStaleAfterDays: 5 } });
  });
});
