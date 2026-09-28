import { redirect } from "next/navigation";

/** Moved: the wizard now lives at /app/workspaces/new (with an organization picker). */
export default async function OldNewWorkspace({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/app/workspaces/new?org=${org}&from=org`);
}
