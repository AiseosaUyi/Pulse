/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { upsertTeamMember, updateTeamMember, deleteTeamMember } from "@/lib/services/team";
import { createTask, updateTask, archiveTask, completeOccurrence } from "@/lib/services/tasks";

const PROTECTED_TABLES = [
  "tasks",
  "task_occurrences",
  "task_checks",
  "task_events",
  "task_comments",
  "person_leave",
  "person_streaks",
  "team_people",
];

/**
 * Creates a mock Supabase client that strictly enforces Migration 113 RLS:
 * - Members (role: "authenticated") only have SELECT ("members read") on the 8 tables.
 * - Any INSERT, UPDATE, DELETE, or UPSERT from a member client throws an RLS error.
 * - Admin (role: "service_role") has full permissions.
 */
function createRlsEnforcingClient(role: "authenticated" | "service_role", initialData: Record<string, any[]> = {}) {
  const data: Record<string, any[]> = JSON.parse(JSON.stringify(initialData));

  return {
    role,
    from(table: string) {
      if (!data[table]) data[table] = [];
      const filters: Array<(row: any) => boolean> = [];
      let updates: Record<string, any> = {};

      const isProtectedTable = PROTECTED_TABLES.includes(table);

      const chain = {
        select(_cols = "*") {
          return chain;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return chain;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return chain;
        },
        in(col: string, vals: any[]) {
          filters.push((r) => vals.includes(r[col]));
          return chain;
        },
        maybeSingle() {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        single() {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({
            data: matched[0] ?? null,
            error: matched[0] ? null : { message: "Not found" },
          });
        },
        update(patch: Record<string, any>) {
          if (role === "authenticated" && isProtectedTable) {
            return {
              eq() { return this; },
              in() { return this; },
              select() { return this; },
              maybeSingle() {
                return Promise.resolve({
                  data: null,
                  error: { message: `new row violates row-level security policy for table "${table}"` },
                });
              },
              then(resolve: (res: any) => void) {
                resolve({
                  data: null,
                  error: { message: `new row violates row-level security policy for table "${table}"` },
                });
              },
            };
          }
          updates = patch;
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              return this;
            },
            in(col: string, vals: any[]) {
              filters.push((r) => vals.includes(r[col]));
              return this;
            },
            select() { return this; },
            maybeSingle() {
              const matched = data[table].filter((r) => filters.every((f) => f(r)));
              for (const row of matched) Object.assign(row, updates);
              return Promise.resolve({ data: matched[0] ?? null, error: null });
            },
            then(resolve: (res: any) => void) {
              const matched = data[table].filter((r) => filters.every((f) => f(r)));
              for (const row of matched) Object.assign(row, updates);
              resolve({ data: matched, error: null });
            },
          };
        },
        insert(rows: any | any[]) {
          if (role === "authenticated" && isProtectedTable) {
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: null,
                      error: { message: `new row violates row-level security policy for table "${table}"` },
                    });
                  },
                  maybeSingle() {
                    return Promise.resolve({
                      data: null,
                      error: { message: `new row violates row-level security policy for table "${table}"` },
                    });
                  },
                  then(resolve: (res: any) => void) {
                    resolve({
                      data: null,
                      error: { message: `new row violates row-level security policy for table "${table}"` },
                    });
                  },
                };
              },
              then(resolve: (res: any) => void) {
                resolve({
                  data: null,
                  error: { message: `new row violates row-level security policy for table "${table}"` },
                });
              },
            };
          }
          const arr = Array.isArray(rows) ? rows : [rows];
          const insertedArr: any[] = [];
          for (const item of arr) {
            const id = item.id || `gen-${Math.random().toString(36).slice(2, 9)}`;
            const row = { ...item, id };
            data[table].push(row);
            insertedArr.push(row);
          }
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: insertedArr[0], error: null });
                },
                maybeSingle() {
                  return Promise.resolve({ data: insertedArr[0], error: null });
                },
                then(resolve: (res: any) => void) {
                  resolve({ data: insertedArr, error: null });
                },
              };
            },
            then(resolve: (res: any) => void) {
              resolve({ data: insertedArr, error: null });
            },
          };
        },
        upsert(rows: any | any[], _opts?: any) {
          if (role === "authenticated" && isProtectedTable) {
            return {
              select() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: null,
                      error: { message: `new row violates row-level security policy for table "${table}"` },
                    });
                  },
                };
              },
              then(resolve: (res: any) => void) {
                resolve({
                  data: null,
                  error: { message: `new row violates row-level security policy for table "${table}"` },
                });
              },
            };
          }
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const item of arr) {
            const idx = data[table].findIndex((r) => r.id === item.id);
            if (idx >= 0) Object.assign(data[table][idx], item);
            else data[table].push(item);
          }
          return {
            select() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: arr[0], error: null });
                },
              };
            },
            then(resolve: (res: any) => void) {
              resolve({ data: arr, error: null });
            },
          };
        },
        delete() {
          if (role === "authenticated" && isProtectedTable) {
            return {
              eq() { return this; },
              in() { return this; },
              then(resolve: (res: any) => void) {
                resolve({
                  data: null,
                  error: { message: `new row violates row-level security policy for table "${table}"` },
                });
              },
            };
          }
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              return this;
            },
            in(col: string, vals: any[]) {
              filters.push((r) => vals.includes(r[col]));
              return this;
            },
            then(resolve: (res: any) => void) {
              data[table] = data[table].filter((r) => !filters.every((f) => f(r)));
              resolve({ data: null, error: null });
            },
          };
        },
        then(resolve: (res: any) => void) {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          resolve({ data: matched, error: null });
        },
      };

      return chain;
    },
    rpc(_fnName: string, _args: Record<string, any>) {
      return Promise.resolve({ error: null });
    },
    _getRawData() {
      return data;
    },
  } as any;
}

describe("Migration 113 RLS & Server Action Client Audit", () => {
  it("fails any member write to the 8 tables under Migration 113 RLS, but succeeds with admin client", async () => {
    const tenantSlug = "acme";
    const userClient = createRlsEnforcingClient("authenticated", {
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
    });
    const adminClient = createRlsEnforcingClient("service_role", {
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
    });

    // 1. Team roster mutations (team_people)
    const memberInput = {
      name: "Alice Rep",
      roleTitle: "Account Executive",
      active: true,
      weeklyTargets: { reachOuts: 50 },
    };

    // User client MUST fail under Migration 113 RLS
    const userSaveRes = await upsertTeamMember(userClient, tenantSlug, memberInput);
    expect(userSaveRes.ok).toBe(false);
    if (!userSaveRes.ok) {
      expect(userSaveRes.error).toContain("violates row-level security policy");
    }

    // Admin client MUST succeed
    const adminSaveRes = await upsertTeamMember(adminClient, tenantSlug, memberInput);
    expect(adminSaveRes.ok).toBe(true);
    if (adminSaveRes.ok) {
      expect(adminSaveRes.member?.name).toBe("Alice Rep");
      const memberId = adminSaveRes.member!.id;

      // Update targets fails with user client, succeeds with admin
      const userUpdateRes = await updateTeamMember(userClient, tenantSlug, memberId, {
        weeklyTargets: { reachOuts: 60 },
      });
      expect(userUpdateRes.ok).toBe(false);

      const adminUpdateRes = await updateTeamMember(adminClient, tenantSlug, memberId, {
        weeklyTargets: { reachOuts: 60 },
      });
      expect(adminUpdateRes.ok).toBe(true);

      // Deactivation / deletion fails with user client, succeeds with admin
      const userDeleteRes = await deleteTeamMember(userClient, tenantSlug, memberId);
      expect(userDeleteRes.ok).toBe(false);

      const adminDeleteRes = await deleteTeamMember(adminClient, tenantSlug, memberId);
      expect(adminDeleteRes.ok).toBe(true);
    }

    // 2. Task mutations (tasks)
    const taskInput = {
      title: "Daily Standup",
      kind: "recurring" as const,
      recurrence: "daily" as const,
      startDate: "2026-11-01",
    };

    // Creating task with user client throws/fails RLS
    await expect(createTask(userClient, tenantSlug, taskInput, "user-123")).rejects.toThrow(
      /violates row-level security policy/
    );

    // Creating task with admin client succeeds
    const createdTask = await createTask(adminClient, tenantSlug, taskInput, "user-123");
    expect(createdTask.id).toBeDefined();
    expect(createdTask.title).toBe("Daily Standup");
  });

  it("verifies static code audit: settings/actions.ts team roster mutations strictly use createAdminClient", () => {
    const settingsActionsPath = path.resolve(
      process.cwd(),
      "src/app/(app)/settings/actions.ts"
    );
    const content = fs.readFileSync(settingsActionsPath, "utf-8");

    // Extract function bodies for the 4 team roster mutations
    const functionsToVerify = [
      { name: "saveTeamMember", serviceCall: "upsertTeamMember" },
      { name: "updateTeamMemberTargetsAction", serviceCall: "updateTeamMember" },
      { name: "toggleTeamMemberActiveAction", serviceCall: "updateTeamMember" },
      { name: "deleteTeamMemberAction", serviceCall: "deleteTeamMember" },
      { name: "linkPersonToUserAction", serviceCall: "team_people" },
    ];

    for (const fn of functionsToVerify) {
      const fnRegex = new RegExp(`export async function ${fn.name}[\\s\\S]*?\\n}`);
      const match = content.match(fnRegex);
      expect(match, `Could not find function ${fn.name} in settings/actions.ts`).toBeDefined();

      const body = match![0];

      // Must call createAdminClient()
      expect(body).toContain("createAdminClient()");

      // Must NOT call await createClient() in that function body
      expect(body).not.toContain("await createClient()");

      // Must pass admin client to the service
      if (fn.serviceCall !== "team_people") {
        expect(body).toMatch(new RegExp(`${fn.serviceCall}\\s*\\(\\s*admin\\b`));
      } else {
        expect(body).toContain('admin\n      .from("team_people")');
      }
    }
  });

  it("verifies static code audit: no server action or API route writes to the 8 tables via createClient()", () => {
    // Scan all files in src/lib/actions/ and src/app/
    function getAllFiles(dir: string, fileList: string[] = []): string[] {
      if (!fs.existsSync(dir)) return fileList;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          getAllFiles(fullPath, fileList);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const actionFiles = [
      ...getAllFiles(path.resolve(process.cwd(), "src/lib/actions")),
      ...getAllFiles(path.resolve(process.cwd(), "src/app/(app)/settings")),
      ...getAllFiles(path.resolve(process.cwd(), "src/app/api/v1/tasks")),
    ];

    const violations: Array<{ file: string; line: string }> = [];

    // Pattern detecting user client writing to any of the 8 tables:
    // e.g. `supabase.from("team_people").insert/update/delete/upsert`
    for (const filePath of actionFiles) {
      const fileText = fs.readFileSync(filePath, "utf-8");
      const lines = fileText.split("\n");

      lines.forEach((line, idx) => {
        for (const tbl of PROTECTED_TABLES) {
          if (
            line.includes(`from("${tbl}")`) ||
            line.includes(`from('${tbl}')`)
          ) {
            // Check context lines around this call (next 5 lines)
            const snippet = lines.slice(idx, idx + 6).join("\n");
            const isMutation =
              snippet.includes(".insert(") ||
              snippet.includes(".update(") ||
              snippet.includes(".delete(") ||
              snippet.includes(".upsert(");

            if (isMutation) {
              // Ensure this snippet uses admin / createAdminClient, not user-scoped supabase
              if (
                line.includes("supabase.") &&
                !snippet.includes("createAdminClient") &&
                !fileText.includes("const supabase = createAdminClient()")
              ) {
                violations.push({
                  file: path.relative(process.cwd(), filePath),
                  line: `Line ${idx + 1}: ${line.trim()}`,
                });
              }
            }
          }
        }
      });
    }

    expect(
      violations,
      `Found user-scoped client mutating protected tables:\n${violations
        .map((v) => `${v.file}: ${v.line}`)
        .join("\n")}`
    ).toEqual([]);
  });
});
