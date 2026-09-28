import Link from "next/link";
import { brandCssVars, brandForOrg } from "@/lib/brand";
import { env } from "@/lib/env";
import { requireUser, requireWorkspace, ROLE_LABEL, type Role } from "@/lib/tenancy";
import { TopBar } from "@/components/topbar";
import { SideNav } from "@/components/nav";
import { Badge } from "@/components/ui";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const { ws: wsId } = await params;
  const user = await requireUser();
  const { ws, org, rank } = await requireWorkspace(wsId);
  const brand = await brandForOrg(org.id);
  const base = `/w/${ws.id}`;
  const roleName = (Object.entries({ owner: 5, admin: 4, manager: 3, analyst: 2, client_viewer: 1 }).find(([, r]) => r === rank)?.[0] ?? "client_viewer") as Role;
  const mode = env.connectorMode();

  const items = [
    { href: base, label: "Overview", group: "Results" },
    { href: `${base}/leads`, label: "Leads", group: "Results" },
    { href: `${base}/signals`, label: "Ad signals", group: "Results" },
    ...(rank >= 3
      ? [
          { href: `${base}/scoring`, label: "① Lead scoring", group: "Configure" },
          { href: `${base}/stages`, label: "② CRM stages", group: "Configure" },
          { href: `${base}/value`, label: "⑤ Value ladder", group: "Configure" },
          { href: `${base}/connections`, label: "Connections", group: "Configure" },
          { href: `${base}/sites`, label: "Sites & API", group: "Configure" },
          { href: `${base}/simulator`, label: "Simulator", group: "Configure" },
        ]
      : []),
    { href: `${base}/health`, label: "Health", group: "Operate" },
    ...(rank >= 3 ? [{ href: `${base}/audit`, label: "Audit log", group: "Operate" }] : []),
    ...(rank >= 4 ? [{ href: `${base}/settings`, label: "Settings", group: "Operate" }] : []),
  ];

  return (
    <>
      <style>{brandCssVars(brand)}</style>
      <TopBar brand={brand} email={user.email}>
        <span className="flex items-center gap-2">
          <Link href="/app" className="text-muted hover:text-ink">
            {org.name}
          </Link>
          <span className="text-muted">/</span>
          <span className="font-medium">{ws.name}</span>
          <Badge tone="gray">{ROLE_LABEL[roleName]}</Badge>
          {mode !== "live" && <Badge tone={mode === "dry_run" ? "blue" : "purple"}>{mode === "dry_run" ? "Dry run: nothing is sent to ad platforms" : "Test mode"}</Badge>}
        </span>
      </TopBar>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-48 md:shrink-0">
          <SideNav items={items} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
