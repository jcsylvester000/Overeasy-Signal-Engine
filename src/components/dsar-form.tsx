"use client";

import { useActionState, useState } from "react";

type State = { json?: string; message?: string; error?: string } | null;

export function DsarForm({ action }: { action: (prev: State, fd: FormData) => Promise<State> }) {
  const [state, run, pending] = useActionState(action, null);
  const [kind, setKind] = useState("access");
  return (
    <form action={run} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Email or phone of the person</span>
          <input name="identifier" required className="w-72" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Request</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="access">Access / export</option>
            <option value="delete">Delete</option>
          </select>
        </label>
        {kind === "delete" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Type DELETE to confirm</span>
            <input name="confirm" className="w-32" autoComplete="off" />
          </label>
        )}
        <button disabled={pending} className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${kind === "delete" ? "bg-red-600" : "bg-brand"}`}>
          {pending ? "Working…" : kind === "delete" ? "Delete records" : "Find & export"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state?.message && <p className="text-sm text-green-800">{state.message}</p>}
      {state?.json && (
        <div>
          <a className="text-sm text-brand hover:underline" download="subject-access-export.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(state.json)}`}>
            Download export (JSON)
          </a>
          <pre className="mt-2 max-h-72 overflow-auto rounded bg-gray-50 p-2 text-[11px]">{state.json}</pre>
        </div>
      )}
    </form>
  );
}
