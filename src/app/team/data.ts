import "server-only";
import { cache } from "react";
import { emailsFor, scopeWorkspaces, teamMembers, type TeamCtx } from "@/server/team";

/** Workspaces in scope + active team members, as select options and lookup maps (cached per request). */
export const lookups = cache(async (ctx: TeamCtx) => {
  const [wss, members] = await Promise.all([scopeWorkspaces(ctx), teamMembers(ctx.orgId)]);
  // Names come from team_members; emails from a per-instance cache (no extra round trip once warm).
  const emails = await emailsFor(members.map((m) => m.user_id));
  const labels = new Map(members.map((m) => [m.user_id, { name: m.full_name || (emails.get(m.user_id) ?? "").split("@")[0] || "Member", email: emails.get(m.user_id) ?? "" }]));
  const active = members.filter((m) => m.status === "active");
  const memberOpts = active.map((m) => ({ id: m.user_id, label: m.full_name || labels.get(m.user_id)?.name || "Member" }));
  const wsOpts = wss.map((w) => ({ id: w.id, label: w.name }));
  const wsName = new Map(wss.map((w) => [w.id, w.name]));
  const memberName = new Map(members.map((m) => [m.user_id, m.full_name || labels.get(m.user_id)?.name || "Member"]));
  return { wss, members, labels, memberOpts, wsOpts, wsName, memberName };
});
