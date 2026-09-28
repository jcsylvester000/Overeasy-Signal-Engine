import Link from "next/link";
import { env } from "@/lib/env";
import { nowMs } from "@/lib/time";
import { brandForHost } from "@/lib/brand";
import { userClient } from "@/lib/supabase/server";
import { orgRanksFor } from "@/lib/org-tree";
import { requireUser, type Org, type Workspace } from "@/lib/tenancy";
import { TopBar } from "@/components/topbar";
import { PendingButton } from "@/components/pending-button";
import { ConfirmAction, FormDialog } from "@/components/confirm";
import { archiveWorkspace, createDemo, deleteWorkspaceForever, restoreWorkspace, updateWorkspace } from "./actions";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Workspaces" };

const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "PHP"];

export default async function AppHome({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; undo?: string }> }) {
  const sp = await searchParams;
  if (!env.isConfigured()) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <Notice tone="amber">Supabase is not configured. Add the variables from .env.example and run the migration (see README).</Notice>
      </main>
    );
  }
  const user = await requireUser();
  const sb = await userClient();
  const [{ data: orgs }, { data: wss }, { brand }, ranks] = await Promise.all([sb.from("organizations").select("*").order("name"), sb.from("workspaces").select("*").order("name"), brandForHost(), orgRanksFor(user.id)]);
  const all = (wss ?? []) as Workspace[];
  const workspaces = all.filter((w) => !w.archived_at);
  const archived = all.filter((w) => w.archived_at);
  const organizations = (orgs ?? []) as Org[];
  // Effective rank per organization (includes roles inherited from a parent organization).
  const rankOf = ranks;
  const canManage = (orgId: string) => (rankOf.get(orgId) ?? 0) >= 4;
  const isOwner = (orgId: string) => (rankOf.get(orgId) ?? 0) >= 5;
  const anyAdmin = organizations.some((o) => canManage(o.id));
  const firstAdminOrg = organizations.find((o) => canManage(o.id))?.id;
  const hasDemo = workspaces.some((w) => (w.settings as { demo?: boolean })?.demo);
  const now = nowMs();
  const archivedVisible = archived.filter((w) => canManage(w.org_id));

  return (
    <>
      <TopBar brand={brand} email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          title="Workspaces"
          description="Each workspace is one client business: its website, CRM pipeline and ad accounts."
          actions={
            anyAdmin ? (
              <Link href="/app/workspaces/new" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
                + Add workspace
              </Link>
            ) : undefined
          }
        />
        {!organizations.length && <Notice tone="amber">You have no access yet. Ask your administrator for an invitation.</Notice>}
        {sp.error && (
          <div className="mb-4">
            <Notice tone="red">{sp.error.slice(0, 300)}</Notice>
          </div>
        )}
        {sp.notice && (
          <div className="mb-4">
            <Notice tone="green">
              <span className="flex flex-wrap items-center justify-between gap-2">
                {sp.notice.slice(0, 300)}
                {sp.undo && /^[0-9a-f-]{36}$/i.test(sp.undo) && (
                  <form action={restoreWorkspace.bind(null, sp.undo)}>
                    <button className="rounded border border-green-700 px-2 py-0.5 text-xs font-medium hover:bg-green-100">Undo</button>
                  </form>
                )}
              </span>
            </Notice>
          </div>
        )}
        {firstAdminOrg && !hasDemo && (
          <Card title="See the full application with sample data" description="Creates a demo client workspace (a land buyer) with 120 days of ad clicks, scored leads, CRM stage changes, value-ladder uploads to Google and Microsoft (dry run), ad spend, alerts and an automation registry. You can delete it any time." className="mb-6">
            <form action={createDemo.bind(null, firstAdminOrg)}>
              <PendingButton pendingText="Building demo data… (about 10–20 seconds)">Create demo workspace</PendingButton>
            </form>
          </Card>
        )}
        <div className="space-y-6">
          {organizations.map((o) => {
            const list = workspaces.filter((w) => w.org_id === o.id);
            const manage = canManage(o.id);
            return (
              <Card
                key={o.id}
                title={
                  <span className="flex items-center gap-2">
                    {o.name} <Badge>{o.type}</Badge>
                  </span>
                }
                actions={
                  manage ? (
                    <Link className="text-sm text-brand hover:underline" href={`/org/${o.id}`}>
                      Manage organization →
                    </Link>
                  ) : undefined
                }
              >
                {list.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {list.map((w) => (
                      <li key={w.id} className="group relative rounded-md border border-line bg-white hover:border-brand">
                        <Link href={`/w/${w.id}`} className="block p-3 pr-28">
                          <div className="flex items-center gap-2 font-medium">
                            {w.name}
                            {(w.settings as { demo?: boolean })?.demo && <Badge tone="purple">demo data</Badge>}
                          </div>
                          <div className="text-xs text-muted">
                            {w.industry_template ?? "custom"} · {w.currency} · {w.timezone}
                          </div>
                        </Link>
                        {manage && (
                          <div className="absolute right-3 top-3 flex items-center gap-3">
                            <FormDialog trigger="Edit" title={`Edit ${w.name}`} action={updateWorkspace.bind(null, w.id)}>
                              <label className="block">
                                <span className="text-xs font-medium">Client / business name</span>
                                <input name="name" required minLength={2} maxLength={120} defaultValue={w.name} className="mt-1 w-full" />
                              </label>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                  <span className="text-xs font-medium">Timezone</span>
                                  <input name="timezone" defaultValue={w.timezone} className="mt-1 w-full" />
                                </label>
                                <label className="block">
                                  <span className="text-xs font-medium">Currency</span>
                                  <select name="currency" defaultValue={w.currency} className="mt-1 w-full">
                                    {[...new Set([w.currency, ...CURRENCIES])].map((c) => (
                                      <option key={c}>{c}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <p className="text-xs text-muted">Industry, scoring and values are edited inside the workspace (Lead scoring, Value ladder).</p>
                            </FormDialog>
                            <ConfirmAction
                              action={archiveWorkspace.bind(null, w.id)}
                              trigger="Delete"
                              title={`Delete ${w.name}?`}
                              message={
                                <>
                                  The workspace is hidden right away and stops accepting website and CRM events. You can restore it for <b>30 days</b> from <i>Deleted workspaces</i>; after that it and all its data are removed permanently.
                                </>
                              }
                              confirmLabel="Delete workspace"
                              requireText={w.name}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No workspaces yet.</p>
                )}
              </Card>
            );
          })}

          {archivedVisible.length > 0 && (
            <Card title="Deleted workspaces" description="Restorable for 30 days after deletion, then removed permanently with all their data.">
              <ul className="divide-y divide-line">
                {archivedVisible.map((w) => {
                  const left = Math.max(0, 30 - Math.floor((now - new Date(w.archived_at!).getTime()) / 86_400_000));
                  return (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        <span className="font-medium">{w.name}</span>
                        <span className="ml-2 text-xs text-muted">
                          {organizations.find((o) => o.id === w.org_id)?.name} · {left} day{left === 1 ? "" : "s"} left
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <form action={restoreWorkspace.bind(null, w.id)}>
                          <button className="rounded border border-line px-2 py-0.5 text-xs hover:bg-gray-50">Restore</button>
                        </form>
                        {isOwner(w.org_id) && (
                          <ConfirmAction
                            action={deleteWorkspaceForever.bind(null, w.id)}
                            trigger="Delete permanently"
                            title={`Permanently delete ${w.name}?`}
                            message="All leads, signals, settings, connections and history for this workspace are erased now. This cannot be undone."
                            confirmLabel="Delete forever"
                            requireText={w.name}
                          />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </main>
    </>
  );
}
