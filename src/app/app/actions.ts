"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { requireOrg, requireUser, requireWorkspace } from "@/lib/tenancy";
import { createDemoWorkspace } from "@/server/demo";

export async function createDemo(orgId: string) {
  const user = await requireUser();
  await requireOrg(orgId, 4);
  let wsId = "";
  try {
    wsId = (await createDemoWorkspace(orgId, user.id)).wsId;
  } catch (e) {
    redirect(`/app?error=${encodeURIComponent(`Demo setup failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
  redirect(`/w/${wsId}?welcome=demo`);
}

/** Only demo workspaces can be deleted from the UI. */
export async function deleteDemo(wsId: string) {
  const user = await requireUser();
  const { ws } = await requireWorkspace(wsId, 4);
  if (!(ws.settings as { demo?: boolean }).demo) redirect(`/w/${wsId}?denied=1`);
  await admin().from("workspaces").delete().eq("id", ws.id);
  await audit({ orgId: ws.org_id, actorId: user.id, action: "demo.delete", entity: "workspace", entityId: ws.id });
  revalidatePath("/app");
  redirect("/app");
}
