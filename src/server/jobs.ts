import "server-only";
import type { OseEventName, OseEvents } from "./dispatch";
import { syncLeadToCrm, writeBack } from "./crm";
import { planAndEnqueue } from "./signals";
import { deliverPending } from "./delivery";
import { processInbox } from "./webhooks";
import { deliverOutbound } from "./outbound";

/** Single source of truth for background work; used inline and by the Inngest functions. */
export const handlers: { [N in OseEventName]: (data: OseEvents[N]) => Promise<unknown> } = {
  "ose/lead.created": async ({ workspaceId, leadId }) => {
    await syncLeadToCrm(workspaceId, leadId).catch((e) => console.error("[crm sync]", e));
    await planAndEnqueue(workspaceId, leadId);
  },
  "ose/stage.recorded": async ({ workspaceId, leadId }) => {
    const decisions = await planAndEnqueue(workspaceId, leadId);
    if (!decisions.some((d) => d.status === "enqueue")) await writeBack(workspaceId, leadId).catch(() => {});
  },
  "ose/signals.deliver": async ({ workspaceId }) => deliverPending(workspaceId),
  "ose/webhook.received": async ({ inboxId }) => processInbox(inboxId),
  "ose/webhooks.deliver": async ({ workspaceId }) => deliverOutbound(workspaceId),
};
