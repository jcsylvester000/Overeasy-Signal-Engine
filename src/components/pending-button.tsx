"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows progress while a slow server action runs. */
export function PendingButton({ children, pendingText, className }: { children: React.ReactNode; pendingText: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={`inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 ${className ?? ""}`}>
      {pending ? pendingText : children}
    </button>
  );
}
