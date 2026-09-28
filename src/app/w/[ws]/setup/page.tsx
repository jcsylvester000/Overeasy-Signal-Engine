import Link from "next/link";
import { requireWorkspace } from "@/lib/tenancy";
import { admin } from "@/lib/supabase/admin";
import { effectiveMode } from "@/lib/env";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Setup" };

type Step = { title: string; detail: string; done: boolean; href: string; cta: string };

/** P-05: onboarding checklist — template → CRM → ads → tag → mapping → test → observation → bidding. */
export default async function Setup({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { ws: wsId } = await params;
  const { welcome } = await searchParams;
  const { ws } = await requireWorkspace(wsId, 3);
  const db = admin();
  const base = `/w/${ws.id}`;
  const [{ data: scoring }, { data: value }, { data: conns }, { data: sites }, { data: maps }, { data: dests }, { data: jobs }, { data: leads }] = await Promise.all([
    db.from("scoring_models").select("version").eq("workspace_id", ws.id).eq("status", "published").maybeSingle(),
    db.from("value_models").select("version,notes").eq("workspace_id", ws.id).eq("status", "published").maybeSingle(),
    db.from("connections").select("provider,mode,status,token_secret_id").eq("workspace_id", ws.id).neq("status", "disconnected"),
    db.from("sites").select("last_event_at").eq("workspace_id", ws.id),
    db.from("stage_maps").select("canonical_stage").eq("workspace_id", ws.id),
    db.from("conversion_destinations").select("id").eq("workspace_id", ws.id),
    db.from("signal_jobs").select("status,mode").eq("workspace_id", ws.id).in("status", ["test", "sent"]).limit(50),
    db.from("leads").select("id").eq("workspace_id", ws.id).limit(1),
  ]);
  const demo = Boolean((ws.settings as { demo?: boolean }).demo);
  const has = (p: string, pred: (c: { mode: string; status: string; token_secret_id: string | null }) => boolean) => (conns ?? []).some((c) => c.provider === p && pred(c));
  const signedIn = (c: { token_secret_id: string | null }) => Boolean(c.token_secret_id) || demo;
  const steps: Step[] = [
    { title: "Choose and tune the scoring model", detail: `Scoring v${scoring?.version ?? "—"} is live. Adjust questions, points and lead types for this client, then publish.`, done: Boolean(scoring && (scoring.version > 1 || demo)), href: `${base}/scoring`, cta: "Open lead scoring" },
    { title: "Connect the CRM", detail: "Install the GoHighLevel app (or use the generic webhook) so stage changes arrive automatically.", done: has("ghl", signedIn) || (maps ?? []).length > 0, href: `${base}/connections`, cta: "Open connections" },
    { title: "Map CRM stages", detail: "Map each pipeline stage to Qualified, Opportunity, Contract, Sold, Funded or Lost, and agree entry rules with sales.", done: (maps ?? []).some((m) => m.canonical_stage === "contract"), href: `${base}/stages`, cta: "Map stages" },
    { title: "Connect Google Ads and Microsoft Advertising", detail: "Sign in to each ad account and create one conversion action per stage (secondary).", done: (has("google_ads", signedIn) || has("microsoft_ads", signedIn)) && (dests ?? []).length > 0, href: `${base}/connections`, cta: "Connect ad accounts" },
    { title: "Install the website tag", detail: "Paste the snippet (or use the GTM template / WordPress plugin) and confirm events arrive.", done: (sites ?? []).some((s) => s.last_event_at), href: `${base}/sites`, cta: "Get the snippet" },
    { title: "Set stage values", detail: "Enter the client's average profit per lead type and stage close rates (placeholders until real data).", done: Boolean(value && (value.version > 1 || demo)), href: `${base}/value`, cta: "Open value ladder" },
    { title: "Run an end-to-end test", detail: "Submit a simulated lead and move it through the stages; check the payloads under Ad signals.", done: (leads ?? []).length > 0, href: `${base}/simulator`, cta: "Open simulator" },
    { title: "Send test conversions", detail: "Switch connections to test mode (Google validateOnly / Microsoft sandbox) and confirm uploads are accepted.", done: (jobs ?? []).some((j) => j.status === "test") || (jobs ?? []).some((j) => j.status === "sent"), href: `${base}/connections`, cta: "Test mode" },
    { title: "Go live in observation (about 30 days)", detail: "Set connections to live with stage actions as secondary. Watch reconciliation weekly.", done: (conns ?? []).some((c) => effectiveMode(c.mode) === "live" && c.status === "ok"), href: `${base}/signals`, cta: "Open ad signals" },
    { title: "Switch bidding to stage values", detail: "When the readiness checklist is green, promote stages to primary and bid on conversion value.", done: false, href: `${base}/readiness`, cta: "Check readiness" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <>
      {welcome && (
        <div className="mb-4">
          <Notice tone="green">{welcome.slice(0, 300)}</Notice>
        </div>
      )}
      <PageHeader title="Setup" description={`Onboarding for ${ws.name}. ${doneCount} of ${steps.length} steps complete.`} />
      <div className="mb-6 h-2 rounded bg-gray-100">
        <div className="h-2 rounded bg-brand" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <Card>
        <ol className="divide-y divide-line">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="flex gap-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-green-600 text-white" : "bg-gray-200 text-gray-700"}`}>{s.done ? "✓" : i + 1}</span>
                <div>
                  <div className="font-medium">
                    {s.title} {s.done && <Badge tone="green">done</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{s.detail}</p>
                </div>
              </div>
              <Link href={s.href} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50">
                {s.cta}
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
