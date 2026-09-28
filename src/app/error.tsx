"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted">The page could not be loaded. Try again; if it keeps happening, share this reference with support: {error.digest ?? "n/a"}</p>
      <button onClick={reset} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white">
        Try again
      </button>
    </main>
  );
}
