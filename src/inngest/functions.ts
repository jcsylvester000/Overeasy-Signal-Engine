import "server-only";
import { inngest } from "./client";
import { handlers } from "@/server/jobs";
import { deliverPending } from "@/server/delivery";
import { healthSweep, retentionSweep } from "@/server/health";
import type { OseEvents } from "@/server/dispatch";

/** Durable jobs: retries with backoff; concurrency keyed per workspace so one client can't starve others. */
const leadCreated = inngest.createFunction(
  { id: "lead-created", retries: 5, concurrency: { key: "event.data.workspaceId", limit: 5 }, triggers: [{ event: "ose/lead.created" }] },
  async ({ event, step }) => step.run("sync-and-value", () => handlers["ose/lead.created"](event.data as OseEvents["ose/lead.created"])),
);

const stageRecorded = inngest.createFunction(
  { id: "stage-recorded", retries: 5, concurrency: { key: "event.data.leadId", limit: 1 }, triggers: [{ event: "ose/stage.recorded" }] },
  async ({ event, step }) => step.run("value", () => handlers["ose/stage.recorded"](event.data as OseEvents["ose/stage.recorded"])),
);

const deliver = inngest.createFunction(
  { id: "deliver-signals", retries: 3, concurrency: { limit: 1 }, triggers: [{ event: "ose/signals.deliver" }] },
  async ({ event, step }) => step.run("deliver", () => handlers["ose/signals.deliver"](event.data as OseEvents["ose/signals.deliver"])),
);

const webhook = inngest.createFunction(
  { id: "process-webhook", retries: 8, concurrency: { limit: 10 }, triggers: [{ event: "ose/webhook.received" }] },
  async ({ event, step }) => step.run("process", () => handlers["ose/webhook.received"](event.data as OseEvents["ose/webhook.received"])),
);

const retrySweep = inngest.createFunction(
  { id: "retry-sweep", concurrency: { limit: 1 }, triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => step.run("deliver-due", () => deliverPending()),
);

const health = inngest.createFunction({ id: "health-sweep", triggers: [{ cron: "0 * * * *" }] }, async ({ step }) => step.run("health", () => healthSweep()));

const retention = inngest.createFunction({ id: "retention-sweep", triggers: [{ cron: "30 3 * * *" }] }, async ({ step }) => step.run("purge", () => retentionSweep()));

export const functions = [leadCreated, stageRecorded, deliver, webhook, retrySweep, health, retention];
