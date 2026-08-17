// Minimal fluent Supabase-client fake for testing "use server" action files
// without a real Next.js request scope (cookies() from next/headers throws
// outside one — see src/lib/supabase/server.ts). Mirrors the exact call
// shapes lib/actions/inbound-messages.ts uses: .select().eq().single(),
// .select().eq().eq().or() (awaited directly, no terminal method), and
// .update().eq() / .update().in(). NOT a general-purpose Supabase mock —
// deliberately narrow to what these tests actually exercise.

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

interface FakeResult {
  data: FakeRow[];
  error: null;
}

function matchAll(rows: FakeRow[], predicates: Array<(row: FakeRow) => boolean>): FakeRow[] {
  return rows.filter((r) => predicates.every((p) => p(r)));
}

export function makeFakeSupabase(tables: FakeTables) {
  function builder(table: string) {
    const rows = tables[table] ?? [];
    const predicates: Array<(row: FakeRow) => boolean> = [];
    let updatePatch: FakeRow | null = null;

    const respond = (): FakeResult => {
      const matched = matchAll(rows, predicates);
      if (updatePatch) matched.forEach((r) => Object.assign(r, updatePatch));
      return { data: matched, error: null };
    };

    const api = {
      select: () => api,
      update: (patch: FakeRow) => {
        updatePatch = patch;
        return api;
      },
      eq: (col: string, val: unknown) => {
        predicates.push((r) => r[col] === val);
        return api;
      },
      or: () => api, // status-aware bound isn't exercised at this granularity here
      in: (col: string, vals: unknown[]) => {
        predicates.push((r) => vals.includes(r[col]));
        return respond();
      },
      single: async () => {
        const matched = matchAll(rows, predicates);
        if (matched.length !== 1) {
          return { data: null, error: { message: "not found" } };
        }
        return { data: matched[0], error: null };
      },
      // Makes `await query` work when the call chain ends without a
      // terminal method (e.g. .select().eq().eq().or()).
      then: (resolve: (v: FakeResult) => void) => resolve(respond()),
    };
    return api;
  }

  return { from: (table: string) => builder(table) };
}
