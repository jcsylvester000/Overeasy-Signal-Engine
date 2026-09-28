import Link from "next/link";
import clsx from "clsx";

export function cn(...a: Parameters<typeof clsx>) {
  return clsx(...a);
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, children, className, actions }: { title?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel p-4 shadow-sm", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const btn = {
  primary: "bg-brand text-white hover:opacity-90",
  secondary: "border border-line bg-white text-ink hover:bg-gray-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-brand hover:underline",
};

export function Button({ variant = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof btn }) {
  return <button {...p} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50", btn[variant], className)} />;
}

export function LinkButton({ href, variant = "secondary", children, className }: { href: string; variant?: keyof typeof btn; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", btn[variant], className)}>
      {children}
    </Link>
  );
}

const tones = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  purple: "bg-purple-100 text-purple-800",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  sent: "green",
  ok: "green",
  dry_run: "blue",
  test: "purple",
  pending: "amber",
  sending: "amber",
  blocked_window: "gray",
  no_click_id: "gray",
  skipped: "gray",
  no_destination: "red",
  failed: "red",
  dead: "red",
  error: "red",
  expired: "red",
  open: "amber",
  acknowledged: "blue",
  resolved: "green",
  critical: "red",
  warning: "amber",
  info: "blue",
};

export function Status({ value }: { value: string }) {
  return <Badge tone={STATUS_TONE[value] ?? "gray"}>{value.replace(/_/g, " ")}</Badge>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-2 py-6 text-center text-sm text-muted">
                {empty ?? "Nothing yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, mono }: { children?: React.ReactNode; className?: string; mono?: boolean }) {
  return <td className={cn("px-2 py-2 align-top", mono && "font-mono text-xs", className)}>{children}</td>;
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "amber" | "red" | "green"; children: React.ReactNode }) {
  const c = { blue: "border-blue-200 bg-blue-50 text-blue-900", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", green: "border-green-200 bg-green-50 text-green-900" }[tone];
  return <div className={cn("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function money(n: number | string | null | undefined, currency = "USD") {
  if (n === null || n === undefined || n === "") return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: Number(n) >= 1000 ? 0 : 2 }).format(Number(n));
}

export function when(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

export function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-brand">view</summary>
      <pre className="mt-1 max-h-72 max-w-xl overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-snug">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
