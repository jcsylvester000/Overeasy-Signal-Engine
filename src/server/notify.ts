import "server-only";
import { admin } from "@/lib/supabase/admin";
import { brandForOrg } from "@/lib/brand";
import { env } from "@/lib/env";
import { rungIndex } from "@/core/stages";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** White-label email via Resend (partner sender domain from the org brand). No-op without RESEND_API_KEY. */
export async function sendEmail(args: { to: string[]; subject: string; html: string; from: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !args.to.length) return { sent: false, reason: key ? "no recipients" : "RESEND_API_KEY not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: args.from, to: args.to, subject: args.subject, html: args.html }),
  });
  return { sent: res.ok, reason: res.ok ? undefined : `Resend ${res.status}` };
}

/** RPT-06: weekly summary per workspace to settings.reportRecipients, branded as the workspace's organization. */
export async function weeklyReports(onlyWorkspaceId?: string) {
  const db = admin();
  let q = db.from("workspaces").select("id,org_id,name,currency,settings");
  if (onlyWorkspaceId) q = q.eq("id", onlyWorkspaceId);
  const { data: wss } = await q;
  const results: { workspace: string; sent: boolean; reason?: string }[] = [];
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  for (const ws of wss ?? []) {
    const recipients = String((ws.settings as { reportRecipients?: string })?.reportRecipients ?? "")
      .split(/[\s,;]+/)
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .slice(0, 20);
    if (!recipients.length) continue;
    const { data: leads } = await db.from("leads").select("id,value_current").eq("workspace_id", ws.id).eq("is_test", false).gte("created_at", since);
    const { data: ev } = await db.from("stage_events").select("canonical_stage").eq("workspace_id", ws.id).gte("occurred_at", since);
    const { data: jobs } = await db.from("signal_jobs").select("status,value_increment").eq("workspace_id", ws.id).gte("created_at", since);
    const { data: spend } = await db.from("ad_spend_daily").select("cost").eq("workspace_id", ws.id).gte("date", since.slice(0, 10));
    const count = (s: string) => (ev ?? []).filter((e) => rungIndex(e.canonical_stage) === rungIndex(s)).length;
    const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: ws.currency, maximumFractionDigits: 0 }).format(n);
    const sent = (jobs ?? []).filter((j) => j.status === "sent");
    const failed = (jobs ?? []).filter((j) => ["dead", "failed"].includes(j.status)).length;
    const brand = await brandForOrg(ws.org_id);
    const rows: [string, string][] = [
      ["Ad spend", money((spend ?? []).reduce((a, r) => a + Number(r.cost), 0))],
      ["New leads", String((leads ?? []).length)],
      ["Qualified", String(count("qualified"))],
      ["Contracts", String(count("contract"))],
      ["Funded", String(count("funded"))],
      ["Signals accepted by ad platforms", `${sent.length} (${money(sent.reduce((a, j) => a + Number(j.value_increment), 0))})`],
      ["Failed uploads", String(failed)],
    ];
    const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
<h2 style="color:${esc(brand.primary)}">${esc(brand.appName)} — weekly summary</h2>
<p>${esc(ws.name)}, last 7 days</p>
<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${esc(k)}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:right"><b>${esc(v)}</b></td></tr>`).join("")}</table>
<p><a href="${esc(env.appUrl())}/w/${ws.id}">Open the dashboard</a></p></div>`;
    const from = brand.emailFrom ? `${brand.appName} <${brand.emailFrom}>` : process.env.REPORT_FROM || "";
    if (!from) {
      results.push({ workspace: ws.id, sent: false, reason: "No sender: set the organization's email sender or REPORT_FROM" });
      continue;
    }
    const r = await sendEmail({ to: recipients, subject: `${brand.appName}: ${ws.name} weekly summary`, html, from });
    results.push({ workspace: ws.id, ...r });
  }
  return results;
}
