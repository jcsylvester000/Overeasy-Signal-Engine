import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { brandForHost } from "@/lib/brand";
import { userClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/tenancy";
import { TopBar } from "@/components/topbar";
import { Button, Card, Field, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Account" };

async function setPassword(fd: FormData) {
  "use server";
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 12) redirect("/app/account?error=Use%20at%20least%2012%20characters");
  if (pw !== String(fd.get("confirm") ?? "")) redirect("/app/account?error=Passwords%20do%20not%20match");
  const sb = await userClient();
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) redirect(`/app/account?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/app/account");
  redirect("/app/account?ok=1");
}

export default async function Account({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const { brand } = await brandForHost();
  return (
    <>
      <TopBar brand={brand} email={user.email} />
      <main className="mx-auto max-w-lg px-4 py-8">
        <PageHeader title="Account" description={user.email ?? ""} />
        <Card title="Set a password" description="Invited users sign in with the email link first, then set a password here.">
          {sp.ok && <Notice tone="green">Password updated.</Notice>}
          {sp.error && <Notice tone="red">{sp.error}</Notice>}
          <form action={setPassword} className="mt-3 space-y-3">
            <Field label="New password" hint="At least 12 characters.">
              <input name="password" type="password" autoComplete="new-password" required minLength={12} />
            </Field>
            <Field label="Confirm password">
              <input name="confirm" type="password" autoComplete="new-password" required />
            </Field>
            <Button>Save password</Button>
          </form>
        </Card>
      </main>
    </>
  );
}
