import Link from "next/link";

/** Server-rendered pagination: keeps every other query parameter. */
export function Pager({ path, params, page, perPage, total }: { path: string; params: Record<string, string | undefined>; page: number; perPage: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">{total} {total === 1 ? "row" : "rows"}</p>;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pagination">
      <span className="text-xs text-muted">
        {from}–{to} of {total}
      </span>
      <span className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded border border-line px-2 py-1 hover:bg-gray-50">
            ← Prev
          </Link>
        ) : (
          <span className="rounded border border-line px-2 py-1 text-muted opacity-50">← Prev</span>
        )}
        {nums.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            {i > 0 && n - nums[i - 1] > 1 && <span className="text-muted">…</span>}
            <Link href={href(n)} aria-current={n === page ? "page" : undefined} className={n === page ? "rounded bg-brand px-2 py-1 text-white" : "rounded border border-line px-2 py-1 hover:bg-gray-50"}>
              {n}
            </Link>
          </span>
        ))}
        {page < pages ? (
          <Link href={href(page + 1)} className="rounded border border-line px-2 py-1 hover:bg-gray-50">
            Next →
          </Link>
        ) : (
          <span className="rounded border border-line px-2 py-1 text-muted opacity-50">Next →</span>
        )}
      </span>
    </nav>
  );
}

export const pageNum = (v: string | undefined) => Math.max(1, Math.min(10_000, Number.parseInt(v ?? "1", 10) || 1));
