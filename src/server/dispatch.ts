import "server-only";
import { after } from "next/server";
import { env } from "@/lib/env";

export type OseEvents = {
  "ose/lead.created": { workspaceId: string; leadId: string };
  "ose/stage.recorded": { workspaceId: string; leadId: string; stage: string };
  "ose/signals.deliver": { workspaceId?: string };
  "ose/webhook.received": { inboxId: string };
  "ose/webhooks.deliver": { workspaceId?: string };
};
export type OseEventName = keyof OseEvents;

/**
 * Emit a background event. With Inngest configured, it becomes a durable job (retries, backoff,
 * concurrency per connection). Without it (e.g. early staging), the same handler runs in-process
 * right after the response is sent, so nothing waits on the request and nothing is lost from the DB.
 */
export async function dispatch<N extends OseEventName>(name: N, data: OseEvents[N]): Promise<void> {
  if (env.inngestEnabled()) {
    const { inngest } = await import("@/inngest/client");
    await inngest.send({ name, data });
    return;
  }
  const run = async () => {
    try {
      const { handlers } = await import("./jobs");
      await handlers[name](data as never);
    } catch (e) {
      console.error(`[dispatch:inline] ${name} failed`, e);
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts/tests): run now.
    await run();
  }
}
