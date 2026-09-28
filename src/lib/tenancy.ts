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
};

export type Org = { id: string; parent_id: string | null; type: "platform" | "partner" | "direct"; name: string; slug: string; brand: Record<string, unknown>; custom_domain: string | null; tag_domain: string | null };

export const currentUser = cache(async () => {
  if (!env.isConfigured()) redirect("/app");
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Workspace the user can access (RLS-checked) + their effective rank. */
export const workspaceAccess = cache(async (workspaceId: string) => {
  await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) notFound();
  const sb = await userClient();
  const { data: ws } = await sb.from("workspaces").select("*").eq("id", workspaceId).maybeSingle<Workspace>();
  if (!ws) notFound();
  const { data: rank } = await sb.rpc("ose_workspace_rank", { ws: workspaceId });
  const { data: org } = await sb.from("organizations").select("*").eq("id", ws.org_id).maybeSingle<Org>();
  return { ws, org: org!, rank: Number(rank ?? 0) };
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
  const { data: org } = await sb.from("organizations").select("*").eq("id", orgId).maybeSingle<Org>();
  if (!org) notFound();
  const { data: rank } = await sb.rpc("ose_org_rank", { o: orgId });
  return { org, rank: Number(rank ?? 0) };
});

export async function requireOrg(orgId: string, minRank = 4) {
  const a = await orgAccess(orgId);
  if (a.rank < minRank) notFound();
  return a;
}
