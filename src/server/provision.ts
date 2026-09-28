import "server-only";
import { admin, must } from "@/lib/supabase/admin";
import { encrypt, randomToken } from "@/lib/crypto";
import { getTemplate } from "@/core/templates";
import { env } from "@/lib/env";

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ws";
}

export function newSiteKey() {
  return `site_${randomToken(12).replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toLowerCase()}`;
}

/**
 * Create a client workspace from an industry template: published scoring + value models (v1),
 * a website entry with a site key, a generic-webhook secret, and dry-run ad/CRM connections so the
 * whole pipeline can be exercised before any platform approval.
 */
export async function createWorkspace(args: { orgId: string; name: string; templateId: string; domain?: string; timezone?: string; currency?: string; actorId: string }) {
  const db = admin();
  const t = getTemplate(args.templateId);
  let slug = slugify(args.name);
  const { data: clash } = await db.from("workspaces").select("id").eq("org_id", args.orgId).eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 48);

  const ws = must(
    await db
      .from("workspaces")
      .insert({
        org_id: args.orgId,
        name: args.name,
        slug,
        industry_template: t.id,
        timezone: args.timezone ?? "America/New_York",
        currency: args.currency ?? t.scoring.currency,
        settings: { storeRawPii: !t.regulated, piiRetentionDays: 30, stageEntryRules: t.stageEntryRules, regulatedVertical: Boolean(t.regulated), optOutPolicy: "skip_upload" },
        webhook_secret_enc: encrypt(randomToken(32)),
      })
      .select("id")
      .single(),
    "create workspace",
  );

  const now = new Date().toISOString();
  await db.from("scoring_models").insert({ workspace_id: ws.id, version: 1, status: "published", model: t.scoring, notes: `From template: ${t.name}`, published_by: args.actorId, published_at: now });
  await db.from("value_models").insert({ workspace_id: ws.id, version: 1, status: "published", model: t.value, notes: "Placeholder values until the client supplies spreads and stage rates.", published_by: args.actorId, published_at: now });

  if (args.domain) {
    const domain = args.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    await db.from("sites").insert({ workspace_id: ws.id, domain, site_key: newSiteKey(), allowed_origins: [`https://${domain}`, `https://www.${domain.replace(/^www\./, "")}`] });
  }

  await db.from("connections").insert([
    { workspace_id: ws.id, provider: "google_ads", mode: "dry_run", external_account: "dry-run-google", display_name: "Google Ads (dry run)" },
    { workspace_id: ws.id, provider: "microsoft_ads", mode: "dry_run", external_account: "dry-run-microsoft", login_account: "dry-run", display_name: "Microsoft Advertising (dry run)" },
    { workspace_id: ws.id, provider: "ghl", mode: "dry_run", external_account: "dry-run-location", display_name: "GoHighLevel (dry run)" },
  ]);
  return ws.id as string;
}

/** Invite a user by email (Supabase sends the invite) and grant a role on an org or one workspace. */
export async function inviteMember(args: { email: string; orgId: string; workspaceId?: string | null; role: string; redirectTo?: string }) {
  const db = admin();
  const email = args.email.trim().toLowerCase();
  let userId: string | null = null;
  const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo: args.redirectTo ?? `${env.appUrl()}/auth/callback?next=/app/account` });
  if (invited.data?.user) userId = invited.data.user.id;
  else {
    // Already registered: find the user id.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
  }
  if (!userId) throw new Error(invited.error?.message ?? "Could not invite user");
  const { error } = await db.from("memberships").upsert({ user_id: userId, org_id: args.orgId, workspace_id: args.workspaceId ?? null, role: args.role }, { onConflict: "user_id,org_id,workspace_id" });
  if (error) throw new Error(error.message);
  return userId;
}
