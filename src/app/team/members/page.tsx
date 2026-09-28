import { admin } from "@/lib/supabase/admin";
import { nowMs } from "@/lib/time";
import { requireTeam, TEAM_ROLE_LABEL, TEAM_ROLES, teamMembers } from "@/server/team";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { ConfirmAction, FormDialog } from "@/components/confirm";
import { addMember, removeMember, sendPasswordReset, setMemberWorkspaces, setTempPassword, updateMember } from "../actions";
import { lookups } from "../data";
import { Flash, rel } from "../ui";

export const metadata = { title: "Members & access" };

const PERMS: [string, boolean, boolean, boolean][] = [
  ["See assigned workspaces, tasks, notes, notifications", true, true, true],
  ["Create and edit tasks, reminders, notes", true, true, true],
  ["See every workspace in the team + team overview", true, true, false],
  ["Add members, set temporary passwords, send reset emails", true, true, false],
  ["Assign members to workspaces", true, true, false],
  ["Create, edit and archive workspaces", true, true, false],
  ["Audit log", true, true, false],
  ["Add or change super-admins", true, false, false],
  ["Permanently delete archived workspaces", true, false, false],
];

export default async function Members({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTeam(2);
  const now = nowMs();
  const db = admin();
  const [members, L, { data: asg }] = await Promise.all([teamMembers(ctx.orgId), lookups(ctx), db.from("workspace_assignments").select("workspace_id,user_id,access").eq("team_org_id", ctx.orgId)]);
  const auth = new Map(
    await Promise.all(
      members.map(async (m) => {
        const { data } = await db.auth.admin.getUserById(m.user_id);
        const u = data.user;
        return [m.user_id, { email: u?.email ?? "", lastSignIn: u?.last_sign_in_at ?? null, mustChange: Boolean(u?.app_metadata?.must_change_password), invited: Boolean(u && !u.last_sign_in_at) }] as const;
      }),
    ),
  );
  const roleOptions = TEAM_ROLES.filter((r) => r !== "super_admin" || ctx.role === "super_admin");
  const returnTo = "/team/members";

  return (
    <>
      <PageHeader
        title="Members & access"
        description="Agency team logins. Passwords are stored by Supabase Auth (hashed); nobody can read them, only reset them."
        actions={
          <FormDialog trigger="+ Add member" title="Add a team member" action={addMember} submitLabel="Add member" triggerClassName="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <input type="hidden" name="return_to" value={returnTo} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium">Full name</span>
                <input name="full_name" required maxLength={120} className="mt-1 w-full" />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Email</span>
                <input name="email" type="email" required className="mt-1 w-full" />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Job title (optional)</span>
                <input name="title" maxLength={120} className="mt-1 w-full" placeholder="Account manager" />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Phone (optional)</span>
                <input name="phone" maxLength={40} className="mt-1 w-full" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium">Role</span>
                <select name="team_role" defaultValue="user" className="mt-1 w-full">
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {TEAM_ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="space-y-2 rounded-md border border-line p-3">
              <legend className="px-1 text-xs font-medium">How they sign in</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="method" value="password" defaultChecked className="mt-1" />
                <span>
                  Set a temporary password now
                  <span className="block text-xs text-muted">Share it privately. They must choose their own password at first sign-in.</span>
                </span>
              </label>
              <input name="password" type="password" minLength={12} autoComplete="new-password" placeholder="Temporary password (12+ characters)" className="w-full" />
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="method" value="invite" className="mt-1" />
                <span>
                  Email an invite
                  <span className="block text-xs text-muted">They set their own password from the email link.</span>
                </span>
              </label>
            </fieldset>
          </FormDialog>
        }
      />
      <Flash sp={sp} />

      <Card className="mb-6">
        <Table head={["Member", "Role", "Workspaces", "Last sign-in", "Status", ""]} empty="No members yet.">
          {members.map((m) => {
            const a = auth.get(m.user_id);
            const mine = (asg ?? []).filter((x) => x.user_id === m.user_id);
            const self = m.user_id === ctx.user.id;
            const locked = m.team_role === "super_admin" && ctx.role !== "super_admin";
            return (
              <tr key={m.user_id}>
                <Td>
                  <div className="font-medium">
                    {m.full_name || a?.email}
                    {self && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {a?.email}
                    {m.title ? ` · ${m.title}` : ""}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </div>
                </Td>
                <Td>
                  <Badge tone={m.team_role === "super_admin" ? "purple" : m.team_role === "admin" ? "blue" : "gray"}>{TEAM_ROLE_LABEL[m.team_role]}</Badge>
                </Td>
                <Td className="text-xs">{m.team_role === "user" ? `${mine.length} assigned` : `All${mine.length ? ` (${mine.length} assigned)` : ""}`}</Td>
                <Td className="text-xs">{a?.lastSignIn ? rel(a.lastSignIn, now) : "never"}</Td>
                <Td>
                  {m.status !== "active" ? <Badge tone="red">disabled</Badge> : a?.mustChange ? <Badge tone="amber">temp password</Badge> : a?.invited ? <Badge tone="blue">invited</Badge> : <Badge tone="green">active</Badge>}
                </Td>
                <Td>
                  {!self && !locked && (
                    <div className="flex flex-wrap items-center gap-3">
                      <FormDialog trigger="Edit" title={`Edit ${m.full_name || a?.email}`} action={updateMember.bind(null, m.user_id)}>
                        <input type="hidden" name="return_to" value={returnTo} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="text-xs font-medium">Full name</span>
                            <input name="full_name" defaultValue={m.full_name ?? ""} className="mt-1 w-full" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium">Job title</span>
                            <input name="title" defaultValue={m.title ?? ""} className="mt-1 w-full" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium">Phone</span>
                            <input name="phone" defaultValue={m.phone ?? ""} className="mt-1 w-full" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium">Role</span>
                            <select name="team_role" defaultValue={m.team_role} className="mt-1 w-full">
                              {roleOptions.map((r) => (
                                <option key={r} value={r}>
                                  {TEAM_ROLE_LABEL[r]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block sm:col-span-2">
                            <span className="text-xs font-medium">Status</span>
                            <select name="status" defaultValue={m.status} className="mt-1 w-full">
                              <option value="active">Active</option>
                              <option value="disabled">Disabled (cannot sign in)</option>
                            </select>
                          </label>
                        </div>
                      </FormDialog>
                      <FormDialog trigger="Workspaces" title={`Workspaces for ${m.full_name || a?.email}`} action={setMemberWorkspaces.bind(null, m.user_id)}>
                        <input type="hidden" name="return_to" value={returnTo} />
                        <p className="text-xs text-muted">{m.team_role === "user" ? "Users only see the workspaces ticked here." : "Admins can open every workspace; ticked ones appear on their board and send them alerts."}</p>
                        <ul className="max-h-72 space-y-1 overflow-y-auto">
                          {L.wss.map((w) => (
                            <li key={w.id}>
                              <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name="ws" value={w.id} defaultChecked={mine.some((x) => x.workspace_id === w.id)} /> {w.name}
                              </label>
                            </li>
                          ))}
                          {!L.wss.length && <li className="text-sm text-muted">No workspaces yet.</li>}
                        </ul>
                        <label className="block">
                          <span className="text-xs font-medium">Access on assigned workspaces</span>
                          <select name="access" defaultValue={mine[0]?.access ?? "manager"} className="mt-1 w-full">
                            <option value="manager">Manager: results + change setup</option>
                            <option value="analyst">Analyst: results + reports only</option>
                          </select>
                        </label>
                      </FormDialog>
                      <FormDialog trigger="Set password" title="Set a temporary password" action={setTempPassword.bind(null, m.user_id)} submitLabel="Set password">
                        <input type="hidden" name="return_to" value={returnTo} />
                        <p className="text-sm text-muted">They will be asked to choose their own password at next sign-in. Share it privately.</p>
                        <input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="12+ characters" className="w-full" />
                      </FormDialog>
                      <ConfirmAction action={sendPasswordReset.bind(null, m.user_id)} trigger="Email reset" tone="primary" title="Send a password reset email?" message={<>A reset link goes to {a?.email}.</>} confirmLabel="Send email" triggerClassName="text-xs text-muted hover:text-ink hover:underline" hidden={{ return_to: returnTo }} />
                      <ConfirmAction
                        action={removeMember.bind(null, m.user_id)}
                        trigger="Remove"
                        title="Remove from the team?"
                        message="They lose access to the team area and all assigned workspaces. Their open tasks become unassigned. Their login is kept."
                        confirmLabel="Remove member"
                        requireText={a?.email || undefined}
                        hidden={{ return_to: returnTo }}
                      />
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Roles and permissions">
        <Table head={["Permission", "Super-admin", "Admin", "User"]}>
          {PERMS.map(([p, s, a, u]) => (
            <tr key={p}>
              <Td>{p}</Td>
              {[s, a, u].map((v, i) => (
                <Td key={i} className={v ? "text-green-700" : "text-muted"}>
                  {v ? "✓" : "—"}
                </Td>
              ))}
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">Client logins (client viewers) are separate: they only see their own workspace dashboard, never the team area.</p>
      </Card>
    </>
  );
}
