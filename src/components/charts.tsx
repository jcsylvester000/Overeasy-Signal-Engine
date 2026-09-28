/**
 * Lightweight server-rendered SVG charts (no client JS, no chart library): fast to load and print.
 * Hover titles give exact values.
 */
export const SERIES_COLORS: Record<string, string> = { google: "#2563eb", microsoft: "#0d9488", other: "#9ca3af", line: "#f59e0b" };
const colorOf = (k: string) => SERIES_COLORS[k] ?? SERIES_COLORS.other;
const nice = (max: number) => {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
};

export function Legend({ items }: { items: { key: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {items.map((i) => (
        <span key={i.key} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(i.key) }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Stacked bars (e.g. spend by platform) with an optional line on a second axis (e.g. clicks or leads). */
export function StackedBarLine({
  data,
  keys,
  line,
  formatBar,
  formatLine,
  height = 240,
}: {
  data: { label: string; segments: Record<string, number>; line?: number }[];
  keys: string[];
  line?: string;
  formatBar: (n: number) => string;
  formatLine?: (n: number) => string;
  height?: number;
}) {
  const W = 800;
  const H = height;
  const pad = { l: 56, r: line ? 48 : 12, t: 10, b: 34 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const totals = data.map((d) => keys.reduce((a, k) => a + (d.segments[k] ?? 0), 0));
  const maxBar = nice(Math.max(0, ...totals));
  const maxLine = nice(Math.max(0, ...data.map((d) => d.line ?? 0)));
  const step = data.length ? iw / data.length : iw;
  const bw = Math.max(2, Math.min(40, step * 0.7));
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No data for this period.</p>;
  const pts = data.map((d, i) => `${pad.l + step * i + step / 2},${pad.t + ih - ((d.line ?? 0) / maxLine) * ih}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Chart">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih - t * ih} y2={pad.t + ih - t * ih} stroke="#e5e7eb" />
          <text x={pad.l - 6} y={pad.t + ih - t * ih + 4} textAnchor="end" fontSize="11" fill="#6b7280">
            {formatBar(maxBar * t)}
          </text>
          {line && formatLine && (
            <text x={W - pad.r + 6} y={pad.t + ih - t * ih + 4} fontSize="11" fill="#b45309">
              {formatLine(maxLine * t)}
            </text>
          )}
        </g>
      ))}
      {data.map((d, i) => {
        let y = pad.t + ih;
        const x = pad.l + step * i + (step - bw) / 2;
        return (
          <g key={d.label + i}>
            {keys.map((k) => {
              const v = d.segments[k] ?? 0;
              const h = (v / maxBar) * ih;
              y -= h;
              return h > 0 ? (
                <rect key={k} x={x} y={y} width={bw} height={h} fill={colorOf(k)} rx={1}>
                  <title>{`${d.label} · ${k}: ${formatBar(v)}`}</title>
                </rect>
              ) : null;
            })}
            {i % labelEvery === 0 && (
              <text x={pad.l + step * i + step / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#6b7280">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      {line && (
        <>
          <polyline points={pts} fill="none" stroke={SERIES_COLORS.line} strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={i} cx={pad.l + step * i + step / 2} cy={pad.t + ih - ((d.line ?? 0) / maxLine) * ih} r={data.length > 40 ? 1.5 : 3} fill={SERIES_COLORS.line}>
              <title>{`${d.label} · ${line}: ${formatLine ? formatLine(d.line ?? 0) : d.line}`}</title>
            </circle>
          ))}
        </>
      )}
    </svg>
  );
}

/** Horizontal bars comparing items on one metric (optionally two, e.g. spend vs value). */
export function HBars({
  rows,
  format,
  secondLabel,
  formatSecond,
}: {
  rows: { label: string; value: number; second?: number; colorKey?: string; note?: string }[];
  format: (n: number) => string;
  secondLabel?: string;
  formatSecond?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.second ?? 0)));
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">No data.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="num shrink-0 text-muted">
              {format(r.value)}
              {r.second !== undefined && formatSecond && (
                <>
                  {" · "}
                  {secondLabel} {formatSecond(r.second)}
                </>
              )}
              {r.note && <span className="ml-1 text-xs">({r.note})</span>}
            </span>
          </div>
          <div className="h-2 rounded bg-gray-100">
            <div className="h-2 rounded" style={{ width: `${(r.value / max) * 100}%`, background: colorOf(r.colorKey ?? "google") }} />
          </div>
          {r.second !== undefined && (
            <div className="mt-0.5 h-2 rounded bg-gray-50">
              <div className="h-2 rounded" style={{ width: `${(r.second / max) * 100}%`, background: SERIES_COLORS.line }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
