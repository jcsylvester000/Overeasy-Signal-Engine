// First-run setup: creates the platform organization and its owner account.
// Usage (PowerShell or bash, with .env.local values exported or passed inline):
//   npm run bootstrap -- --email you@company.com --password "a-long-password" --org "Overeasy"
// Safe to re-run: existing org/user are reused.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnvFile(".env.local");

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = arg("email");
const password = arg("password");
const orgName = arg("org") ?? "Platform";

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local).");
  process.exit(1);
}
if (!email || !password || password.length < 12) {
  if (password && password.length < 12) console.error(`Password too short: ${password.length} characters. Use at least 12.`);
  console.error('Usage: npm run bootstrap -- --email you@company.com --password "at-least-12-chars" [--org "Name"]');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let userId: string | undefined;
const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created.data.user) userId = created.data.user.id;
else {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}
if (!userId) {
  console.error("Could not create or find the user:", created.error?.message);
  process.exit(1);
}

let { data: org } = await db.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
if (!org) {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "platform";
  const res = await db.from("organizations").insert({ type: "platform", name: orgName, slug, brand: {} }).select("id").single();
  if (res.error) {
    console.error("Create org failed:", res.error.message, "\nDid you run the migration in supabase/migrations/?");
    process.exit(1);
  }
  org = res.data;
}

const m = await db.from("memberships").upsert({ user_id: userId, org_id: org!.id, workspace_id: null, role: "owner" }, { onConflict: "user_id,org_id,workspace_id" });
if (m.error) {
  console.error("Membership failed:", m.error.message);
  process.exit(1);
}
console.log(`Done. ${email} is owner of "${orgName}" (${org!.id}). Sign in, open the organization and create the first client workspace.`);
