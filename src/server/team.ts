import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { currentUser, requireUser, type SessionUser } from "@/lib/tenancy";

/**
 * Agency team CRM. Team roles live in team_members (per organization that runs a team, usually the platform org).
 * Clients (client_viewer) are never team members and never see any of this.
 */
export const TEAM_ROLES = ["super_admin", "admin", "user"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_RANK: Record<TeamRole, number> = { super_admin: 3, admin: 2, user: 1 };
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { super_admin: "Super-admin", admin: "Admin", user: "User" };
/** Org-wide membership role that backs each team role ("user" gets per-workspace access via assignments). */
export const TEAM_ROLE_MEMBERSHIP: Record<TeamRole, "owner" | "admin" | null> = { super_admin: "owner", admin: "admin", user: null };

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TASK_STATUS_LABEL: Record<(typeof TASK_STATUSES)[number], string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type TeamCtx = {
  user: SessionUser;
  orgId: string;
  orgName: string;
  role: TeamRole;
  rank: number;
  /** The team org and every organization below it. */
  orgIds: string[];
  /** Workspaces assigned to this user in this team. */
  assigned: string[];
  teams: { orgId: string; name: string; role: TeamRole }[];
};

type Row = { org_id: string; team_role: TeamRole; organizations: { name: string; type: string } | { name: string; type: string }[] | null };
const orgOf = (r: Row) => (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations);

/** Active team rows for a user (cached per request). */
export const teamRowsFor = cache(async (userId: string) => {
  const { data } = await admin().from("team_members").select("org_id,team_role,organizations(name,type)").eq("user_id", userId).eq("status", "active");
  return (data ?? []) as Row[];
});

export async function descendants(orgId: string): Promise<string[]> {
  const { data } = await admin().from("organizations").select("id,parent_id");
  const all = (data ?? []) as { id: string; parent_id: string | null }[];
  const out = [orgId];
  for (let i = 0; i < out.length && i < 500; i++) for (const o of all) if (o.parent_id === out[i] && !out.includes(o.id)) out.push(o.id);
  return out;
}

export async function ancestors(orgId: string): Promise<string[]> {
  const out: string[] = [];
  let id: string | null = orgId;
  for (let i = 0; id && i < 6; i++) {
    out.push(id);
    const { data }: { data: { parent_id: string | null } | null } = await admin().from("organizations").select("parent_id").eq("id", id).maybeSingle();
    id = data?.parent_id ?? null;
  }
  return out;
}

/** Team context for the signed-in user, or null when they are not on any team. */
export const teamContext = cache(async (teamParam?: string | null): Promise<TeamCtx | null> => {
  const user = await currentUser();
  if (!user) return null;
  const rows = await teamRowsFor(user.id);
  if (!rows.length) return null;
  const pick = rows.find((r) => r.org_id === teamParam) ?? rows.find((r) => orgOf(r)?.type === "platform") ?? rows[0];
  const [orgIds, { data: asg }] = await Promise.all([descendants(pick.org_id), admin().from("workspace_assignments").select("workspace_id").eq("user_id", user.id).eq("team_org_id", pick.org_id)]);
  return {
    user,
    orgId: pick.org_id,
    orgName: orgOf(pick)?.name ?? "Team",
    role: pick.team_role,
    rank: TEAM_RANK[pick.team_role],
    orgIds,
    assigned: (asg ?? []).map((a) => a.workspace_id as string),
    teams: rows.map((r) => ({ orgId: r.org_id, name: orgOf(r)?.name ?? "Team", role: r.team_role })),
  };
});

export async function requireTeam(minRank = 1, teamParam?: string | null): Promise<TeamCtx> {
  await requireUser();
  const ctx = await teamContext(teamParam);
  if (!ctx || ctx.rank < minRank) notFound();
  return ctx;
}

export type ScopeWs = { id: string; name: string; org_id: string; industry_template: string | null; settings: Record<string, unknown>; archived_at: string | null };

/** Workspaces this team member works on: admins see the whole team tree, users see their assignments. */
export async function scopeWorkspaces(ctx: TeamCtx, opts: { includeArchived?: boolean; onlyAssigned?: boolean } = {}): Promise<ScopeWs[]> {
  let q = admin().from("workspaces").select("id,name,org_id,industry_template,settings,archived_at").in("org_id", ctx.orgIds).order("name");
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data } = await q;
  const all = (data ?? []) as ScopeWs[];
  if (ctx.rank >= 2 && !opts.onlyAssigned) return all;
  return all.filter((w) => ctx.assigned.includes(w.id));
}

export function canSeeWorkspace(ctx: TeamCtx, ws: { id: string; org_id: string }) {
  return ctx.orgIds.includes(ws.org_id) && (ctx.rank >= 2 || ctx.assigned.includes(ws.id));
}

export type WsMetrics = {
  workspace_id: string;
  leads_7d: number;
  leads_30d: number;
  qualified_7d: number;
  contracts_30d: number;
  funded_30d: number;
  alerts_open: number;
  alerts_critical: number;
  failed_30d: number;
  last_tag_event: string | null;
  last_lead_at: string | null;
  open_tasks: number;
  overdue_tasks: number;
};

export async function workspaceMetrics(ids: string[]): Promise<Map<string, WsMetrics>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin().rpc("ose_team_ws_metrics", { p_ws: ids });
  if (error) console.error("[team] metrics", error.message);
  return new Map(((data ?? []) as WsMetrics[]).map((m) => [m.workspace_id, m]));
}

/** 0–100: higher = needs attention sooner. Used to rank workspaces on boards. */
export function attentionScore(m: WsMetrics | undefined, now: number): number {
  if (!m) return 0;
  const tagAge = m.last_tag_event ? (now - new Date(m.last_tag_event).getTime()) / 3_600_000 : Infinity;
  let s = 0;
  s += Math.min(40, m.alerts_critical * 20 + m.alerts_open * 5);
  s += Math.min(20, m.failed_30d * 4);
  s += Math.min(20, m.overdue_tasks * 10);
  if (tagAge > 24) s += 15;
  if (m.leads_7d === 0) s += 5;
  return Math.min(100, s);
}

// ---------------------------------------------------------------------------- team membership helpers

export async function teamMembers(orgId: string) {
  const { data } = await admin().from("team_members").select("*").eq("org_id", orgId).order("created_at");
  return (data ?? []) as { org_id: string; user_id: string; team_role: TeamRole; full_name: string | null; title: string | null; phone: string | null; status: string; created_at: string }[];
}

/** user id → display label (name, else email). Service role: team pages only. */
export async function userLabels(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
  const db = admin();
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, { name: string; email: string }>();
  const { data: tm } = uniq.length ? await db.from("team_members").select("user_id,full_name").in("user_id", uniq) : { data: [] };
  const names = new Map((tm ?? []).map((t) => [t.user_id as string, (t.full_name as string | null) ?? ""]));
  await Promise.all(
    uniq.map(async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      const email = data.user?.email ?? "";
      out.set(id, { name: names.get(id) || email.split("@")[0] || "Unknown", email });
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------- notifications

export type NotifyInput = { userId: string; teamOrgId?: string | null; workspaceId?: string | null; kind: string; title: string; body?: string | null; link?: string | null; dedupeKey?: string | null };

export async function notify(list: NotifyInput[]) {
  const db = admin();
  for (const n of list) {
    const { error } = await db.from("notifications").insert({
      user_id: n.userId,
      team_org_id: n.teamOrgId ?? null,
      workspace_id: n.workspaceId ?? null,
      kind: n.kind,
      title: n.title.slice(0, 200),
      body: n.body?.slice(0, 500) ?? null,
      link: n.link ?? null,
      dedupe_key: n.dedupeKey ?? null,
    });
    if (error && !/duplicate key/i.test(error.message)) console.error("[notify]", error.message);
  }
}

/** Notify the team working on a workspace: its assignees, else the admins of the team(s) above it. Skips demo/archived workspaces. */
export async function notifyWorkspaceTeam(workspaceId: string, n: Omit<NotifyInput, "userId" | "workspaceId" | "teamOrgId">) {
  try {
    const db = admin();
    const { data: ws } = await db.from("workspaces").select("id,org_id,settings,archived_at").eq("id", workspaceId).maybeSingle();
    if (!ws || ws.archived_at || (ws.settings as { demo?: boolean })?.demo) return;
    const { data: asg } = await db.from("workspace_assignments").select("user_id,team_org_id").eq("workspace_id", workspaceId);
    let targets = (asg ?? []).map((a) => ({ userId: a.user_id as string, teamOrgId: a.team_org_id as string }));
    if (!targets.length) {
      const orgIds = await ancestors(ws.org_id);
      const { data: admins } = await db.from("team_members").select("user_id,org_id").in("org_id", orgIds).in("team_role", ["super_admin", "admin"]).eq("status", "active");
      targets = (admins ?? []).map((a) => ({ userId: a.user_id as string, teamOrgId: a.org_id as string }));
    }
    await notify(targets.map((t) => ({ ...n, userId: t.userId, teamOrgId: t.teamOrgId, workspaceId })));
  } catch (e) {
    console.error("[notifyWorkspaceTeam]", e);
  }
}

// ---------------------------------------------------------------------------- sweeps

/** Reminders due, task reminders, overdue tasks → notifications. Runs from cron and lazily when a team page opens. */
export async function sweepTeam(nowIso = new Date().toISOString()) {
  const db = admin();
  const { data: rem } = await db.from("team_reminders").select("id,user_id,team_org_id,workspace_id,note").is("sent_at", null).lte("remind_at", nowIso).limit(200);
  for (const r of rem ?? []) {
    await notify([{ userId: r.user_id, teamOrgId: r.team_org_id, workspaceId: r.workspace_id, kind: "reminder", title: `Reminder: ${r.note}`, link: r.workspace_id ? `/team/w/${r.workspace_id}` : "/team", dedupeKey: `rem:${r.id}` }]);
    await db.from("team_reminders").update({ sent_at: nowIso }).eq("id", r.id);
  }
  const { data: due } = await db.from("team_tasks").select("id,title,assignee_id,created_by,team_org_id,workspace_id").is("reminded_at", null).neq("status", "done").lte("remind_at", nowIso).limit(200);
  for (const t of due ?? []) {
    const to = t.assignee_id ?? t.created_by;
    if (to) await notify([{ userId: to, teamOrgId: t.team_org_id, workspaceId: t.workspace_id, kind: "task_reminder", title: `Reminder: ${t.title}`, link: `/team/tasks?task=${t.id}`, dedupeKey: `task-rem:${t.id}` }]);
    await db.from("team_tasks").update({ reminded_at: nowIso }).eq("id", t.id);
  }
  const { data: late } = await db.from("team_tasks").select("id,title,assignee_id,created_by,team_org_id,workspace_id").is("overdue_notified_at", null).neq("status", "done").lt("due_at", nowIso).limit(200);
  for (const t of late ?? []) {
    const to = [...new Set([t.assignee_id, t.created_by].filter(Boolean) as string[])];
    await notify(to.map((u) => ({ userId: u, teamOrgId: t.team_org_id, workspaceId: t.workspace_id, kind: "task_overdue", title: `Overdue: ${t.title}`, link: `/team/tasks?task=${t.id}`, dedupeKey: `task-late:${t.id}` })));
    await db.from("team_tasks").update({ overdue_notified_at: nowIso }).eq("id", t.id);
  }
}

let lastLazySweep = 0;
/** Cheap lazy sweep (at most once a minute per server instance) so reminders work without the cron. */
export async function lazySweep() {
  if (Date.now() - lastLazySweep < 60_000) return;
  lastLazySweep = Date.now();
  try {
    await sweepTeam();
  } catch (e) {
    console.error("[team] sweep", e);
  }
}

// ---------------------------------------------------------------------------- workspace archive / purge

/** Wipes stored OAuth tokens, then deletes the workspace and everything under it (cascade). */
export async function purgeWorkspace(workspaceId: string) {
  const db = admin();
  const { data: conns } = await db.from("connections").select("id,token_secret_id").eq("workspace_id", workspaceId);
  for (const c of conns ?? []) if (c.token_secret_id) await db.rpc("ose_vault_put", { p_name: `conn:${c.id}`, p_secret: "{}" });
  const { error } = await db.from("workspaces").delete().eq("id", workspaceId);
  if (error) throw new Error(error.message);
}

/** Permanently removes workspaces archived more than 30 days ago (retention sweep). */
export async function purgeArchived() {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await admin().from("workspaces").select("id").lt("archived_at", cutoff).limit(20);
  for (const w of data ?? []) await purgeWorkspace(w.id);
}

/** Assign (or unassign) a team member to a workspace: assignment row + workspace membership + notification. */
export async function assignMember(ctx: TeamCtx, ws: { id: string; org_id: string; name: string }, userId: string, access: "manager" | "analyst", add: boolean) {
  const db = admin();
  if (add) {
    await db.from("workspace_assignments").upsert({ workspace_id: ws.id, user_id: userId, team_org_id: ctx.orgId, access, assigned_by: ctx.user.id }, { onConflict: "workspace_id,user_id" });
    await db.from("memberships").upsert({ user_id: userId, org_id: ws.org_id, workspace_id: ws.id, role: access }, { onConflict: "user_id,org_id,workspace_id" });
    if (userId !== ctx.user.id) await notify([{ userId, teamOrgId: ctx.orgId, workspaceId: ws.id, kind: "assigned", title: `You were assigned to ${ws.name}`, link: `/team/w/${ws.id}` }]);
  } else {
    await db.from("workspace_assignments").delete().eq("workspace_id", ws.id).eq("user_id", userId);
    await db.from("memberships").delete().eq("user_id", userId).eq("workspace_id", ws.id).in("role", ["manager", "analyst"]);
  }
}

