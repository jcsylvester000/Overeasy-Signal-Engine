"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { orgAccess, requireOrg, requireUser, requireWorkspace } from "@/lib/tenancy";
import { createWorkspace, inviteMember } from "@/server/provision";
import { assignMember, purgeWorkspace, teamContext } from "@/server/team";
import { createDemoWorkspace } from "@/server/demo";

export async function createDemo(orgId: string) {
  const user = await requireUser();
  await requireOrg(orgId, 4);
  let wsId = "";
  try {
    wsId = (await createDemoWorkspace(orgId, user.id)).wsId;
  } catch (e) {
    redirect(`/app?error=${encodeURIComponent(`Demo setup failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
  redirect(`/w/${wsId}?welcome=demo`);
}

/** Only demo workspaces can be deleted from the UI. */
export async function deleteDemo(wsId: string) {
  const user = await requireUser();
  const { ws } = await requireWorkspace(wsId, 4);
  if (!(ws.settings as { demo?: boolean }).demo) redirect(`/w/${wsId}?denied=1`);
  await admin().from("workspaces").delete().eq("id", ws.id);
  await audit({ orgId: ws.org_id, actorId: user.id, action: "demo.delete", entity: "workspace", entityId: ws.id });
  revalidatePath("/app");
  redirect("/app");
}

// ---------------------------------------------------------------------------- workspace wizard + card actions
export type WizardState = { error?: string } | null;

/** Step wizard: workspace (+ website, + team assignments, + optional client invite), then the setup checklist. */
export async function createWorkspaceWizard(_prev: WizardState, fd: FormData): Promise<WizardState> {
  const user = await requireUser();
  const orgId = String(fd.get("org_id") ?? "");
  const { rank } = await orgAccess(orgId);
  if (rank < 4) return { error: "You cannot add workspaces to this organization." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
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
    id = await createWorkspace({ orgId, name, templateId: template, domain: domain || undefined, timezone: String(fd.get("timezone") ?? "") || undefined, currency: String(fd.get("currency") ?? "") || undefined, actorId: user.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the workspace." };
  }
  await audit({ orgId, workspaceId: id, actorId: user.id, action: "workspace.create", entity: "workspace", entityId: id, diff: { name, template, via: "wizard", attestation: "not child-directed; no sensitive data beyond template flags; client discloses ad-platform sharing (v1)" } });

  const notes: string[] = ["Workspace created."];
  // Team assignments (only for members of the creator's team, and only when this org is inside that team).
  const picked = fd.getAll("team_member").map(String);
  if (picked.length) {
    const ctx = await teamContext();
    if (ctx && ctx.rank >= 2 && ctx.orgIds.includes(orgId)) {
      const { data: tm } = await admin().from("team_members").select("user_id").eq("org_id", ctx.orgId).eq("status", "active").in("user_id", picked);
      for (const m of tm ?? []) await assignMember(ctx, { id, org_id: orgId, name }, m.user_id, "manager", true);
      if (tm?.length) {
        await audit({ orgId, workspaceId: id, actorId: user.id, action: "team.assignments.workspace", entity: "workspace", entityId: id, diff: { members: tm.map((m) => m.user_id) } });
        notes.push(`${tm.length} team member${tm.length > 1 ? "s" : ""} assigned.`);
      }
    }
  }
  if (inviteEmail) {
    try {
      await inviteMember({ email: inviteEmail, orgId, workspaceId: id, role: inviteRole });
      await audit({ orgId, workspaceId: id, actorId: user.id, action: "member.invite", entity: "membership", diff: { role: inviteRole, workspaceId: id } });
      notes.push(`${inviteEmail} invited.`);
    } catch (e) {
      notes.push(`The client invite failed (${e instanceof Error ? e.message : "error"}); invite them from the organization page.`);
    }
  }
  notes.push("Work through the checklist below to go live.");
  revalidatePath("/app");
  redirect(`/w/${id}/setup?welcome=${encodeURIComponent(notes.join(" "))}`);
}

async function manageableWorkspace(wsId: string, minRank = 4) {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(wsId)) redirect("/app?error=Workspace%20not%20found");
  const { data: ws } = await admin().from("workspaces").select("id,org_id,name,archived_at,settings").eq("id", wsId).maybeSingle();
  if (!ws) redirect("/app?error=Workspace%20not%20found");
  const { rank } = await orgAccess(ws.org_id);
  if (rank < minRank) redirect(`/app?error=${encodeURIComponent(minRank >= 5 ? "Only an owner / super-admin can do that." : "Only admins can change workspaces.")}`);
  return { user, ws: ws as { id: string; org_id: string; name: string; archived_at: string | null; settings: Record<string, unknown> } };
}

export async function updateWorkspace(wsId: string, fd: FormData) {
  const { user, ws } = await manageableWorkspace(wsId);
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
  if (name.length < 2) redirect("/app?error=Name%20is%20too%20short");
  const timezone = String(fd.get("timezone") ?? "").trim().slice(0, 64);
  const currency = String(fd.get("currency") ?? "").trim().toUpperCase();
  const patch: Record<string, string> = { name };
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      patch.timezone = timezone;
    } catch {
      redirect("/app?error=Unknown%20timezone");
    }
  }
  if (/^[A-Z]{3}$/.test(currency)) patch.currency = currency;
  const { error } = await admin().from("workspaces").update(patch).eq("id", ws.id);
  if (error) redirect(`/app?error=${encodeURIComponent(error.message)}`);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "workspace.update", entity: "workspace", entityId: ws.id, diff: { from: ws.name, ...patch } });
  revalidatePath("/app");
  redirect(`/app?notice=${encodeURIComponent(`“${name}” updated.`)}`);
}

export async function archiveWorkspace(wsId: string, fd: FormData) {
  const { user, ws } = await manageableWorkspace(wsId);
  if (String(fd.get("confirm_text") ?? "").trim() !== ws.name.trim()) redirect("/app?error=The%20name%20did%20not%20match");
  await admin().from("workspaces").update({ archived_at: new Date().toISOString(), archived_by: user.id }).eq("id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "workspace.archive", entity: "workspace", entityId: ws.id, diff: { name: ws.name } });
  revalidatePath("/app");
  redirect(`/app?notice=${encodeURIComponent(`“${ws.name}” was deleted. It stays restorable for 30 days under Deleted workspaces.`)}&undo=${ws.id}`);
}

export async function restoreWorkspace(wsId: string) {
  const { user, ws } = await manageableWorkspace(wsId);
  await admin().from("workspaces").update({ archived_at: null, archived_by: null }).eq("id", ws.id);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: "workspace.restore", entity: "workspace", entityId: ws.id });
  revalidatePath("/app");
  redirect(`/app?notice=${encodeURIComponent(`“${ws.name}” restored.`)}`);
}

export async function deleteWorkspaceForever(wsId: string, fd: FormData) {
  const { user, ws } = await manageableWorkspace(wsId, 5);
  if (String(fd.get("confirm_text") ?? "").trim() !== ws.name.trim()) redirect("/app?error=The%20name%20did%20not%20match");
  if (!ws.archived_at) redirect("/app?error=Delete%20the%20workspace%20first%3B%20permanent%20removal%20is%20only%20for%20deleted%20workspaces");
  await audit({ orgId: ws.org_id, actorId: user.id, action: "workspace.delete_permanent", entity: "workspace", entityId: ws.id, diff: { name: ws.name } });
  try {
    await purgeWorkspace(ws.id);
  } catch (e) {
    redirect(`/app?error=${encodeURIComponent(e instanceof Error ? e.message : "Delete failed")}`);
  }
  revalidatePath("/app");
  redirect(`/app?notice=${encodeURIComponent(`“${ws.name}” and all its data were permanently deleted.`)}`);
}
