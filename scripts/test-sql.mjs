// Applies every Supabase migration to an in-memory Postgres (PGlite) with minimal Supabase stubs,
// then proves tenant isolation through RLS (ADM-01): user A never sees workspace B rows.
// Run: npm run test:sql
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../supabase/migrations");
const db = new PGlite();

const stubs = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(s text, n text) returns uuid language sql as $$ insert into vault.secrets(name, secret) values (n, s) returning id $$;
  create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
`;

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

await db.exec(stubs);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(path.join(dir, f), "utf8"));
  console.log(`applied ${f}`);
}
await db.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`);

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const P = "00000000-0000-0000-0000-00000000000c";
await db.exec(`
  insert into auth.users values ('${A}','a@x.test'),('${B}','b@x.test'),('${P}','p@x.test');
  insert into organizations (id, type, name, slug) values ('10000000-0000-0000-0000-000000000001','platform','Platform','platform');
  insert into organizations (id, parent_id, type, name, slug) values
    ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','partner','Agency A','agency-a'),
    ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','partner','Agency B','agency-b');
  insert into workspaces (id, org_id, name, slug) values
    ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Client A1','a1'),
    ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','Client B1','b1');
  insert into memberships (user_id, org_id, role) values
    ('${A}','10000000-0000-0000-0000-000000000002','admin'),
    ('${B}','10000000-0000-0000-0000-000000000003','analyst'),
    ('${P}','10000000-0000-0000-0000-000000000001','owner');
  insert into leads (workspace_id, source) values ('20000000-0000-0000-0000-000000000001','api'),('20000000-0000-0000-0000-000000000002','api');
  insert into lead_pii (lead_id, workspace_id, enc_email, purge_after) select id, workspace_id, 'x', now() from leads;
`);

async function as(user, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec(`reset role;`);
  }
}

check("A sees only workspace A1", (await as(A, "select slug from workspaces")).map((r) => r.slug).join() === "a1");
check("B sees only workspace B1", (await as(B, "select slug from workspaces")).map((r) => r.slug).join() === "b1");
check("A sees 1 lead", (await as(A, "select id from leads")).length === 1);
check("B (analyst) cannot read raw PII", (await as(B, "select * from lead_pii")).length === 0);
check("A (admin) reads own PII only", (await as(A, "select * from lead_pii")).length === 1);
check("Platform owner sees all workspaces", (await as(P, "select slug from workspaces order by slug")).map((r) => r.slug).join() === "a1,b1");
check("A cannot insert into B's workspace", await as(A, `insert into sites (workspace_id, domain, site_key) values ('20000000-0000-0000-0000-000000000002','x.com','k1') returning id`).then(() => false, () => true));
check("B (analyst) cannot change config", await as(B, `insert into sites (workspace_id, domain, site_key) values ('20000000-0000-0000-0000-000000000002','x.com','k2') returning id`).then(() => false, () => true));
check("A (admin) can add a site", await as(A, `insert into sites (workspace_id, domain, site_key) values ('20000000-0000-0000-0000-000000000001','a.com','k3') returning id`).then(() => true, () => false));
check("anon-like user (no memberships) sees nothing", (await as("00000000-0000-0000-0000-0000000000ff", "select * from workspaces")).length === 0);

// Immutability + append-only
await db.exec(`insert into scoring_models (workspace_id, version, status, model) values ('20000000-0000-0000-0000-000000000001', 1, 'published', '{"a":1}')`);
check("published scoring model is immutable", await db.query(`update scoring_models set model = '{"a":2}'`).then(() => false, () => true));
check("audit_log is append-only", await db.exec(`insert into audit_log (action) values ('x')`).then(() => db.query(`delete from audit_log`)).then(() => false, () => true));

// Vault wrappers
const sid = (await db.query(`select ose_vault_put('conn:test', '{"t":1}') as id`)).rows[0].id;
check("vault round-trip", (await db.query(`select ose_vault_get($1) as s`, [sid])).rows[0].s === '{"t":1}');
check("authenticated cannot call vault", await as(A, `select ose_vault_get('${sid}')`).then(() => false, () => true));

// Usage view respects RLS (security_invoker) and DSAR log is admin-only
check("usage view: A sees only A1 usage", (await as(A, "select workspace_id from usage_monthly")).every((r) => r.workspace_id === "20000000-0000-0000-0000-000000000001"));
check("usage view: B sees only B1 usage", (await as(B, "select workspace_id from usage_monthly")).every((r) => r.workspace_id === "20000000-0000-0000-0000-000000000002"));
await db.exec(`insert into dsar_requests (workspace_id, kind, subject_hash) values ('20000000-0000-0000-0000-000000000002','access','h')`);
check("DSAR log hidden from analysts", (await as(B, "select * from dsar_requests")).length === 0);
check("DSAR log hidden from other tenants", (await as(A, "select * from dsar_requests")).length === 0);

console.log(failures ?`\n${failures} check(s) failed` : "\nAll SQL checks passed");
process.exit(failures ? 1 : 0);
