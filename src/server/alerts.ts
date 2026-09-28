import "server-only";
import { admin } from "@/lib/supabase/admin";
import { emitEvent } from "./outbound";

export type AlertInput = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: Record<string, unknown>;
  dedupeKey?: string;
};

/** Open an alert once per dedupe key (until resolved). Email/Slack fan-out hooks in here (HLT-03). */
export async function raiseAlert(workspaceId: string, a: AlertInput) {
  const { error } = await admin()
    .from("alerts")
    .insert({ workspace_id: workspaceId, type: a.type, severity: a.severity, title: a.title, detail: a.detail ?? {}, dedupe_key: a.dedupeKey ?? null });
  if (error && !/duplicate key/i.test(error.message)) console.error("[alert]", error.message);
  if (!error && a.severity !== "info") {
    await notify(workspaceId, a);
    const { notifyWorkspaceTeam } = await import("./team");
    await notifyWorkspaceTeam(workspaceId, { kind: "alert", title: `[${a.severity}] ${a.title}`, link: `/w/${workspaceId}/health`, dedupeKey: `alert:${workspaceId}:${a.dedupeKey ?? a.title}` });
  }
  if (!error) await emitEvent(workspaceId, "alert.raised", { type: a.type, severity: a.severity, title: a.title });
}

async function notify(workspaceId: string, a: AlertInput) {
  const { data } = await admin().from("workspaces").select("settings").eq("id", workspaceId).maybeSingle<{ settings: { slackWebhookUrl?: string } }>();
  const url = data?.settings?.slackWebhookUrl;
  if (url && /^https:\/\/hooks\.slack\.com\//.test(url)) {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `[${a.severity}] ${a.title}` }) }).catch(() => {});
  }
}

export async function resolveAlerts(workspaceId: string, dedupeKeyPrefix: string) {
  await admin()
    .from("alerts")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .like("dedupe_key", `${dedupeKeyPrefix}%`)
    .neq("status", "resolved");
}
