import "server-only";
import { admin } from "@/lib/supabase/admin";
import { ScoringModel } from "@/core/scoring/types";
import { ValueModel } from "@/core/value/types";

export type Published<T> = { id: string; version: number; model: T };

export async function publishedScoring(workspaceId: string): Promise<Published<ScoringModel> | null> {
  const { data } = await admin()
    .from("scoring_models")
    .select("id,version,model")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .maybeSingle<{ id: string; version: number; model: unknown }>();
  if (!data) return null;
  const parsed = ScoringModel.safeParse(data.model);
  return parsed.success ? { id: data.id, version: data.version, model: parsed.data } : null;
}

export async function publishedValue(workspaceId: string): Promise<Published<ValueModel> | null> {
  const { data } = await admin()
    .from("value_models")
    .select("id,version,model")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .maybeSingle<{ id: string; version: number; model: unknown }>();
  if (!data) return null;
  const parsed = ValueModel.safeParse(data.model);
  return parsed.success ? { id: data.id, version: data.version, model: parsed.data } : null;
}
