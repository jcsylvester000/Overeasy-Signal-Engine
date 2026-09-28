"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { sanitizeBrand } from "@/lib/brand";
import { requireOrg, requireUser, ROLES } from "@/lib/tenancy";
import { createWorkspace, inviteMember, slugify } from "@/server/provision";
import { addDomainAliases } from "@/server/domains";

const back = (orgId: string, q = "") => redirect(`/org/${orgId}${q}`);

export async function saveBrand(orgId: string, fd: FormData) {
  const user = await requireUser();
  const { org } = await requireOrg(orgId, 4);
  const brand = sanitizeBrand({
    appName: String(fd.get("appName") ?? ""),
    logoUrl: String(fd.get("logoUrl") ?? ""),
    faviconUrl: String(fd.get("faviconUrl") ?? ""),
    primary: String(fd.get("primary") ?? ""),
    accent: String(fd.get("accent") ?? ""),
    emailFrom: String(fd.get("emailFrom") ?? ""),
    supportEmail: String(fd.get("supportEmail") ?? ""),
  });
  const domain = String(fd.get("custom_domain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  const tag = String(fd.get("tag_domain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  const { error } = await admin().from("organizations").update({ brand, custom_domain: domain, tag_domain: tag }).eq("id", org.id);
  if (error) back(orgId, `?error=${encodeURIComponent(error.message)}`);
  await audit({ orgId, actorId: user.id, action: "org.brand.update", entity: "organization", entityId: orgId, diff: { brand, domain, tag } });
  const dns = domain || tag ? await addDomainAliases([domain, tag]) : null;
  revalidatePath(`/org/${orgId}`);
  back(orgId, dns ? `?saved=brand&note=${encodeURIComponent(dns.message)}` : "?saved=brand");
}

export async function addWorkspace(orgId: string, fd: FormData) {
  const user = await requireUser();
  await requireOrg(orgId, 4);
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) back(orgId, "?error=Name%20is%20required");
  if (!fd.get("attest")) back(orgId, "?error=Please%20confirm%20the%20data%20attestation");
  const id = await createWorkspace({
    orgId,
    name,
    templateId: String(fd.get("template") ?? "land-acquisition"),
    domain: String(fd.get("domain") ?? "").trim() || undefined,
    timezone: String(fd.get("timezone") ?? "") || undefined,
    currency: String(fd.get("currency") ?? "") || undefined,
    actorId: user.id,
  });
  await audit({ orgId, workspaceId: id, actorId: user.id, action: "workspace.create", entity: "workspace", entityId: id, diff: { name, template: fd.get("template"), attestation: "not child-directed; no sensitive data beyond template flags; client discloses ad-platform sharing (v1)" } });
  redirect(`/w/${id}`);
}

export type WizardState = { error?: string } | null;

/** Step wizard: creates the workspace (+ website, + optional client invite) and opens its setup checklist. */
export async function createWorkspaceWizard(orgId: string, _prev: WizardState, fd: FormData): Promise<WizardState> {
  const user = await requireUser();
  await requireOrg(orgId, 4);
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Enter the client or business name." };
  if (!fd.get("attest")) return { error: "Please confirm the data attestation on the last step." };
  const template = String(fd.get("template") ?? "land-acquisition");
  const domain = String(fd.get("domain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { error: "The website domain looks wrong. Use a form like example.com." };
  const inviteEmail = String(fd.get("invite_email") ?? "").trim().toLowerCase();
  const inviteRole = String(fd.get("invite_role") ?? "client_viewer");
  if (inviteEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) return { error: "The invite email looks wrong." };
  if (inviteEmail && !["client_viewer", "analyst", "manager"].includes(inviteRole)) return { error: "Invalid role for the client user." };

  let id: string;
  try {
    id = await createWorkspace({
      orgId,
      name,
      templateId: template,
      domain: domain || undefined,
      timezone: String(fd.get("timezone") ?? "") || undefined,
      currency: String(fd.get("currency") ?? "") || undefined,
      actorId: user.id,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the workspace." };
  }
  await audit({ orgId, workspaceId: id, actorId: user.id, action: "workspace.create", entity: "workspace", entityId: id, diff: { name, template, via: "wizard", attestation: "not child-directed; no sensitive data beyond template flags; client discloses ad-platform sharing (v1)" } });

  let note = "Workspace created. Work through the checklist below to go live.";
  if (inviteEmail) {
    try {
      await inviteMember({ email: inviteEmail, orgId, workspaceId: id, role: inviteRole });
      await audit({ orgId, workspaceId: id, actorId: user.id, action: "member.invite", entity: "membership", diff: { role: inviteRole, workspaceId: id } });
      note = `Workspace created and ${inviteEmail} invited. Work through the checklist below to go live.`;
    } catch (e) {
      note = `Workspace created, but the invite failed (${e instanceof Error ? e.message : "error"}). Invite them from the organization page.`;
    }
  }
  revalidatePath("/app");
  revalidatePath(`/org/${orgId}`);
  redirect(`/w/${id}/setup?welcome=${encodeURIComponent(note)}`);
}

export async function invite(orgId: string, fd: FormData) {
  const user = await requireUser();
  await requireOrg(orgId, 4);
  const role = String(fd.get("role") ?? "analyst");
  if (!ROLES.includes(role as (typeof ROLES)[number]) || role === "owner") back(orgId, "?error=Invalid%20role");
  const workspaceId = String(fd.get("workspace_id") ?? "") || null;
  try {
    await inviteMember({ email: String(fd.get("email") ?? ""), orgId, workspaceId, role });
  } catch (e) {
    back(orgId, `?error=${encodeURIComponent(e instanceof Error ? e.message : "Invite failed")}`);
  }
  await audit({ orgId, workspaceId, actorId: user.id, action: "member.invite", entity: "membership", diff: { role, workspaceId } });
  revalidatePath(`/org/${orgId}`);
  back(orgId, "?saved=invite");
}

export async function removeMember(orgId: string, membershipId: string) {
  const user = await requireUser();
  await requireOrg(orgId, 4);
  await admin().from("memberships").delete().eq("id", membershipId).eq("org_id", orgId).neq("role", "owner");
  await audit({ orgId, actorId: user.id, action: "member.remove", entity: "membership", entityId: membershipId });
  revalidatePath(`/org/${orgId}`);
}

/** Platform/partner admins create child organizations (partner agencies or direct clients). */
export async function addChildOrg(orgId: string, fd: FormData) {
  const user = await requireUser();
  const { org } = await requireOrg(orgId, 4);
  if (org.type === "direct") back(orgId, "?error=Direct%20client%20organizations%20cannot%20have%20children");
  const name = String(fd.get("name") ?? "").trim();
  const type = org.type === "platform" ? String(fd.get("type") ?? "partner") : "direct";
  if (name.length < 2 || !["partner", "direct"].includes(type)) back(orgId, "?error=Invalid%20organization");
  const { data, error } = await admin()
    .from("organizations")
    .insert({ parent_id: orgId, type, name, slug: `${slugify(name)}-${Date.now().toString(36).slice(-4)}`, brand: { appName: name } })
    .select("id")
    .single();
  if (error || !data) back(orgId, `?error=${encodeURIComponent(error?.message ?? "Create failed")}`);
  await audit({ orgId, actorId: user.id, action: "org.create", entity: "organization", entityId: data!.id, diff: { name, type } });
  redirect(`/org/${data!.id}`);
}

export async function saveSecurity(orgId: string, fd: FormData) {
  const user = await requireUser();
  const { org } = await requireOrg(orgId, 4);
  const settings = { ...((org as unknown as { settings?: Record<string, unknown> }).settings ?? {}), requireMfaForAdmins: Boolean(fd.get("requireMfaForAdmins")) };
  if (settings.requireMfaForAdmins) {
    // Don't lock the current admin out: they must have an authenticator first.
    const { userClient } = await import("@/lib/supabase/server");
    const sb = await userClient();
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") back(orgId, "?error=Turn%20on%20two-factor%20for%20your%20own%20account%20first%20(Account%20page)");
  }
  await admin().from("organizations").update({ settings }).eq("id", orgId);
  await audit({ orgId, actorId: user.id, action: "org.security", entity: "organization", entityId: orgId, diff: settings });
  revalidatePath(`/org/${orgId}`);
  back(orgId, "?saved=security");
}
