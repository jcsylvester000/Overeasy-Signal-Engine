import { admin } from "@/lib/supabase/admin";
import { requireUser, workspaceAccess } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { STAGE_LABEL } from "@/core/stages";
import { googleOfflineCsv, microsoftOfflineCsv, type OfflineRow } from "@/core/offline-csv";

export const dynamic = "force-dynamic";

/**
 * POST /w/{ws}/offline/{google|microsoft} — download an offline-conversion upload file for the platform's own upload
 * screen (manual bridge until API approval). Includes value increments not yet delivered by API (dry run) and, by
 * default, not yet exported. Optionally marks them exported so the next file only has new rows.
 */
export async function POST(req: Request, ctx: { params: Promise<{ ws: string; platform: string }> }) {
  const { ws: wsId, platform } = await ctx.params;
  if (platform !== "google" && platform !== "microsoft") return new Response("Not found", { status: 404 });
  const user = await requireUser();
  const { ws, rank } = await workspaceAccess(wsId);
  if (rank < 3) return new Response("Forbidden", { status: 403 });
  const fd = await req.formData();
  const prefix = String(fd.get("prefix") ?? ws.name).trim().slice(0, 60) || ws.name;
  const includeExported = Boolean(fd.get("include_exported"));
  const mark = Boolean(fd.get("mark"));
  const days = Math.min(90, Math.max(1, Number(fd.get("days") ?? 90)));

  const db = admin();
  let q = db
    .from("signal_jobs")
    .select("id,lead_id,canonical_stage,transaction_id,value_increment,currency,created_at")
    .eq("workspace_id", ws.id)
    .eq("platform", platform)
    .eq("status", "dry_run")
    .gt("value_increment", 0)
    .gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .order("created_at")
    .limit(20000);
  if (!includeExported) q = q.is("exported_at", null);
  const { data: jobs, error } = await q;
  if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });

  const leadIds = [...new Set((jobs ?? []).map((j) => j.lead_id as string))];
  const attr = new Map<string, Record<string, string>>();
  for (let i = 0; i < leadIds.length; i += 500) {
    const { data: leads } = await db.from("leads").select("id,attribution,consent").in("id", leadIds.slice(i, i + 500));
    for (const l of leads ?? []) {
      const c = (l.consent ?? {}) as { gpc?: boolean };
      if (c.gpc) continue; // opted out: never exported
      attr.set(l.id as string, (l.attribution ?? {}) as Record<string, string>);
    }
  }
  const rows: OfflineRow[] = (jobs ?? [])
    .filter((j) => attr.has(j.lead_id as string))
    .map((j) => {
      const a = attr.get(j.lead_id as string)!;
      return {
        transactionId: j.transaction_id as string,
        stageName: `${prefix} – ${STAGE_LABEL[j.canonical_stage as keyof typeof STAGE_LABEL] ?? j.canonical_stage}`,
        time: new Date(j.created_at as string),
        value: Number(j.value_increment),
        currency: j.currency as string,
        gclid: a.gclid,
        gbraid: a.gbraid,
        wbraid: a.wbraid,
        msclkid: a.msclkid,
      };
    });
  const out = platform === "google" ? googleOfflineCsv(rows) : microsoftOfflineCsv(rows);

  if (mark && jobs?.length) {
    const ids = jobs.map((j) => j.id as string);
    for (let i = 0; i < ids.length; i += 500) await db.from("signal_jobs").update({ exported_at: new Date().toISOString() }).in("id", ids.slice(i, i + 500));
  }
  await audit({ orgId: ws.org_id, workspaceId: ws.id, actorId: user.id, action: `offline_export.${platform}`, entity: "signal_jobs", diff: { rows: out.count, skipped: out.skipped, marked: mark } });
  return new Response(out.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ws.slug}-${platform}-offline-conversions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
