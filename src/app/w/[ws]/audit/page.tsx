import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { Card, Json, PageHeader, Table, Td, when } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function Audit({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: wsId } = await params;
  const { ws } = await requireWorkspace(wsId, 3);
  const sb = await userClient();
  const { data } = await sb.from("audit_log").select("*").eq("workspace_id", ws.id).order("at", { ascending: false }).limit(300);
  return (
    <>
      <PageHeader title="Audit log" description="Immutable record of configuration changes and user actions in this workspace." />
      <Card>
        <Table head={["When", "Action", "Entity", "Actor", "Detail"]} empty="No entries yet.">
          {(data ?? []).map((a) => (
            <tr key={a.id}>
              <Td>{when(a.at)}</Td>
              <Td className="font-mono text-xs">{a.action}</Td>
              <Td>
                {a.entity} {a.entity_id && <span className="font-mono text-xs text-muted">{String(a.entity_id).slice(0, 12)}</span>}
              </Td>
              <Td className="font-mono text-xs">{a.actor_id ? String(a.actor_id).slice(0, 8) : "system"}</Td>
              <Td>
                <Json value={a.diff} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
