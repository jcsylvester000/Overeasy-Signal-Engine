import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted">The page does not exist, or you do not have access to it.</p>
      <Link href="/app" className="text-sm text-brand hover:underline">
        Back to workspaces
      </Link>
    </main>
  );
}
