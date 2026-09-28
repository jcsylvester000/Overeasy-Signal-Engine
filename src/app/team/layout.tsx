import { brandCssVars, brandForOrg } from "@/lib/brand";
import { lazySweep, requireTeam, TEAM_ROLE_LABEL } from "@/server/team";
import { TopBar } from "@/components/topbar";
import { SideNav } from "@/components/nav";
import { Badge } from "@/components/ui";

export const metadata = { title: { default: "Team", template: "%s · Team" } };

/** Agency team area. Only team members (super-admin, admin, user) get here; clients get a 404. */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTeam(1);
  await lazySweep();
  const brand = await brandForOrg(ctx.orgId);
  const items = [
    { href: "/team", label: "My board", group: "Me" },
    { href: "/team/tasks", label: "Tasks", group: "Me" },
    { href: "/team/notifications", label: "Notifications", group: "Me" },
    ...(ctx.rank >= 2
      ? [
          { href: "/team/overview", label: "Team overview", group: "Manage" },
          { href: "/team/members", label: "Members & access", group: "Manage" },
          { href: "/team/audit", label: "Audit log", group: "Manage" },
        ]
      : []),
    { href: "/app", label: "All workspaces →", group: "Go to" },
  ];
  return (
    <>
      <style>{brandCssVars(brand)}</style>
      <TopBar brand={brand} email={ctx.user.email}>
        <span className="flex items-center gap-2">
          <span className="font-medium">{ctx.orgName} team</span>
          <Badge tone={ctx.role === "super_admin" ? "purple" : ctx.role === "admin" ? "blue" : "gray"}>{TEAM_ROLE_LABEL[ctx.role]}</Badge>
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
