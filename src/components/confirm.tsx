"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "./ui";

function Go({ label, tone, disabled }: { label: string; tone: "danger" | "primary"; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={disabled || pending} className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50", tone === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-brand hover:opacity-90")}>
      {pending ? "Working…" : label}
    </button>
  );
}

/**
 * A button that asks for confirmation in a dialog before running a server action.
 * requireText: the user must type this exact text (e.g. the workspace name) to enable the action.
 */
export function ConfirmAction({
  action,
  trigger,
  title,
  message,
  confirmLabel = "Confirm",
  requireText,
  tone = "danger",
  triggerClassName,
  hidden,
}: {
  action: (fd: FormData) => void | Promise<void>;
  trigger: React.ReactNode;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  requireText?: string;
  tone?: "danger" | "primary";
  triggerClassName?: string;
  hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const ok = !requireText || typed.trim() === requireText.trim();
  return (
    <>
      <button type="button" className={triggerClassName ?? "text-xs text-red-700 hover:underline"} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog ref={ref} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line p-0 shadow-xl backdrop:bg-black/40" onClose={() => setTyped("")}>
        <form action={action} className="space-y-3 p-5">
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="text-sm text-muted">{message}</div>
          {requireText && (
            <label className="block text-sm">
              Type <b className="font-mono">{requireText}</b> to confirm
              <input name="confirm_text" value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full" autoComplete="off" />
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <Go label={confirmLabel} tone={tone} disabled={!ok} />
          </div>
        </form>
      </dialog>
    </>
  );
}

/** A dialog with an arbitrary form (edit forms). */
export function FormDialog({ trigger, title, action, children, submitLabel = "Save", triggerClassName }: { trigger: React.ReactNode; title: string; action: (fd: FormData) => void | Promise<void>; children: React.ReactNode; submitLabel?: string; triggerClassName?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={triggerClassName ?? "text-xs text-muted hover:text-ink hover:underline"} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog ref={ref} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line p-0 shadow-xl backdrop:bg-black/40">
        <form action={action} className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          {children}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <Go label={submitLabel} tone="primary" disabled={false} />
          </div>
        </form>
      </dialog>
    </>
  );
}

/** datetime-local input that submits an ISO timestamp in the user's own timezone. */
export function LocalDateTime({ name, defaultValue, className }: { name: string; defaultValue?: string | null; className?: string }) {
  const toLocal = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  // Server render has no browser timezone: show the default only once mounted, so the value is local time.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [edited, setEdited] = useState<string | null>(null);
  const v = edited ?? (mounted ? toLocal(defaultValue) : "");
  const iso = v ? new Date(v).toISOString() : (defaultValue ?? "");
  return (
    <>
      <input type="datetime-local" value={v} onChange={(e) => setEdited(e.target.value)} className={className} />
      <input type="hidden" name={name} value={edited === "" ? "" : iso} />
    </>
  );
}
