import "server-only";
import { admin } from "@/lib/supabase/admin";
import { hashEmail, hashPhone } from "@/core/hash";
import { isCanonicalStage } from "@/core/stages";
import { mapCrmStage, recordStage } from "./lifecycle";
import { raiseAlert } from "./alerts";

type GhlPayload = {
  type?: string;
  locationId?: string;
  id?: string;
  contactId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageName?: string;
  status?: string;
  monetaryValue?: number;
  email?: string;
  phone?: string;
  dateAdded?: string;
  timestamp?: string;
};

async function workspaceForLocation(locationId: string): Promise<string | null> {
  const { data } = await admin().from("connections").select("workspace_id").eq("provider", "ghl").eq("external_account", locationId).limit(1).maybeSingle();
  return (data?.workspace_id as string) ?? null;
}

async function findLead(workspaceId: string, provider: string, p: { opportunityId?: string; contactId?: string; email?: string; phone?: string; leadId?: string; externalRef?: string }) {
  const db = admin();
  if (p.leadId) {
    const { data } = await db.from("leads").select("id").eq("workspace_id", workspaceId).eq("id", p.leadId).maybeSingle();
    if (data) return data.id as string;
  }
  if (p.opportunityId) {
    const { data } = await db.from("crm_links").select("lead_id").eq("workspace_id", workspaceId).eq("provider", provider).eq("opportunity_id", p.opportunityId).maybeSingle();
    if (data) return data.lead_id as string;
  }
  if (p.contactId) {
    const { data } = await db.from("crm_links").select("lead_id").eq("workspace_id", workspaceId).eq("provider", provider).eq("contact_id", p.contactId).limit(1).maybeSingle();
    if (data) return data.lead_id as string;
  }
  if (p.externalRef) {
    const { data } = await db.from("leads").select("id").eq("workspace_id", workspaceId).eq("external_ref", p.externalRef).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data.id as string;
  }
  const eh = hashEmail(p.email);
  const ph = hashPhone(p.phone);
  for (const [col, h] of [["email_sha256", eh], ["phone_sha256", ph]] as const) {
    if (!h) continue;
    const { data } = await db.from("leads").select("id").eq("workspace_id", workspaceId).eq(col, h).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

async function link(workspaceId: string, provider: string, leadId: string, contactId?: string, opportunityId?: string) {
  const db = admin();
  if (opportunityId) {
    await db.from("crm_links").upsert({ workspace_id: workspaceId, lead_id: leadId, provider, contact_id: null, opportunity_id: opportunityId }, { onConflict: "workspace_id,provider,opportunity_id", ignoreDuplicates: true });
  }
  if (contactId) {
    await db.from("crm_links").upsert({ workspace_id: workspaceId, lead_id: leadId, provider, contact_id: contactId }, { onConflict: "workspace_id,provider,contact_id", ignoreDuplicates: true });
  }
}

/** Process one stored webhook (spec §12 step 4, after the fast 200 ack). */
export async function processInbox(inboxId: string) {
  const db = admin();
  const { data: row } = await db.from("webhook_inbox").select("*").eq("id", inboxId).maybeSingle();
  if (!row || row.processed_at || !row.signature_ok) return;
  try {
    let workspaceId = row.workspace_id as string | null;
    if (row.provider === "ghl") workspaceId = await processGhl(row.payload as GhlPayload);
    else if (row.provider === "generic" && workspaceId) await processGeneric(workspaceId, row.payload as GenericPayload);
    await db.from("webhook_inbox").update({ processed_at: new Date().toISOString(), error: null, workspace_id: workspaceId }).eq("id", inboxId);
  } catch (e) {
    await db.from("webhook_inbox").update({ error: String(e).slice(0, 500) }).eq("id", inboxId);
    throw e;
  }
}

async function processGhl(p: GhlPayload): Promise<string | null> {
  if (!p.locationId) return null;
  const workspaceId = await workspaceForLocation(p.locationId);
  if (!workspaceId) return null;
  await handleGhl(workspaceId, p);
  return workspaceId;
}

async function handleGhl(workspaceId: string, p: GhlPayload) {
  switch (p.type) {
    case "ContactCreate":
    case "ContactUpdate": {
      const leadId = await findLead(workspaceId, "ghl", { contactId: p.id, email: p.email, phone: p.phone });
      if (leadId && p.id) await link(workspaceId, "ghl", leadId, p.id);
      return;
    }
    case "OpportunityCreate":
    case "OpportunityStageUpdate": {
      const leadId = await findLead(workspaceId, "ghl", { opportunityId: p.id, contactId: p.contactId });
      if (!leadId) {
        await raiseAlert(workspaceId, { type: "unlinked_opportunity", severity: "info", title: "CRM opportunity could not be linked to a lead", detail: { opportunityId: p.id }, dedupeKey: `unlinked:${p.id}` });
        return;
      }
      await link(workspaceId, "ghl", leadId, p.contactId, p.id);
      if (!p.pipelineId || !p.pipelineStageId) return;
      const stage = await mapCrmStage(workspaceId, "ghl", p.pipelineId, p.pipelineStageId, p.pipelineStageName);
      if (stage === "ignore") return;
      await recordStage({ workspaceId, leadId, stage, source: "ghl", crmStageId: p.pipelineStageId, occurredAt: p.timestamp ?? p.dateAdded ?? null, actualValue: stage === "funded" && typeof p.monetaryValue === "number" ? p.monetaryValue : null });
      return;
    }
    case "OpportunityStatusUpdate": {
      if (p.status !== "lost") return;
      const leadId = await findLead(workspaceId, "ghl", { opportunityId: p.id, contactId: p.contactId });
      if (leadId) await recordStage({ workspaceId, leadId, stage: "lost", source: "ghl", lostReason: "lost in CRM" });
      return;
    }
  }
}

export type GenericPayload = {
  event_id: string;
  lead_id?: string;
  external_ref?: string;
  email?: string;
  phone?: string;
  contact_id?: string;
  stage?: string;
  pipeline_id?: string;
  stage_id?: string;
  stage_name?: string;
  occurred_at?: string;
  actual_value?: number;
  lost_reason?: string;
};

async function processGeneric(workspaceId: string, p: GenericPayload) {
  const leadId = await findLead(workspaceId, "generic", { leadId: p.lead_id, contactId: p.contact_id, externalRef: p.external_ref, email: p.email, phone: p.phone });
  if (!leadId) {
    await raiseAlert(workspaceId, { type: "unlinked_opportunity", severity: "info", title: "Generic CRM event could not be linked to a lead", detail: { eventId: p.event_id }, dedupeKey: `unlinked:${p.event_id}` });
    return;
  }
  if (p.contact_id) await link(workspaceId, "generic", leadId, p.contact_id);
  let stage: string | null = p.stage && isCanonicalStage(p.stage) ? p.stage : null;
  if (!stage && p.pipeline_id && p.stage_id) {
    const mapped = await mapCrmStage(workspaceId, "generic", p.pipeline_id, p.stage_id, p.stage_name);
    stage = mapped === "ignore" ? null : mapped;
  }
  if (!stage) return;
  await recordStage({ workspaceId, leadId, stage, source: "generic", occurredAt: p.occurred_at ?? null, actualValue: p.actual_value ?? null, lostReason: p.lost_reason ?? null, crmStageId: p.stage_id ?? null });
}
