import "server-only";
import { admin } from "@/lib/supabase/admin";

/** Immutable audit trail of configuration changes and user actions (HLT-04). Never include secrets or PII. */
export async function audit(entry: {
  orgId?: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  diff?: unknown;
}) {
  const { error } = await admin()
    .from("audit_log")
    .insert({
      org_id: entry.orgId ?? null,
      workspace_id: entry.workspaceId ?? null,
      actor_id: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      diff: entry.diff ?? null,
    });
  if (error) console.error("[audit] failed", entry.action, error.message);
}
