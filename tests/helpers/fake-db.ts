// In-memory stand-in for the slice of the Supabase query builder the
// autopilot uses. Filters, ordering, limits, counts and update-returning all
// behave like PostgREST closely enough to test business rules. No network.

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new Builder(this, table);
  }
}

class Builder {
  private op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private onConflict: string[] = [];
  private returning = false;
  private cols = "*";
  private head = false;
  private orderBy: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.cols = cols;
      this.head = Boolean(opts?.head);
    } else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  upsert(p: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = p;
    this.onConflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op !== "is") throw new Error(`fake not(${op}) unsupported`);
    this.filters.push((r) => (r[c] ?? null) !== v);
    return this;
  }
  private cmp(c: string, v: unknown, f: (a: string | number, b: string | number) => boolean) {
    this.filters.push((r) => r[c] !== null && r[c] !== undefined && f(r[c] as string, v as string));
    return this;
  }
  lt(c: string, v: unknown) {
    return this.cmp(c, v, (a, b) => a < b);
  }
  lte(c: string, v: unknown) {
    return this.cmp(c, v, (a, b) => a <= b);
  }
  gt(c: string, v: unknown) {
    return this.cmp(c, v, (a, b) => a > b);
  }
  gte(c: string, v: unknown) {
    return this.cmp(c, v, (a, b) => a >= b);
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private match(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private project(r: Row): Row {
    const out = { ...r };
    const embed = /(\w+)\(([^)]*)\)/.exec(this.cols);
    if (embed && embed[1] === "prospects") {
      out.prospects = this.db.rows("prospects").find((p) => p.id === r.prospect_id) ?? null;
    }
    return out;
  }

  private exec(): { data: unknown; error: null; count?: number } {
    const now = new Date().toISOString();
    switch (this.op) {
      case "select": {
        let rows = this.match();
        for (const o of [...this.orderBy].reverse()) {
          rows = [...rows].sort((a, b) => {
            const x = a[o.col] as string;
            const y = b[o.col] as string;
            if (x === y) return 0;
            if (x === null || x === undefined) return 1;
            if (y === null || y === undefined) return -1;
            return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
          });
        }
        const count = rows.length;
        if (this.limitN !== null) rows = rows.slice(0, this.limitN);
        return { data: this.head ? null : rows.map((r) => this.project(r)), error: null, count };
      }
      case "update": {
        const rows = this.match();
        for (const r of rows) Object.assign(r, this.payload, { updated_at: now });
        return { data: this.returning ? rows.map((r) => ({ ...r })) : null, error: null };
      }
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const made = list.map((p) => ({ id: randomUUID(), created_at: now, updated_at: now, ...p }));
        this.db.rows(this.table).push(...made);
        return { data: this.returning ? made.map((r) => ({ ...r })) : null, error: null };
      }
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const out: Row[] = [];
        for (const p of list) {
          const hit = this.db.rows(this.table).find((r) => this.onConflict.every((k) => r[k] === p[k]));
          if (hit) {
            Object.assign(hit, p, { updated_at: now });
            out.push(hit);
          } else {
            const made = { id: randomUUID(), created_at: now, updated_at: now, ...p };
            this.db.rows(this.table).push(made);
            out.push(made);
          }
        }
        return { data: this.returning ? out : null, error: null };
      }
      case "delete": {
        const keep = this.db.rows(this.table).filter((r) => !this.filters.every((f) => f(r)));
        this.db.tables[this.table] = keep;
        return { data: null, error: null };
      }
    }
  }

  async maybeSingle() {
    const r = this.exec();
    const arr = (r.data as Row[] | null) ?? [];
    return { data: arr[0] ?? null, error: null };
  }
  async single() {
    const r = this.exec();
    const arr = (r.data as Row[] | null) ?? [];
    return arr[0] ? { data: arr[0], error: null } : { data: null, error: { message: "no rows" } };
  }
  then<T>(resolve: (v: { data: unknown; error: null; count?: number }) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.exec()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

export function fakeClient(db: FakeDb) {
  return { from: (t: string) => db.from(t) } as never;
}
