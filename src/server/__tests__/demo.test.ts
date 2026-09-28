import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Generates the demo workspace against an in-memory fake Supabase client, then loads every generated row into a real
 * Postgres (PGlite) with the production migrations, so all constraints, checks and foreign keys are enforced.
 */
type Row = Record<string, unknown>;
const store: Record<string, Row[]> = {};

function builder(table: string) {
  let rows: Row[] | null = null;
  let filters: [string, unknown][] = [];
  let patch: Row | null = null;
  const api = {
    insert(r: Row | Row[]) {
      const list = (Array.isArray(r) ? r : [r]).map((x) => ({ id: x.id ?? randomUUID(), ...x }));
      (store[table] ??= []).push(...list);
      rows = list;
      return api;
    },
    update(p: Row) {
      patch = p;
      return api;
    },
    select() {
      return api;
    },
    eq(k: string, v: unknown) {
      filters.push([k, v]);
      return api;
    },
    limit() {
      return api;
    },
    order() {
      return api;
    },
    result() {
      const src = rows ?? (store[table] ?? []);
      const out = src.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (patch) for (const r of out) Object.assign(r, patch);
      return out;
    },
    single() {
      return Promise.resolve({ data: api.result()[0] ?? null, error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: api.result()[0] ?? null, error: null });
    },
    then(res: (v: { data: Row[]; error: null }) => unknown) {
      const d = api.result();
      filters = [];
      return Promise.resolve({ data: d, error: null }).then(res);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  admin: () => ({ from: (t: string) => builder(t) }),
  must: (res: { data: unknown; error: { message: string } | null }) => {
    if (res.error || !res.data) throw new Error("must failed");
    return res.data;
  },
}));

const ORG = "10000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-00000000000a";

describe("demo workspace", () => {
  let result: { wsId: string; leads: number; signals: number };
  beforeAll(async () => {
    process.env.OSE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { createDemoWorkspace } = await import("../demo");
    result = await createDemoWorkspace(ORG, USER);
  });

  it("generates a realistic volume", () => {
    expect(result.leads).toBeGreaterThan(200);
    expect(result.signals).toBeGreaterThan(result.leads);
    const leads = store.leads;
    const stages = new Set(leads.map((l) => l.canonical_stage));
    for (const s of ["submitted", "qualified", "contract", "funded", "lost"]) expect(stages.has(s)).toBe(true);
    const statuses = new Set(store.signal_jobs.map((j) => j.status));
    expect(statuses.has("dry_run")).toBe(true);
    expect(statuses.has("blocked_window") || statuses.has("skipped")).toBe(true);
  });

  it("uploads per lead add up to the highest value sent (increments only, never double-counted)", () => {
    const sum = new Map<string, number>();
    const max = new Map<string, number>();
    for (const j of store.signal_jobs) {
      if (j.status !== "dry_run") continue;
      const k = `${j.lead_id}:${j.platform}`;
      sum.set(k, (sum.get(k) ?? 0) + Number(j.value_increment));
      max.set(k, Math.max(max.get(k) ?? 0, Number(j.cumulative_after)));
    }
    for (const [k, v] of sum) expect(Math.round(v * 100)).toBe(Math.round((max.get(k) ?? 0) * 100));
  });

  it("every row satisfies the production schema", async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create schema vault; create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
      create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
      create function vault.create_secret(s text, n text) returns uuid language sql as $$ insert into vault.secrets(name, secret) values (n, s) returning id $$;
      create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;`);
    const dir = path.resolve(__dirname, "../../../supabase/migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await db.query(`insert into auth.users values ($1, 'a@x.test')`, [USER]);
    await db.query(`insert into organizations (id, type, name, slug) values ($1, 'platform', 'Platform', 'platform')`, [ORG]);
    const order = ["workspaces", "scoring_models", "value_models", "sites", "connections", "stage_maps", "conversion_destinations", "visits", "leads", "stage_events", "signal_jobs", "crm_links", "crm_ops", "ad_spend_daily", "alerts", "automations", "webhook_inbox", "audit_log"];
    for (const t of order) {
      for (const r of store[t] ?? []) {
        const row = t === "audit_log" || t === "ad_spend_daily" ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id")) : r;
        const keys = Object.keys(row);
        const vals = keys.map((k) => {
          const v = row[k];
          return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
        });
        await db.query(`insert into ${t} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, vals);
      }
    }
    const n = await db.query<{ n: number }>(`select count(*)::int as n from leads`);
    expect(n.rows[0].n).toBe(result.leads);
  }, 60_000);
});
