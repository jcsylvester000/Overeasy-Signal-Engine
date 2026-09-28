import Link from "next/link";
import { env } from "@/lib/env";
import { brandForHost } from "@/lib/brand";
import { userClient } from "@/lib/supabase/server";
import { requireUser, type Org, type Workspace } from "@/lib/tenancy";
import { TopBar } from "@/components/topbar";
import { PendingButton } from "@/components/pending-button";
import { createDemo } from "./actions";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Workspaces" };

export default async function AppHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
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
  const [{ data: orgs }, { data: wss }, { brand }] = await Promise.all([
    sb.from("organizations").select("*").order("name"),
    sb.from("workspaces").select("*").order("name"),
    brandForHost(),
  ]);
  const workspaces = (wss ?? []) as Workspace[];
  const organizations = (orgs ?? []) as Org[];

  const { data: ranks } = await sb.from("memberships").select("org_id,workspace_id,role").eq("user_id", user.id);
  const adminOrgs = new Set((ranks ?? []).filter((m) => !m.workspace_id && ["owner", "admin"].includes(m.role)).map((m) => m.org_id));
  const firstAdminOrg = organizations.find((o) => adminOrgs.has(o.id))?.id;
  const hasDemo = workspaces.some((w) => (w.settings as { demo?: boolean })?.demo);

  return (
    <>
      <TopBar brand={brand} email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Workspaces" description="Each workspace is one client business: its website, CRM pipeline and ad accounts." />
        {!organizations.length && <Notice tone="amber">You have no access yet. Ask your administrator for an invitation.</Notice>}
        {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
        {firstAdminOrg && !hasDemo && (
          <Card title="See the full application with sample data" description="Creates a demo client workspace (a land buyer) with 120 days of ad clicks, scored leads, CRM stage changes, value-ladder uploads to Google and Microsoft (dry run), ad spend, alerts and an automation registry. You can delete it any time." className="mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <form action={createDemo.bind(null, firstAdminOrg)}>
                <PendingButton pendingText="Building demo data… (about 10–20 seconds)">Create demo workspace</PendingButton>
              </form>
              <Link href={`/org/${firstAdminOrg}`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50">
                Create a real client workspace
              </Link>
            </div>
          </Card>
        )}
        <div className="space-y-6">
          {organizations.map((o) => {
            const list = workspaces.filter((w) => w.org_id === o.id);
            return (
              <Card
                key={o.id}
                title={
                  <span className="flex items-center gap-2">
                    {o.name} <Badge>{o.type}</Badge>
                  </span>
                }
                actions={
                  adminOrgs.size && (adminOrgs.has(o.id) || adminOrgs.has(o.parent_id ?? "")) ? (
                    <Link className="text-sm text-brand hover:underline" href={`/org/${o.id}`}>
                      Manage organization →
                    </Link>
                  ) : undefined
                }
              >
                {list.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {list.map((w) => (
                      <li key={w.id}>
                        <Link href={`/w/${w.id}`} className="block rounded-md border border-line p-3 hover:border-brand">
                          <div className="flex items-center gap-2 font-medium">
                            {w.name}
                            {(w.settings as { demo?: boolean })?.demo && <Badge tone="purple">demo data</Badge>}
                          </div>
                          <div className="text-xs text-muted">
                            {w.industry_template ?? "custom"} · {w.currency} · {w.timezone}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No workspaces yet.</p>
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </>
  );
}
