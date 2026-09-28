import { brandForOrg } from "@/lib/brand";
import { enforceMfa, requireOrg, requireUser } from "@/lib/tenancy";
import { TEMPLATES } from "@/core/templates";
import { TopBar } from "@/components/topbar";
import { PageHeader } from "@/components/ui";
import { WorkspaceWizard, type TemplateSummary } from "@/components/workspace-wizard";
import { createWorkspaceWizard } from "../../actions";

export const metadata = { title: "Add workspace" };

export default async function NewWorkspace({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ from?: string }> }) {
  const { org: orgId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const { org, rank } = await requireOrg(orgId, 4);
  await enforceMfa(orgId, rank, `/org/${orgId}/workspaces/new`);
  const brand = await brandForOrg(orgId);
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
  const cancelHref = sp.from === "org" ? `/org/${orgId}` : "/app";

  return (
    <>
      <TopBar brand={brand} email={user.email}>
        <span className="text-muted">{org.name} · Add workspace</span>
      </TopBar>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader title="Add a client workspace" description={`For ${org.name}. Four short steps; everything can be changed later.`} />
        <WorkspaceWizard orgName={org.name} cancelHref={cancelHref} templates={templates} zones={zones} action={createWorkspaceWizard.bind(null, orgId)} />
      </main>
    </>
  );
}
