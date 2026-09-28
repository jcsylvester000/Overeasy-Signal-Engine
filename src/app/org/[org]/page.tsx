import Link from "next/link";
import { admin } from "@/lib/supabase/admin";
import { brandForOrg, sanitizeBrand } from "@/lib/brand";
import { enforceMfa, requireOrg, requireUser, ROLE_LABEL, ROLES, type Org, type Workspace } from "@/lib/tenancy";
import { TEMPLATES } from "@/core/templates";
import { TopBar } from "@/components/topbar";
import { nowMs } from "@/lib/time";
import { Badge, Button, Card, Field, Notice, PageHeader, Table, Td } from "@/components/ui";
import { addChildOrg, addWorkspace, invite, removeMember, saveBrand, saveSecurity } from "./actions";
import { createDemo } from "@/app/app/actions";
import { PendingButton } from "@/components/pending-button";

export const metadata = { title: "Organization" };

export default async function OrgPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ saved?: string; error?: string; note?: string }> }) {
  const { org: orgId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const { org, rank } = await requireOrg(orgId, 4);
  await enforceMfa(orgId, rank, `/org/${orgId}`);
  const db = admin();
  const [{ data: usage }, { data: wss }, { data: members }, { data: children }, brand] = await Promise.all([
    db.from("usage_monthly").select("*").eq("org_id", orgId).order("month", { ascending: false }).limit(60),
    db.from("workspaces").select("*").eq("org_id", orgId).order("name"),
    db.from("memberships").select("id,user_id,workspace_id,role,created_at").eq("org_id", orgId),
    db.from("organizations").select("*").eq("parent_id", orgId).order("name"),
    brandForOrg(orgId),
  ]);
  const workspaces = (wss ?? []) as Workspace[];
  // Partner console (P-03): health across this organization's and its child organizations' client workspaces.
  const childIds = ((children ?? []) as Org[]).map((c) => c.id);
  const { data: allWs } = await db.from("workspaces").select("id,name,org_id,settings").in("org_id", [orgId, ...childIds]);
  const since = new Date(nowMs() - 30 * 86_400_000).toISOString();
  const health = await Promise.all(
    (allWs ?? []).map(async (w) => {
      const [{ count: leads30 }, { count: alertsOpen }, { data: cs }, { data: st }, { count: failed }] = await Promise.all([
        db.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", w.id).gte("created_at", since),
        db.from("alerts").select("id", { count: "exact", head: true }).eq("workspace_id", w.id).neq("status", "resolved"),
        db.from("connections").select("provider,mode,status").eq("workspace_id", w.id).neq("status", "disconnected"),
        db.from("sites").select("last_event_at").eq("workspace_id", w.id),
        db.from("signal_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", w.id).in("status", ["dead", "failed"]).gte("created_at", since),
      ]);
      const lastTag = (st ?? []).map((x) => x.last_event_at).filter(Boolean).sort().at(-1) ?? null;
      return { w, leads30: leads30 ?? 0, alertsOpen: alertsOpen ?? 0, conns: cs ?? [], lastTag, failed: failed ?? 0 };
    }),
  );
  const own = sanitizeBrand(org.brand as never);
  const emails = new Map<string, string>();
  for (const m of members ?? []) {
    const { data } = await db.auth.admin.getUserById(m.user_id);
    if (data.user?.email) emails.set(m.user_id, data.user.email);
  }

  return (
    <>
      <TopBar brand={brand} email={user.email}>
        <span className="text-muted">Organization · {org.name}</span>
      </TopBar>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <PageHeader title={org.name} description={<>Type: <Badge>{org.type}</Badge> — manage client workspaces, users and white-label branding.</>} />
        {sp.error && <Notice tone="red">{sp.error}</Notice>}
        {sp.saved && <Notice tone="green">Saved.</Notice>}
        {sp.note && <Notice>{sp.note}</Notice>}

        <Card title="Client workspaces">
          <ul className="mb-4 grid gap-2 sm:grid-cols-2">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link href={`/w/${w.id}`} className="block rounded-md border border-line p-3 hover:border-brand">
                  <div className="font-medium">{w.name}</div>
                  <div className="text-xs text-muted">{w.industry_template}</div>
                </Link>
              </li>
            ))}
            {!workspaces.length && <li className="text-sm text-muted">No workspaces yet.</li>}
          </ul>
          <form action={addWorkspace.bind(null, orgId)} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <Field label="Client / business name">
              <input name="name" required placeholder="Acme Land Co" />
            </Field>
            <Field label="Industry template">
              <select name="template" defaultValue="land-acquisition">
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Website domain (optional)">
              <input name="domain" placeholder="example.com" />
            </Field>
            <Field label="Timezone">
              <input name="timezone" defaultValue="America/New_York" />
            </Field>
            <Field label="Currency">
              <select name="currency" defaultValue="USD">
                {["USD", "CAD", "GBP", "EUR", "AUD", "PHP"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <label className="flex items-start gap-2 text-xs sm:col-span-3">
              <input type="checkbox" name="attest" required className="mt-0.5" />
              <span>
                I confirm this client&apos;s forms are not directed at children under 13, will not collect health, criminal or other sensitive data unless the workspace is set as a regulated vertical, and the client&apos;s privacy policy discloses sharing with ad platforms. (Legal intake starts as a regulated vertical.)
              </span>
            </label>
            <div className="flex items-end">
              <Button>Create workspace</Button>
            </div>
          </form>
        </Card>

        <Card title="Client health" description="Every client workspace under this organization and its client organizations (last 30 days).">
          <Table head={["Workspace", "Organization", "Leads", "Open alerts", "Failed uploads", "Connections", "Last tag event"]} empty="No workspaces yet.">
            {health.map((h) => (
              <tr key={h.w.id}>
                <Td>
                  <Link className="text-brand hover:underline" href={`/w/${h.w.id}`}>
                    {h.w.name}
                  </Link>
                  {(h.w.settings as { demo?: boolean })?.demo && (
                    <span className="ml-1">
                      <Badge tone="purple">demo</Badge>
                    </span>
                  )}
                </Td>
                <Td className="text-xs">{h.w.org_id === orgId ? org.name : (((children ?? []) as Org[]).find((c) => c.id === h.w.org_id)?.name ?? "")}</Td>
                <Td className="num">{h.leads30}</Td>
                <Td className="num">{h.alertsOpen ? <Badge tone="amber">{h.alertsOpen}</Badge> : 0}</Td>
                <Td className="num">{h.failed ? <Badge tone="red">{h.failed}</Badge> : 0}</Td>
                <Td className="text-xs">
                  {h.conns.map((c) => (
                    <span key={c.provider} className="mr-1">
                      <Badge tone={c.status !== "ok" ? "red" : c.mode === "live" ? "green" : "blue"}>
                        {c.provider.replace("_ads", "")}:{c.mode}
                      </Badge>
                    </span>
                  ))}
                </Td>
                <Td className="text-xs">{h.lastTag ? new Date(h.lastTag).toISOString().slice(0, 16).replace("T", " ") : "—"}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Usage by month" description="Real (non-simulated) leads per workspace — the metering basis for billing once pricing is set.">
          <Table head={["Month", "Workspace", "Leads", "Simulated"]} empty="No leads yet.">
            {(usage ?? []).map((u) => (
              <tr key={`${u.workspace_id}${u.month}`}>
                <Td>{String(u.month).slice(0, 7)}</Td>
                <Td>{workspaces.find((w) => w.id === u.workspace_id)?.name ?? u.workspace_id}</Td>
                <Td className="num">{u.leads}</Td>
                <Td className="num">{u.test_leads}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Users" description="Organization-level roles apply to every workspace in this organization (and its child organizations).">
          <Table head={["User", "Scope", "Role", ""]}>
            {(members ?? []).map((m) => (
              <tr key={m.id}>
                <Td>{emails.get(m.user_id) ?? m.user_id}</Td>
                <Td>{m.workspace_id ? (workspaces.find((w) => w.id === m.workspace_id)?.name ?? "workspace") : "All workspaces"}</Td>
                <Td>{ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role}</Td>
                <Td>
                  {m.role !== "owner" && m.user_id !== user.id && (
                    <form action={removeMember.bind(null, orgId, m.id)}>
                      <button className="text-xs text-red-700 hover:underline">Remove</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <form action={invite.bind(null, orgId)} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-4">
            <Field label="Email">
              <input name="email" type="email" required />
            </Field>
            <Field label="Role">
              <select name="role" defaultValue="analyst">
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scope">
              <select name="workspace_id" defaultValue="">
                <option value="">All workspaces</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <Button>Send invite</Button>
            </div>
          </form>
        </Card>

        <Card title="Security">
          <form action={saveSecurity.bind(null, orgId)} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireMfaForAdmins" defaultChecked={Boolean((org as unknown as { settings?: { requireMfaForAdmins?: boolean } }).settings?.requireMfaForAdmins)} />
              Require two-factor authentication for owners and admins (this organization and its client organizations)
            </label>
            <Button variant="secondary">Save</Button>
          </form>
        </Card>

        <Card title="Demo" description="A sample client workspace with 120 days of realistic data (dry-run uploads), for demos and training.">
          <form action={createDemo.bind(null, orgId)}>
            <PendingButton pendingText="Building demo data… (about 10–20 seconds)">Create demo workspace</PendingButton>
          </form>
        </Card>

        <Card title="White-label branding" description="Shown to this organization's users and clients, on its custom domain, and in reports and emails.">
          <form action={saveBrand.bind(null, orgId)} className="grid gap-3 sm:grid-cols-2">
            <Field label="App name">
              <input name="appName" defaultValue={own.appName ?? ""} placeholder={brand.appName} />
            </Field>
            <Field label="Logo URL (https)">
              <input name="logoUrl" defaultValue={own.logoUrl ?? ""} />
            </Field>
            <Field label="Favicon URL (https)">
              <input name="faviconUrl" defaultValue={own.faviconUrl ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary colour">
                <input name="primary" type="color" defaultValue={own.primary ?? brand.primary} className="h-9 w-full" />
              </Field>
              <Field label="Accent colour">
                <input name="accent" type="color" defaultValue={own.accent ?? brand.accent} className="h-9 w-full" />
              </Field>
            </div>
            <Field label="Email sender" hint="Verified sender for alerts and reports.">
              <input name="emailFrom" defaultValue={own.emailFrom ?? ""} placeholder="reports@agency.com" />
            </Field>
            <Field label="Support email">
              <input name="supportEmail" defaultValue={own.supportEmail ?? ""} />
            </Field>
            <Field label="App domain" hint="e.g. app.agency.com — add it as a domain alias on the hosting site, then CNAME it.">
              <input name="custom_domain" defaultValue={org.custom_domain ?? ""} />
            </Field>
            <Field label="Tag domain" hint="e.g. t.agency.com — clients load ose.js from here.">
              <input name="tag_domain" defaultValue={org.tag_domain ?? ""} />
            </Field>
            <div>
              <Button>Save branding</Button>
            </div>
          </form>
        </Card>

        {org.type !== "direct" && (
          <Card title={org.type === "platform" ? "Partner agencies & direct clients" : "Client organizations"}>
            <ul className="mb-4 space-y-1 text-sm">
              {((children ?? []) as Org[]).map((c) => (
                <li key={c.id}>
                  <Link className="text-brand hover:underline" href={`/org/${c.id}`}>
                    {c.name}
                  </Link>{" "}
                  <Badge>{c.type}</Badge>
                </li>
              ))}
              {!children?.length && <li className="text-muted">None yet.</li>}
            </ul>
            <form action={addChildOrg.bind(null, orgId)} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <Field label="Name">
                <input name="name" required />
              </Field>
              {org.type === "platform" && (
                <Field label="Type">
                  <select name="type" defaultValue="partner">
                    <option value="partner">Partner agency (white-label)</option>
                    <option value="direct">Direct client</option>
                  </select>
                </Field>
              )}
              <Button variant="secondary">Create organization</Button>
            </form>
          </Card>
        )}
      </main>
    </>
  );
}
