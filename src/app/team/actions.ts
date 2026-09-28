"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import {
  requireTeam,
  canSeeWorkspace,
  notify,
  assignMember,
  TEAM_ROLES,
  TEAM_ROLE_MEMBERSHIP,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TeamCtx,
  type TeamRole,
} from "@/server/team";

// ---------------------------------------------------------------------------- helpers
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);
const iso = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
function back(fd: FormData, q: { notice?: string; error?: string }, fallback = "/team"): never {
  const to = str(fd, "return_to", 300);
  const base = to.startsWith("/team") || to.startsWith("/app") ? to : fallback;
  const url = new URL(base, "http://x");
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  if (q.notice) url.searchParams.set("notice", q.notice);
  if (q.error) url.searchParams.set("error", q.error);
  redirect(url.pathname + url.search);
}
async function wsInScope(ctx: TeamCtx, wsId: string | null) {
  if (!wsId) return null;
  const { data } = await admin().from("workspaces").select("id,org_id,name,archived_at").eq("id", wsId).maybeSingle();
  if (!data || data.archived_at || !canSeeWorkspace(ctx, data)) return null;
  return data as { id: string; org_id: string; name: string };
}
async function isTeamMember(ctx: TeamCtx, userId: string) {
  const { data } = await admin().from("team_members").select("user_id").eq("org_id", ctx.orgId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return Boolean(data);
}
async function findUserByEmail(email: string): Promise<string | null> {
  const db = admin();
  for (let page = 1; page <= 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}
const PW_RULE = "Use at least 12 characters.";

/** Keeps memberships in line with the team role: org-wide for super-admin/admin, per assignment for users. */
async function syncMembership(ctx: TeamCtx, userId: string, role: TeamRole) {
  const db = admin();
  const m = TEAM_ROLE_MEMBERSHIP[role];
  if (m) {
    const { error } = await db.from("memberships").upsert({ user_id: userId, org_id: ctx.orgId, workspace_id: null, role: m }, { onConflict: "user_id,org_id,workspace_id" });
    if (error) throw new Error(error.message);
  } else {
    await db.from("memberships").delete().eq("user_id", userId).eq("org_id", ctx.orgId).is("workspace_id", null).in("role", ["owner", "admin", "manager", "analyst"]);
  }
  // Assignment-based workspace access (kept for every role so boards stay consistent).
  const { data: asg } = await db.from("workspace_assignments").select("workspace_id,access,workspaces(org_id)").eq("user_id", userId).eq("team_org_id", ctx.orgId);
  for (const a of asg ?? []) {
    const orgId = (Array.isArray(a.workspaces) ? a.workspaces[0] : a.workspaces)?.org_id as string | undefined;
    if (orgId) await db.from("memberships").upsert({ user_id: userId, org_id: orgId, workspace_id: a.workspace_id, role: a.access }, { onConflict: "user_id,org_id,workspace_id" });
  }
}

/** Guards for changing another member: cannot edit yourself here, admins cannot touch super-admins, keep one super-admin. */
async function guardTarget(ctx: TeamCtx, userId: string, newRole?: TeamRole | null, disabling = false) {
  if (userId === ctx.user.id) return "Use your Account page to change your own details.";
  const { data: t } = await admin().from("team_members").select("team_role,status").eq("org_id", ctx.orgId).eq("user_id", userId).maybeSingle();
  if (!t) return "Member not found.";
  if (t.team_role === "super_admin" && ctx.role !== "super_admin") return "Only a super-admin can change a super-admin.";
  if (newRole === "super_admin" && ctx.role !== "super_admin") return "Only a super-admin can make someone a super-admin.";
  if (t.team_role === "super_admin" && ((newRole && newRole !== "super_admin") || disabling)) {
    const { count } = await admin().from("team_members").select("user_id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("team_role", "super_admin").eq("status", "active");
    if ((count ?? 0) <= 1) return "Keep at least one active super-admin.";
  }
  return null;
}

// ---------------------------------------------------------------------------- members (admin+)
export async function addMember(fd: FormData) {
  const ctx = await requireTeam(2);
  const email = str(fd, "email", 200).toLowerCase();
  const role = str(fd, "team_role") as TeamRole;
  const method = str(fd, "method") === "invite" ? "invite" : "password";
  const password = String(fd.get("password") ?? "");
  const fullName = str(fd, "full_name", 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back(fd, { error: "Enter a valid email." });
  if (!TEAM_ROLES.includes(role)) back(fd, { error: "Choose a role." });
  if (role === "super_admin" && ctx.role !== "super_admin") back(fd, { error: "Only a super-admin can add a super-admin." });
  if (method === "password" && password.length < 12) back(fd, { error: `Temporary password: ${PW_RULE}` });

  const db = admin();
  let userId = await findUserByEmail(email);
  let note = "";
  if (!userId) {
    if (method === "password") {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { must_change_password: true }, user_metadata: { full_name: fullName } });
      if (error || !data.user) back(fd, { error: error?.message ?? "Could not create the login." });
      userId = data.user.id;
      note = `${email} can sign in now with the temporary password and will be asked to choose their own.`;
    } else {
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl()}/auth/callback?next=/app/account`, data: { full_name: fullName } });
      if (error || !data.user) back(fd, { error: error?.message ?? "Could not send the invite." });
      userId = data.user.id;
      note = `Invite sent to ${email}.`;
    }
  } else {
    note = `${email} already had a login; they were added to the team with their existing password.`;
  }
  const { data: existing } = await db.from("team_members").select("user_id").eq("org_id", ctx.orgId).eq("user_id", userId).maybeSingle();
  if (existing) back(fd, { error: `${email} is already on the team.` });
  const { error } = await db.from("team_members").insert({ org_id: ctx.orgId, user_id: userId, team_role: role, full_name: fullName || null, title: str(fd, "title", 120) || null, phone: str(fd, "phone", 40) || null, created_by: ctx.user.id });
  if (error) back(fd, { error: error.message });
  await syncMembership(ctx, userId, role);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "team.member.add", entity: "user", entityId: userId, diff: { email, role, method } });
  revalidatePath("/team/members");
  back(fd, { notice: note }, "/team/members");
}

export async function updateMember(userId: string, fd: FormData) {
  const ctx = await requireTeam(2);
  const role = str(fd, "team_role") as TeamRole;
  const status = str(fd, "status") === "disabled" ? "disabled" : "active";
  if (!TEAM_ROLES.includes(role)) back(fd, { error: "Choose a role." });
  const { data: cur } = await admin().from("team_members").select("team_role,status").eq("org_id", ctx.orgId).eq("user_id", userId).maybeSingle();
  const g = await guardTarget(ctx, userId, role, status === "disabled");
  if (g) back(fd, { error: g });
  const db = admin();
  await db.from("team_members").update({ team_role: role, status, full_name: str(fd, "full_name", 120) || null, title: str(fd, "title", 120) || null, phone: str(fd, "phone", 40) || null }).eq("org_id", ctx.orgId).eq("user_id", userId);
  if (cur && cur.team_role !== role) await syncMembership(ctx, userId, role);
  if (cur && cur.status !== status) {
    // Disabled members cannot sign in (Supabase ban) until re-enabled.
    await db.auth.admin.updateUserById(userId, { ban_duration: status === "disabled" ? "876000h" : "none" });
  }
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "team.member.update", entity: "user", entityId: userId, diff: { from: cur, role, status } });
  revalidatePath("/team/members");
  back(fd, { notice: "Member updated." }, "/team/members");
}

export async function setTempPassword(userId: string, fd: FormData) {
  const ctx = await requireTeam(2);
  const g = await guardTarget(ctx, userId);
  if (g) back(fd, { error: g });
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 12) back(fd, { error: `Temporary password: ${PW_RULE}` });
  const db = admin();
  const { data: u } = await db.auth.admin.getUserById(userId);
  const { error } = await db.auth.admin.updateUserById(userId, { password: pw, app_metadata: { ...(u.user?.app_metadata ?? {}), must_change_password: true } });
  if (error) back(fd, { error: error.message });
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "team.member.password_reset", entity: "user", entityId: userId, diff: { method: "temporary_password" } });
  back(fd, { notice: "Temporary password set. They must choose a new one at next sign-in." }, "/team/members");
}

export async function sendPasswordReset(userId: string, fd: FormData) {
  const ctx = await requireTeam(2);
  const g = await guardTarget(ctx, userId);
  if (g) back(fd, { error: g });
  const db = admin();
  const { data: u } = await db.auth.admin.getUserById(userId);
  const email = u.user?.email;
  if (!email) back(fd, { error: "This user has no email." });
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl()}/auth/callback?next=/app/account` });
  if (error) back(fd, { error: error.message });
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "team.member.password_reset", entity: "user", entityId: userId, diff: { method: "email_link" } });
  back(fd, { notice: `Password reset email sent to ${email}.` }, "/team/members");
}

export async function removeMember(userId: string, fd: FormData) {
  const ctx = await requireTeam(2);
  const g = await guardTarget(ctx, userId, null, true);
  if (g) back(fd, { error: g });
  const db = admin();
  const { data: asg } = await db.from("workspace_assignments").select("workspace_id").eq("user_id", userId).eq("team_org_id", ctx.orgId);
  for (const a of asg ?? []) await db.from("memberships").delete().eq("user_id", userId).eq("workspace_id", a.workspace_id).in("role", ["manager", "analyst"]);
  await db.from("workspace_assignments").delete().eq("user_id", userId).eq("team_org_id", ctx.orgId);
  await db.from("memberships").delete().eq("user_id", userId).eq("org_id", ctx.orgId).is("workspace_id", null);
  await db.from("team_tasks").update({ assignee_id: null }).eq("assignee_id", userId).eq("team_org_id", ctx.orgId).neq("status", "done");
  await db.from("team_members").delete().eq("org_id", ctx.orgId).eq("user_id", userId);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "team.member.remove", entity: "user", entityId: userId });
  revalidatePath("/team/members");
  back(fd, { notice: "Member removed from the team. Their open tasks are now unassigned." }, "/team/members");
}

// ---------------------------------------------------------------------------- assignments (admin+)
/** Members page: set the full list of workspaces for one member. */
export async function setMemberWorkspaces(userId: string, fd: FormData) {
  const ctx = await requireTeam(2);
  if (!(await isTeamMember(ctx, userId))) back(fd, { error: "Member not found." });
  const access = str(fd, "access") === "analyst" ? "analyst" : "manager";
  const want = new Set(fd.getAll("ws").map(String));
  const { data: wss } = await admin().from("workspaces").select("id,org_id,name").in("org_id", ctx.orgIds).is("archived_at", null);
  const { data: cur } = await admin().from("workspace_assignments").select("workspace_id,access").eq("user_id", userId).eq("team_org_id", ctx.orgId);
  const have = new Map((cur ?? []).map((c) => [c.workspace_id as string, c.access as string]));
  for (const w of wss ?? []) {
    if (want.has(w.id) && (!have.has(w.id) || have.get(w.id) !== access)) await assignMember(ctx, w, userId, access, true);
    if (!want.has(w.id) && have.has(w.id)) await assignMember(ctx, w, userId, access, false);
  }
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "team.assignments.set", entity: "user", entityId: userId, diff: { workspaces: [...want], access } });
  revalidatePath("/team");
  back(fd, { notice: "Workspace assignments saved." }, "/team/members");
}

/** Workspace team page: set the team for one workspace. */
export async function setWorkspaceTeam(wsId: string, fd: FormData) {
  const ctx = await requireTeam(2);
  const ws = await wsInScope(ctx, wsId);
  if (!ws) back(fd, { error: "Workspace not found." });
  const want = new Set(fd.getAll("member").map(String));
  const leadId = str(fd, "lead");
  const { data: members } = await admin().from("team_members").select("user_id").eq("org_id", ctx.orgId).eq("status", "active");
  const { data: cur } = await admin().from("workspace_assignments").select("user_id").eq("workspace_id", ws.id);
  const have = new Set((cur ?? []).map((c) => c.user_id as string));
  for (const m of members ?? []) {
    if (want.has(m.user_id) && !have.has(m.user_id)) await assignMember(ctx, ws, m.user_id, "manager", true);
    if (!want.has(m.user_id) && have.has(m.user_id)) await assignMember(ctx, ws, m.user_id, "manager", false);
  }
  await admin().from("workspace_assignments").update({ is_lead: false }).eq("workspace_id", ws.id);
  if (leadId && want.has(leadId)) await admin().from("workspace_assignments").update({ is_lead: true }).eq("workspace_id", ws.id).eq("user_id", leadId);
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: ctx.user.id, action: "team.assignments.workspace", entity: "workspace", entityId: ws.id, diff: { members: [...want], lead: leadId || null } });
  revalidatePath(`/team/w/${ws.id}`);
  back(fd, { notice: "Team for this workspace saved." }, `/team/w/${ws.id}`);
}

// ---------------------------------------------------------------------------- tasks
export async function saveTask(fd: FormData) {
  const ctx = await requireTeam(1);
  const id = str(fd, "id", 40) || null;
  const title = str(fd, "title", 200);
  if (!title) back(fd, { error: "Give the task a title." });
  const status = (TASK_STATUSES as readonly string[]).includes(str(fd, "status")) ? str(fd, "status") : "todo";
  const priority = (TASK_PRIORITIES as readonly string[]).includes(str(fd, "priority")) ? str(fd, "priority") : "normal";
  const wsId = str(fd, "workspace_id", 40) || null;
  const ws = await wsInScope(ctx, wsId);
  if (wsId && !ws) back(fd, { error: "You can only add tasks to your workspaces." });
  const assignee = str(fd, "assignee_id", 40) || null;
  if (assignee && !(await isTeamMember(ctx, assignee))) back(fd, { error: "The assignee must be an active team member." });
  const row = {
    title,
    description: str(fd, "description", 4000) || null,
    status,
    priority,
    workspace_id: ws?.id ?? null,
    assignee_id: assignee,
    due_at: iso(str(fd, "due_at")),
    remind_at: iso(str(fd, "remind_at")),
    completed_at: status === "done" ? new Date().toISOString() : null,
  };
  const db = admin();
  let taskId = id;
  let prevAssignee: string | null = null;
  if (id) {
    const { data: t } = await db.from("team_tasks").select("id,created_by,assignee_id,workspace_id,remind_at,due_at").eq("id", id).eq("team_org_id", ctx.orgId).maybeSingle();
    if (!t) back(fd, { error: "Task not found." });
    const allowed = ctx.rank >= 2 || t.created_by === ctx.user.id || t.assignee_id === ctx.user.id || (t.workspace_id && ctx.assigned.includes(t.workspace_id));
    if (!allowed) back(fd, { error: "You cannot edit this task." });
    prevAssignee = t.assignee_id;
    const resetRem = row.remind_at !== t.remind_at ? { reminded_at: null } : {};
    const resetDue = row.due_at !== t.due_at ? { overdue_notified_at: null } : {};
    const { error } = await db.from("team_tasks").update({ ...row, ...resetRem, ...resetDue }).eq("id", id);
    if (error) back(fd, { error: error.message });
  } else {
    const { data, error } = await db.from("team_tasks").insert({ ...row, team_org_id: ctx.orgId, created_by: ctx.user.id }).select("id").single();
    if (error) back(fd, { error: error.message });
    taskId = data.id;
  }
  if (assignee && assignee !== ctx.user.id && assignee !== prevAssignee) {
    await notify([{ userId: assignee, teamOrgId: ctx.orgId, workspaceId: ws?.id ?? null, kind: "task_assigned", title: `New task: ${title}`, body: ws ? ws.name : null, link: `/team/tasks?task=${taskId}` }]);
  }
  await audit({ orgId: ctx.orgId, workspaceId: ws?.id ?? null, actorId: ctx.user.id, action: id ? "team.task.update" : "team.task.create", entity: "task", entityId: taskId ?? undefined, diff: { title, status, priority, assignee } });
  revalidatePath("/team");
  back(fd, { notice: id ? "Task updated." : "Task added." }, "/team/tasks");
}

export async function setTaskStatus(taskId: string, fd: FormData) {
  const ctx = await requireTeam(1);
  const status = str(fd, "status");
  if (!(TASK_STATUSES as readonly string[]).includes(status)) back(fd, { error: "Invalid status." });
  const db = admin();
  const { data: t } = await db.from("team_tasks").select("id,title,created_by,assignee_id,workspace_id").eq("id", taskId).eq("team_org_id", ctx.orgId).maybeSingle();
  if (!t) back(fd, { error: "Task not found." });
  if (!(ctx.rank >= 2 || t.created_by === ctx.user.id || t.assignee_id === ctx.user.id || (t.workspace_id && ctx.assigned.includes(t.workspace_id)))) back(fd, { error: "You cannot change this task." });
  await db.from("team_tasks").update({ status, completed_at: status === "done" ? new Date().toISOString() : null }).eq("id", taskId);
  if (status === "done" && t.created_by && t.created_by !== ctx.user.id) {
    await notify([{ userId: t.created_by, teamOrgId: ctx.orgId, workspaceId: t.workspace_id, kind: "task_done", title: `Done: ${t.title}`, link: `/team/tasks?task=${t.id}` }]);
  }
  await audit({ orgId: ctx.orgId, workspaceId: t.workspace_id, actorId: ctx.user.id, action: "team.task.status", entity: "task", entityId: taskId, diff: { status } });
  revalidatePath("/team");
  back(fd, {}, "/team/tasks");
}

export async function deleteTask(taskId: string, fd: FormData) {
  const ctx = await requireTeam(1);
  const db = admin();
  const { data: t } = await db.from("team_tasks").select("id,title,created_by,workspace_id").eq("id", taskId).eq("team_org_id", ctx.orgId).maybeSingle();
  if (!t) back(fd, { error: "Task not found." });
  if (!(ctx.rank >= 2 || t.created_by === ctx.user.id)) back(fd, { error: "Only the creator or an admin can delete a task." });
  await db.from("team_tasks").delete().eq("id", taskId);
  await audit({ orgId: ctx.orgId, workspaceId: t.workspace_id, actorId: ctx.user.id, action: "team.task.delete", entity: "task", entityId: taskId, diff: { title: t.title } });
  revalidatePath("/team");
  back(fd, { notice: `Task “${t.title}” deleted.` }, "/team/tasks");
}

// ---------------------------------------------------------------------------- reminders
export async function addReminder(fd: FormData) {
  const ctx = await requireTeam(1);
  const note = str(fd, "note", 300);
  const at = iso(str(fd, "remind_at"));
  if (!note || !at) back(fd, { error: "Add a note and a time for the reminder." });
  const wsId = str(fd, "workspace_id", 40) || null;
  const ws = await wsInScope(ctx, wsId);
  await admin().from("team_reminders").insert({ team_org_id: ctx.orgId, user_id: ctx.user.id, workspace_id: ws?.id ?? null, note, remind_at: at });
  revalidatePath("/team");
  back(fd, { notice: "Reminder set." });
}

export async function deleteReminder(id: string, fd: FormData) {
  const ctx = await requireTeam(1);
  await admin().from("team_reminders").delete().eq("id", id).eq("user_id", ctx.user.id);
  revalidatePath("/team");
  back(fd, { notice: "Reminder removed." });
}

// ---------------------------------------------------------------------------- notes
export async function addNote(wsId: string, fd: FormData) {
  const ctx = await requireTeam(1);
  const ws = await wsInScope(ctx, wsId);
  if (!ws) back(fd, { error: "Workspace not found." });
  const body = str(fd, "body", 4000);
  if (!body) back(fd, { error: "Write something first." });
  await admin().from("team_notes").insert({ team_org_id: ctx.orgId, workspace_id: ws.id, author_id: ctx.user.id, body, pinned: fd.get("pinned") === "on" });
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: ctx.user.id, action: "team.note.add", entity: "note" });
  revalidatePath(`/team/w/${ws.id}`);
  back(fd, { notice: "Note added." }, `/team/w/${ws.id}`);
}

export async function togglePin(noteId: string, fd: FormData) {
  const ctx = await requireTeam(1);
  const { data: n } = await admin().from("team_notes").select("id,workspace_id,pinned").eq("id", noteId).eq("team_org_id", ctx.orgId).maybeSingle();
  if (!n || !(await wsInScope(ctx, n.workspace_id))) back(fd, { error: "Note not found." });
  await admin().from("team_notes").update({ pinned: !n.pinned }).eq("id", noteId);
  revalidatePath(`/team/w/${n.workspace_id}`);
  back(fd, {}, `/team/w/${n.workspace_id}`);
}

export async function deleteNote(noteId: string, fd: FormData) {
  const ctx = await requireTeam(1);
  const { data: n } = await admin().from("team_notes").select("id,workspace_id,author_id").eq("id", noteId).eq("team_org_id", ctx.orgId).maybeSingle();
  if (!n) back(fd, { error: "Note not found." });
  if (!(ctx.rank >= 2 || n.author_id === ctx.user.id)) back(fd, { error: "Only the author or an admin can delete a note." });
  await admin().from("team_notes").delete().eq("id", noteId);
  await audit({ orgId: ctx.orgId, workspaceId: n.workspace_id, actorId: ctx.user.id, action: "team.note.delete", entity: "note", entityId: noteId });
  revalidatePath(`/team/w/${n.workspace_id}`);
  back(fd, { notice: "Note deleted." }, `/team/w/${n.workspace_id}`);
}

// ---------------------------------------------------------------------------- notifications
export async function markAllRead(fd: FormData) {
  const ctx = await requireTeam(1);
  await admin().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.user.id).is("read_at", null);
  revalidatePath("/team");
  back(fd, { notice: "All caught up." }, "/team/notifications");
}

export async function markRead(id: string, fd: FormData) {
  const ctx = await requireTeam(1);
  await admin().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.user.id);
  revalidatePath("/team");
  back(fd, {}, "/team/notifications");
}
