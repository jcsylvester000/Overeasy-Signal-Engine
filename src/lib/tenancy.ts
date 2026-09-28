import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const ROLES = ["owner", "admin", "manager", "analyst", "client_viewer"] as const;
export type Role = (typeof ROLES)[number];
export const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, analyst: 2, client_viewer: 1 };
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", manager: "Manager", analyst: "Analyst", client_viewer: "Client viewer" };

export type Workspace = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  industry_template: string | null;
  timezone: string;
  currency: string;
  settings: Record<string, unknown>;
  archived_at?: string | null;
};

export type Org = { id: string; parent_id: string | null; type: "platform" | "partner" | "direct"; name: string; slug: string; brand: Record<string, unknown>; custom_domain: string | null; tag_domain: string | null };

export type SessionUser = { id: string; email: string | null };

/**
 * Signed-in user from the session JWT. getClaims() verifies the token locally against the project's published
 * signing keys (cached), so no Auth-server round trip on every page (falls back to a server check for legacy keys).
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  if (!env.isConfigured()) redirect("/app");
  const sb = await userClient();
  const { data, error } = await sb.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  return { id: String(sub), email: typeof data.claims.email === "string" ? data.claims.email : null };
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export type OrgWithSettings = Org & { settings?: Record<string, unknown> | null };

/**
 * Workspace the user can access + their effective rank + the organization chain (brand, MFA policy).
 * One database round trip via ose_workspace_context(); falls back to separate queries if that function is missing.
 */
export const workspaceAccess = cache(async (workspaceId: string) => {
  await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) notFound();
  const sb = await userClient();
  const ctx = await sb.rpc("ose_workspace_context", { ws: workspaceId });
  if (!ctx.error) {
    const c = ctx.data as { rank: number; workspace: Workspace; orgs: OrgWithSettings[] } | null;
    if (!c || c.workspace.archived_at) notFound();
    const org = c.orgs.find((o) => o.id === c.workspace.org_id)!;
    return { ws: c.workspace, org, rank: Number(c.rank), chain: c.orgs };
  }
  const { data: ws } = await sb.from("workspaces").select("*").eq("id", workspaceId).maybeSingle<Workspace>();
  if (!ws || ws.archived_at) notFound();
  const [{ data: rank }, { data: org }] = await Promise.all([
    sb.rpc("ose_workspace_rank", { ws: workspaceId }),
    sb.from("organizations").select("*").eq("id", ws.org_id).maybeSingle<OrgWithSettings>(),
  ]);
  return { ws, org: org!, rank: Number(rank ?? 0), chain: null as OrgWithSettings[] | null };
});

export async function requireWorkspace(workspaceId: string, minRank = 1) {
  const access = await workspaceAccess(workspaceId);
  if (access.rank < minRank) redirect(`/w/${workspaceId}?denied=1`);
  return access;
}

export const orgAccess = cache(async (orgId: string) => {
  await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) notFound();
  const sb = await userClient();
  const [{ data: org }, { data: rank }] = await Promise.all([sb.from("organizations").select("*").eq("id", orgId).maybeSingle<Org>(), sb.rpc("ose_org_rank", { o: orgId })]);
  if (!org) notFound();
  return { org, rank: Number(rank ?? 0) };
});

export async function requireOrg(orgId: string, minRank = 4) {
  const a = await orgAccess(orgId);
  if (a.rank < minRank) notFound();
  return a;
}

/**
 * MFA policy: when an organization (or any ancestor) requires it, admins and owners must be at AAL2.
 * Users without an authenticator are sent to set one up; users with one are sent to the code check.
 */
export async function enforceMfa(orgId: string, rank: number, next: string, chain?: OrgWithSettings[] | null) {
  if (rank < 4) return;
  let required = false;
  let id: string | null = orgId;
  if (chain) {
    required = chain.some((o) => Boolean((o.settings as { requireMfaForAdmins?: boolean } | null)?.requireMfaForAdmins));
    id = null;
  }
  if (id) {
    const { chainOf, orgTree } = await import("@/lib/org-tree");
    required = chainOf(await orgTree(), id).some((o) => Boolean((o.settings as { requireMfaForAdmins?: boolean } | null)?.requireMfaForAdmins));
  }
  if (!required) return;
  const sb = await userClient();
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") return;
  if (data?.nextLevel === "aal2") redirect(`/login/mfa?next=${encodeURIComponent(next)}`);
  redirect("/app/account?mfa=required");
}
