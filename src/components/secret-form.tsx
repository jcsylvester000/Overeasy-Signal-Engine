"use client";

import { useActionState } from "react";

type State = { secret?: string; error?: string } | null;

/** Runs a server action that returns a secret exactly once and shows it without putting it in a URL. */
export function SecretForm({ action, button, children, note }: { action: (prev: State, fd: FormData) => Promise<State>; button: string; children?: React.ReactNode; note: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-3">
      {children}
      <button disabled={pending} className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Working…" : button}
      </button>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state?.secret && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium">{note}</p>
          <code className="block break-all rounded bg-white p-2 font-mono text-xs">{state.secret}</code>
        </div>
      )}
    </form>
  );
}
