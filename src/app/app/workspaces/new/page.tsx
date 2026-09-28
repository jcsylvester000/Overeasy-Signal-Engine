import { redirect } from "next/navigation";
import { brandForHost } from "@/lib/brand";
import { userClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/tenancy";
import { TEMPLATES } from "@/core/templates";
import { TopBar } from "@/components/topbar";
import { PageHeader } from "@/components/ui";
import { WorkspaceWizard, type TemplateSummary } from "@/components/workspace-wizard";
import { teamContext, teamMembers, userLabels } from "@/server/team";
import { createWorkspaceWizard } from "../../actions";

export const metadata = { title: "Add workspace" };

export default async function NewWorkspace({ searchParams }: { searchParams: Promise<{ org?: string; from?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const sb = await userClient();
  const [{ data: orgs }, { brand }, ctx] = await Promise.all([sb.from("organizations").select("id,name,type,parent_id").order("name"), brandForHost(), teamContext()]);
  // Organizations where this user is an admin or owner (directly or through a parent).
  const ranks = await Promise.all((orgs ?? []).map(async (o) => ({ o, rank: Number((await sb.rpc("ose_org_rank", { o: o.id })).data ?? 0) })));
  const manageable = ranks.filter((r) => r.rank >= 4).map((r) => ({ id: r.o.id as string, label: `${r.o.name}${r.o.type !== "platform" ? ` (${r.o.type})` : ""}` }));
  if (!manageable.length) redirect("/app?error=Only%20admins%20can%20add%20workspaces");

  let team: { id: string; label: string }[] = [];
  if (ctx && ctx.rank >= 2) {
    const members = (await teamMembers(ctx.orgId)).filter((m) => m.status === "active");
    const labels = await userLabels(members.map((m) => m.user_id));
    team = members.map((m) => ({ id: m.user_id, label: m.full_name || labels.get(m.user_id)?.name || "Team member" }));
  }
  const templates: TemplateSummary[] = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    leadTypes: [...new Set([...t.scoring.leadTypes.map((l) => l.type), t.scoring.defaultLeadType])],
    fields: t.scoring.fields.length,
    regulated: Boolean(t.regulated),
    currency: t.scoring.currency,
  }));
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {}
  const cancelHref = sp.from === "org" && sp.org ? `/org/${sp.org}` : "/app";

  return (
    <>
      <TopBar brand={brand} email={user.email}>
        <span className="text-muted">Add workspace</span>
      </TopBar>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader title="Add a client workspace" description="Four short steps; everything can be changed later." />
        <WorkspaceWizard orgs={manageable} defaultOrg={sp.org} team={team} cancelHref={cancelHref} templates={templates} zones={zones} action={createWorkspaceWizard} />
      </main>
    </>
  );
}
