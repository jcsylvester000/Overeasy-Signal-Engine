import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { ScoringModel } from "@/core/scoring/types";
import { Badge, Button, Card, Notice, PageHeader, Table, Td, when } from "@/components/ui";
import { ScoringBuilder } from "@/components/scoring-builder";
import { rollbackScoring, saveScoring } from "../actions";

export const metadata = { title: "Lead scoring" };

export default async function Scoring({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 3);
  const sb = await userClient();
  const { data: versions } = await sb.from("scoring_models").select("id,version,status,notes,published_at,created_at,model").eq("workspace_id", ws.id).order("version", { ascending: false });
  const draft = versions?.find((v) => v.status === "draft");
  const published = versions?.find((v) => v.status === "published");
  const editing = draft ?? published;
  const parsed = ScoringModel.safeParse(editing?.model);
  const fallback = !parsed.success && editing !== published ? ScoringModel.safeParse(published?.model) : null;
  const m = parsed.success ? parsed.data : fallback?.success ? fallback.data : null;

  return (
    <>
      <PageHeader
        title="① Lead scoring — form value calculator"
        description="Every form lead is scored the moment it arrives. Edit questions, points, lead types and test cases below; publishing runs every test case and is blocked if any fails. Existing leads keep the score (and version) they were given."
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      {draft && <div className="mb-4"><Notice tone="amber">You are editing draft v{draft.version} (not live). Live: v{published?.version ?? "—"}.</Notice></div>}
      {!parsed.success && m && <div className="mb-4"><Notice tone="red">The draft could not be read, so the builder shows the live version. Fix the draft in the JSON editor below, or save from the builder to replace it.</Notice></div>}
      {!m && <Notice tone="red">The model could not be read. Use the JSON editor below to fix it.</Notice>}

      {m && <ScoringBuilder initial={m} action={saveScoring.bind(null, ws.id)} />}

      <Card title="Advanced: edit the model as JSON" description="Fields, rules, lead-type conditions and test cases. Validated and tested on save." className="mt-6">
        <form action={saveScoring.bind(null, ws.id)} className="space-y-3">
          <textarea name="json" rows={18} className="w-full font-mono text-xs" defaultValue={JSON.stringify(editing?.model ?? {}, null, 2)} aria-label="Scoring model JSON" />
          <div className="flex gap-3">
            <Button name="intent" value="draft" variant="secondary">
              Save draft
            </Button>
            <Button name="intent" value="publish">
              Run tests & publish
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Version history" className="mt-6">
        <Table head={["Version", "Status", "Published", "Note", ""]}>
          {(versions ?? []).map((v) => (
            <tr key={v.id}>
              <Td>v{v.version}</Td>
              <Td>
                <Badge tone={v.status === "published" ? "green" : v.status === "draft" ? "amber" : "gray"}>{v.status}</Badge>
              </Td>
              <Td>{when(v.published_at)}</Td>
              <Td className="text-xs">{v.notes}</Td>
              <Td>
                {v.status === "archived" && (
                  <form action={rollbackScoring.bind(null, ws.id, v.id)}>
                    <button className="text-xs text-brand hover:underline">Roll back to this</button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
