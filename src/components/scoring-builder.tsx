"use client";

import { useMemo, useState } from "react";
import type { Answers, Condition, FieldDef, LeadTypeRule, ScoringModel, TestCase, VelocityBand } from "@/core/scoring/types";
import { evaluate, runTests, validateForPublish, type TestOutcome } from "@/core/scoring/evaluate";
import { Badge, Button, Card, Field, Notice, cn } from "@/components/ui";

/* ------------------------------------------------------------------ state ------------------------------------------------------------------ */

type EField = FieldDef & { _id: number; _auto?: boolean };
type ELead = LeadTypeRule & { _id: number };
type ETest = TestCase & { _id: number };
type Draft = Omit<ScoringModel, "fields" | "leadTypes" | "tests"> & { fields: EField[]; leadTypes: ELead[]; tests: ETest[]; seq: number };
type Edit = (fn: (d: Draft) => void) => void;

const VELOCITIES: VelocityBand[] = ["fast", "normal", "slow"];
const KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;
const SENSITIVE_HELP = "Health, criminal, family or financial-hardship data: used for scoring only, stored masked";

function fromModel(input: ScoringModel): Draft {
  const m = structuredClone(input);
  let seq = 0;
  return {
    ...m,
    fields: m.fields.map((f) => ({ ...f, _id: ++seq })),
    leadTypes: m.leadTypes.map((l) => ({ ...l, _id: ++seq })),
    tests: m.tests.map((t) => ({ ...t, _id: ++seq })),
    seq,
  };
}

function toModel(d: Draft): ScoringModel {
  return {
    name: d.name,
    currency: d.currency,
    base: d.base,
    clamp: d.clamp,
    fields: d.fields.map((f) => {
      const out: FieldDef = { key: f.key, label: f.label, type: f.type };
      if (f.type === "select") out.options = f.options ?? [];
      if (f.required) out.required = true;
      if (f.sensitive) out.sensitive = true;
      return out;
    }),
    rules: d.rules,
    leadTypes: d.leadTypes.map((l) => (l.velocity ? { type: l.type, velocity: l.velocity, when: l.when } : { type: l.type, when: l.when })),
    defaultLeadType: d.defaultLeadType,
    defaultVelocity: d.defaultVelocity,
    tests: d.tests.map((t) => {
      const out: TestCase = { name: t.name, answers: t.answers, expect: t.expect };
      if (t.expectType) out.expectType = t.expectType;
      if (t.note) out.note = t.note;
      return out;
    }),
  };
}

function slugify(label: string): string {
  let s = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "question";
  if (!/^[a-z]/.test(s)) s = `q_${s}`;
  return s.slice(0, 48).replace(/_+$/, "");
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const k = base.slice(0, 48 - suffix.length) + suffix;
    if (!taken.has(k)) return k;
  }
}

function move<T>(arr: T[], i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function walkCond(c: Condition, fn: (c: Condition) => void) {
  fn(c);
  c.all?.forEach((x) => walkCond(x, fn));
  c.any?.forEach((x) => walkCond(x, fn));
  if (c.not) walkCond(c.not, fn);
}

/** Rename a field key everywhere it is referenced: rules, lead-type conditions and test answers. */
function renameKey(d: Draft, from: string, to: string) {
  for (const f of d.fields) if (f.key === from) f.key = to;
  for (const r of d.rules) if (r.field === from) r.field = to;
  for (const l of d.leadTypes) walkCond(l.when, (c) => { if (c.field === from) c.field = to; });
  for (const t of d.tests) {
    if (from in t.answers) {
      t.answers[to] = t.answers[from];
      delete t.answers[from];
    }
  }
}

/** Rename an option value of a select field everywhere it is referenced. */
function renameOption(d: Draft, field: string, from: string, to: string) {
  for (const r of d.rules) {
    if (r.field === field && r.kind === "map" && from in r.map) {
      r.map[to] = r.map[from];
      delete r.map[from];
    }
  }
  for (const l of d.leadTypes) walkCond(l.when, (c) => { if (c.field === field && c.in) c.in = c.in.map((v) => (v === from ? to : v)); });
  for (const t of d.tests) if (String(t.answers[field] ?? "") === from) t.answers[field] = to;
}

/* ------------------------------------------------------------ simple conditions ------------------------------------------------------------ */

type Row = { k: "in"; field: string; values: string[] } | { k: "gte" | "lte"; field: string; n: number } | { k: "score_gte" | "score_lte"; n: number };
type Simple = { mode: "all" | "any"; rows: Row[] };

function leafToRow(c: Condition): Row | null {
  const rec = c as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort().join(",");
  if (keys === "field,in" && c.field && c.in) return { k: "in", field: c.field, values: c.in };
  if (keys === "field,gte" && c.field && c.gte !== undefined) return { k: "gte", field: c.field, n: c.gte };
  if (keys === "field,lte" && c.field && c.lte !== undefined) return { k: "lte", field: c.field, n: c.lte };
  if (keys === "score_gte" && c.score_gte !== undefined) return { k: "score_gte", n: c.score_gte };
  if (keys === "score_lte" && c.score_lte !== undefined) return { k: "score_lte", n: c.score_lte };
  return null;
}

function parseSimple(c: Condition): Simple | null {
  const rec = c as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
  if (keys.length === 0) return { mode: "all", rows: [] };
  if (keys.length === 1 && (keys[0] === "all" || keys[0] === "any")) {
    const mode = keys[0];
    const rows = (c[mode] ?? []).map(leafToRow);
    return rows.every((r): r is Row => r !== null) ? { mode, rows } : null;
  }
  const row = leafToRow(c);
  return row ? { mode: "all", rows: [row] } : null;
}

function rowToLeaf(r: Row): Condition {
  switch (r.k) {
    case "in": return { field: r.field, in: r.values };
    case "gte": return { field: r.field, gte: r.n };
    case "lte": return { field: r.field, lte: r.n };
    case "score_gte": return { score_gte: r.n };
    case "score_lte": return { score_lte: r.n };
  }
}

const buildCond = (s: Simple): Condition => (s.mode === "all" ? { all: s.rows.map(rowToLeaf) } : { any: s.rows.map(rowToLeaf) });

function fieldsIn(c: Condition): string[] {
  const out: string[] = [];
  walkCond(c, (x) => { if (x.field) out.push(x.field); });
  return out;
}

/* ---------------------------------------------------------------- inputs ---------------------------------------------------------------- */

const smallBtn = "rounded border border-line bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40";

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={smallBtn}>
      {children}
    </button>
  );
}

/** Number input that tolerates partial typing ("-", "1.") and reports null for empty. */
function NumInput({ value, onChange, label, placeholder, className }: { value: number | null | undefined; onChange: (n: number | null) => void; label: string; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      aria-label={label}
      placeholder={placeholder}
      className={cn("w-20 text-right", className)}
      value={draft ?? (value === null || value === undefined ? "" : String(value))}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        const t = v.trim();
        if (t === "") onChange(null);
        else if (Number.isFinite(Number(t))) onChange(Number(t));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** Text input that commits on blur/Enter; onCommit returns an error message to reject the value. */
function DraftText({ value, onCommit, label, className }: { value: string; onCommit: (v: string) => string | null; label: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim();
    const e = v === value ? null : onCommit(v);
    setErr(e);
    if (!e) setDraft(null);
  };
  return (
    <span className="flex flex-col gap-0.5">
      <input
        aria-label={label}
        aria-invalid={err ? true : undefined}
        className={cn("font-mono text-xs", err && "border-red-500", className)}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(null);
            setErr(null);
          }
        }}
      />
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

function AnswersEditor({ fields, answers, onChange, prefix }: { fields: EField[]; answers: Answers; onChange: (key: string, v: string | number | undefined) => void; prefix: string }) {
  if (!fields.length) return <p className="text-xs text-muted">Add questions first.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => {
        const raw = answers[f.key];
        const str = raw === null || raw === undefined ? "" : String(raw);
        const label = `${prefix}: ${f.label}`;
        return (
          <label key={f._id} className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium">{f.label}</span>
            {f.type === "select" ? (
              <select aria-label={label} value={str} onChange={(e) => onChange(f.key, e.target.value || undefined)}>
                <option value="">(skipped)</option>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {str && !(f.options ?? []).some((o) => o.value === str) && <option value={str}>{str} (not an option)</option>}
              </select>
            ) : f.type === "number" ? (
              <NumInput label={label} className="w-full text-left" placeholder="(skipped)" value={str === "" || !Number.isFinite(Number(str)) ? null : Number(str)} onChange={(n) => onChange(f.key, n ?? undefined)} />
            ) : (
              <input aria-label={label} placeholder="(skipped)" value={str} onChange={(e) => onChange(f.key, e.target.value === "" ? undefined : e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- questions & points ----------------------------------------------------------- */

function MapPoints({ f, d, edit }: { f: EField; d: Draft; edit: Edit }) {
  const rule = d.rules.find((r) => r.field === f.key && r.kind === "map");
  const map = rule?.kind === "map" ? rule.map : {};
  const rows: { value: string; label: string }[] = [...(f.options ?? [])];
  for (const k of Object.keys(map)) if (k !== "blank" && !rows.some((o) => o.value === k)) rows.push({ value: k, label: `${k} (not an option)` });
  rows.push({ value: "blank", label: "blank (not answered)" });
  const set = (k: string, n: number | null) =>
    edit((x) => {
      let r = x.rules.find((y) => y.field === f.key && y.kind === "map");
      if (!r) {
        if (n === null) return;
        r = { kind: "map", field: f.key, map: {} };
        x.rules.push(r);
      }
      if (r.kind !== "map") return;
      if (n === null) delete r.map[k];
      else r.map[k] = n;
      if (Object.keys(r.map).length === 0) x.rules = x.rules.filter((y) => y !== r);
    });
  return (
    <table className="w-full max-w-md text-sm">
      <tbody>
        {rows.map((o) => (
          <tr key={o.value}>
            <td className="py-0.5 pr-2">{o.value === "blank" ? <em className="text-muted">{o.label}</em> : o.label}</td>
            <td className="w-24 py-0.5">
              <NumInput label={`Points for ${f.label}: ${o.label}`} placeholder="0" value={map[o.value]} onChange={(n) => set(o.value, n)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RangePoints({ f, d, edit }: { f: EField; d: Draft; edit: Edit }) {
  const rule = d.rules.find((r) => r.field === f.key && r.kind === "range");
  const ranges = rule?.kind === "range" ? rule.ranges : [];
  const blank = rule?.kind === "range" ? rule.blank : undefined;
  const mutate = (fn: (r: Extract<ScoringModel["rules"][number], { kind: "range" }>) => void) =>
    edit((x) => {
      let r = x.rules.find((y) => y.field === f.key && y.kind === "range");
      if (!r) {
        r = { kind: "range", field: f.key, ranges: [] };
        x.rules.push(r);
      }
      if (r.kind !== "range") return;
      fn(r);
      if (r.ranges.length === 0 && r.blank === undefined) x.rules = x.rules.filter((y) => y !== r);
    });
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs text-muted">Ranges are [min, max): first match wins. Leave min or max empty for open-ended.</p>
      {ranges.map((g, j) => (
        <div key={j} className="flex flex-wrap items-center gap-1.5">
          <NumInput label={`${f.label} range ${j + 1} min`} placeholder="−∞" value={g.min} onChange={(n) => mutate((r) => { r.ranges[j].min = n; })} />
          <span className="text-xs text-muted">to</span>
          <NumInput label={`${f.label} range ${j + 1} max`} placeholder="∞" value={g.max} onChange={(n) => mutate((r) => { r.ranges[j].max = n; })} />
          <span className="text-xs text-muted">→</span>
          <NumInput label={`${f.label} range ${j + 1} points`} placeholder="0" value={g.points} onChange={(n) => mutate((r) => { r.ranges[j].points = n ?? 0; })} />
          <span className="text-xs text-muted">pts</span>
          <IconBtn label={`Remove ${f.label} range ${j + 1}`} onClick={() => mutate((r) => { r.ranges.splice(j, 1); })}>✕</IconBtn>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={smallBtn} onClick={() => mutate((r) => { r.ranges.push({ min: null, max: null, points: 0 }); })}>+ Add range</button>
        <span className="text-xs text-muted">Blank (not answered)</span>
        <NumInput label={`Points for ${f.label}: blank`} placeholder="0" value={blank} onChange={(n) => mutate((r) => { if (n === null) delete r.blank; else r.blank = n; })} />
      </div>
    </div>
  );
}

function FieldCard({ f, i, d, edit }: { f: EField; i: number; d: Draft; edit: Edit }) {
  const n = d.fields.length;
  const at = (x: Draft) => x.fields.find((y) => y._id === f._id)!;
  const hasMap = d.rules.some((r) => r.field === f.key && r.kind === "map");
  const hasRange = d.rules.some((r) => r.field === f.key && r.kind === "range");
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{i + 1}. {f.label || "(untitled)"}</h3>
        <div className="flex gap-1">
          <IconBtn label={`Move ${f.label} up`} disabled={i === 0} onClick={() => edit((x) => move(x.fields, i, -1))}>↑</IconBtn>
          <IconBtn label={`Move ${f.label} down`} disabled={i === n - 1} onClick={() => edit((x) => move(x.fields, i, 1))}>↓</IconBtn>
          <IconBtn
            label={`Remove question ${f.label}`}
            onClick={() =>
              edit((x) => {
                x.fields = x.fields.filter((y) => y._id !== f._id);
                x.rules = x.rules.filter((r) => r.field !== f.key);
                for (const t of x.tests) delete t.answers[f.key];
              })
            }
          >
            Remove
          </IconBtn>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Question label">
          <input
            value={f.label}
            onChange={(e) =>
              edit((x) => {
                const g = at(x);
                g.label = e.target.value;
                if (g._auto) {
                  const k = uniqueKey(slugify(g.label), new Set(x.fields.filter((y) => y._id !== g._id).map((y) => y.key)));
                  if (k !== g.key) renameKey(x, g.key, k);
                }
              })
            }
          />
        </Field>
        <Field label="Key (lower_snake_case)" hint={f._auto ? "Follows the label until you edit it" : undefined}>
          <DraftText
            label={`Key for ${f.label}`}
            value={f.key}
            onCommit={(v) => {
              if (!KEY_RE.test(v)) return "Use a–z, 0–9 and _, start with a letter, max 48.";
              if (d.fields.some((y) => y._id !== f._id && y.key === v)) return "Another question already uses this key.";
              edit((x) => {
                renameKey(x, f.key, v);
                at(x)._auto = false;
              });
              return null;
            }}
          />
        </Field>
        <Field label="Answer type">
          <select
            value={f.type}
            onChange={(e) =>
              edit((x) => {
                const t = e.target.value as FieldDef["type"];
                const g = at(x);
                g.type = t;
                if (t === "select" && !g.options) g.options = [];
                x.rules = x.rules.filter((r) => r.field !== g.key || (t === "select" && r.kind === "map") || (t === "number" && r.kind === "range"));
              })
            }
          >
            <option value="select">Choice (select)</option>
            <option value="number">Number</option>
            <option value="text">Free text</option>
          </select>
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!f.required} onChange={(e) => edit((x) => { at(x).required = e.target.checked; })} /> Required
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={!!f.sensitive} onChange={(e) => edit((x) => { at(x).sensitive = e.target.checked; })} aria-describedby={`sens-${f._id}`} />
          <span>
            Sensitive
            <span id={`sens-${f._id}`} className="block text-xs text-muted">{SENSITIVE_HELP}</span>
          </span>
        </label>
      </div>

      {f.type === "select" && (
        <fieldset className="mt-3">
          <legend className="text-xs font-medium">Options</legend>
          <div className="mt-1 space-y-1">
            {(f.options ?? []).map((o, j) => (
              <div key={j} className="flex flex-wrap items-start gap-1.5">
                <DraftText
                  label={`${f.label} option ${j + 1} value`}
                  className="w-32"
                  value={o.value}
                  onCommit={(v) => {
                    if (!v) return "Value is required.";
                    if ((f.options ?? []).some((p, q) => q !== j && p.value === v)) return "Duplicate value.";
                    edit((x) => {
                      renameOption(x, f.key, o.value, v);
                      at(x).options![j].value = v;
                    });
                    return null;
                  }}
                />
                <input aria-label={`${f.label} option ${j + 1} label`} className="min-w-0 flex-1" value={o.label} onChange={(e) => edit((x) => { at(x).options![j].label = e.target.value; })} />
                <IconBtn label={`Move option ${o.label} up`} disabled={j === 0} onClick={() => edit((x) => move(at(x).options!, j, -1))}>↑</IconBtn>
                <IconBtn
                  label={`Remove option ${o.label}`}
                  onClick={() =>
                    edit((x) => {
                      at(x).options!.splice(j, 1);
                      for (const r of x.rules) if (r.field === f.key && r.kind === "map") delete r.map[o.value];
                    })
                  }
                >
                  ✕
                </IconBtn>
              </div>
            ))}
            <button
              type="button"
              className={smallBtn}
              onClick={() =>
                edit((x) => {
                  const g = at(x);
                  const opts = (g.options ??= []);
                  const v = uniqueKey(`option_${opts.length + 1}`, new Set(opts.map((p) => p.value)));
                  opts.push({ value: v, label: `Option ${opts.length + 1}` });
                })
              }
            >
              + Add option
            </button>
          </div>
        </fieldset>
      )}

      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 text-xs font-medium">Points</div>
        {f.type === "select" || hasMap ? <MapPoints f={f} d={d} edit={edit} /> : f.type === "number" || hasRange ? <RangePoints f={f} d={d} edit={edit} /> : <p className="text-xs text-muted">Text answers are stored but not scored.</p>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- lead types --------------------------------------------------------------- */

const ROW_KINDS: { k: Row["k"]; label: string }[] = [
  { k: "in", label: "answer is one of" },
  { k: "gte", label: "answer ≥" },
  { k: "lte", label: "answer ≤" },
  { k: "score_gte", label: "score ≥" },
  { k: "score_lte", label: "score ≤" },
];

function CondRow({ row, idx, fields, name, onChange, onRemove }: { row: Row; idx: number; fields: EField[]; name: string; onChange: (r: Row) => void; onRemove: () => void }) {
  const lbl = `${name} condition ${idx + 1}`;
  const field = "field" in row ? fields.find((f) => f.key === row.field) : undefined;
  const changeKind = (k: Row["k"]) => {
    const fKey = "field" in row ? row.field : (fields[0]?.key ?? "");
    const n = "n" in row ? row.n : 0;
    onChange(k === "in" ? { k, field: fKey, values: [] } : k === "gte" || k === "lte" ? { k, field: fKey, n } : { k, n });
  };
  return (
    <div className="flex flex-wrap items-start gap-1.5 rounded border border-line p-2">
      {"field" in row && (
        <select aria-label={`${lbl} question`} value={row.field} onChange={(e) => onChange(row.k === "in" ? { ...row, field: e.target.value, values: [] } : { ...row, field: e.target.value })}>
          {!field && <option value={row.field}>{row.field || "(choose)"} (unknown)</option>}
          {fields.map((f) => <option key={f._id} value={f.key}>{f.label}</option>)}
        </select>
      )}
      <select aria-label={`${lbl} test`} value={row.k} onChange={(e) => changeKind(e.target.value as Row["k"])}>
        {ROW_KINDS.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select>
      {row.k === "in" &&
        (field?.type === "select" && field.options?.length ? (
          <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
            <legend className="sr-only">{`${lbl} values`}</legend>
            {[...field.options.map((o) => o.value), ...row.values.filter((v) => !field.options!.some((o) => o.value === v))].map((v) => (
              <label key={v} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={row.values.includes(v)}
                  onChange={(e) => onChange({ ...row, values: e.target.checked ? [...row.values, v] : row.values.filter((x) => x !== v) })}
                />
                {field.options!.find((o) => o.value === v)?.label ?? v}
              </label>
            ))}
          </fieldset>
        ) : (
          <DraftText
            label={`${lbl} values, comma separated`}
            value={row.values.join(", ")}
            onCommit={(v) => {
              onChange({ ...row, values: v.split(",").map((s) => s.trim()).filter(Boolean) });
              return null;
            }}
          />
        ))}
      {"n" in row && <NumInput label={`${lbl} number`} value={row.n} onChange={(n) => { if (n !== null) onChange({ ...row, n }); }} />}
      <IconBtn label={`Remove ${lbl}`} onClick={onRemove}>✕</IconBtn>
    </div>
  );
}

function LeadCard({ l, i, d, edit }: { l: ELead; i: number; d: Draft; edit: Edit }) {
  const simple = useMemo(() => parseSimple(l.when), [l.when]);
  const at = (x: Draft) => x.leadTypes.find((y) => y._id === l._id)!;
  const setSimple = (s: Simple) => edit((x) => { at(x).when = buildCond(s); });
  const name = l.type || `Lead type ${i + 1}`;
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-2 flex flex-wrap items-end gap-3">
        <Field label={`Lead type ${i + 1}`}>
          <input value={l.type} onChange={(e) => edit((x) => { at(x).type = e.target.value; })} />
        </Field>
        <Field label="Velocity">
          <select value={l.velocity ?? ""} onChange={(e) => edit((x) => { const v = e.target.value as VelocityBand | ""; if (v) at(x).velocity = v; else delete at(x).velocity; })}>
            <option value="">(default: {d.defaultVelocity})</option>
            {VELOCITIES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <div className="ml-auto flex gap-1">
          <IconBtn label={`Move ${name} up`} disabled={i === 0} onClick={() => edit((x) => move(x.leadTypes, i, -1))}>↑</IconBtn>
          <IconBtn label={`Move ${name} down`} disabled={i === d.leadTypes.length - 1} onClick={() => edit((x) => move(x.leadTypes, i, 1))}>↓</IconBtn>
          <IconBtn label={`Remove ${name}`} onClick={() => edit((x) => { x.leadTypes = x.leadTypes.filter((y) => y._id !== l._id); })}>Remove</IconBtn>
        </div>
      </div>
      {simple ? (
        <div className="space-y-1.5">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            When
            <select aria-label={`${name} match mode`} value={simple.mode} onChange={(e) => setSimple({ ...simple, mode: e.target.value as Simple["mode"] })}>
              <option value="all">ALL</option>
              <option value="any">ANY</option>
            </select>
            of these match{simple.rows.length === 0 && simple.mode === "all" ? " (no conditions: always matches)" : ""}:
          </label>
          {simple.rows.map((r, j) => (
            <CondRow
              key={j}
              row={r}
              idx={j}
              name={name}
              fields={d.fields}
              onChange={(nr) => setSimple({ ...simple, rows: simple.rows.map((x, q) => (q === j ? nr : x)) })}
              onRemove={() => setSimple({ ...simple, rows: simple.rows.filter((_, q) => q !== j) })}
            />
          ))}
          <button type="button" className={smallBtn} onClick={() => setSimple({ ...simple, rows: [...simple.rows, d.fields[0] ? { k: "in", field: d.fields[0].key, values: [] } : { k: "score_gte", n: 0 }] })}>
            + Add condition
          </button>
        </div>
      ) : (
        <div>
          <p className="text-xs font-medium">Advanced condition (edit in JSON)</p>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-snug">{JSON.stringify(l.when, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- test cases --------------------------------------------------------------- */

function TestCard({ t, i, d, edit, outcome, typeNames }: { t: ETest; i: number; d: Draft; edit: Edit; outcome?: TestOutcome; typeNames: string[] }) {
  const at = (x: Draft) => x.tests.find((y) => y._id === t._id)!;
  const name = t.name || `Test ${i + 1}`;
  const types = t.expectType && !typeNames.includes(t.expectType) ? [...typeNames, t.expectType] : typeNames;
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {outcome && (outcome.pass ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>)}
          {outcome && <span className="num text-xs text-muted">got {outcome.got.score} · {outcome.got.leadType}</span>}
        </div>
        <IconBtn label={`Remove test ${name}`} onClick={() => edit((x) => { x.tests = x.tests.filter((y) => y._id !== t._id); })}>Remove</IconBtn>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Case name">
          <input value={t.name} onChange={(e) => edit((x) => { at(x).name = e.target.value; })} />
        </Field>
        <Field label="Expected score">
          <NumInput label={`Expected score for ${name}`} className="w-full text-left" value={t.expect} onChange={(n) => { if (n !== null) edit((x) => { at(x).expect = n; }); }} />
        </Field>
        <Field label="Expected type">
          <select value={t.expectType ?? ""} onChange={(e) => edit((x) => { const v = e.target.value; if (v) at(x).expectType = v; else delete at(x).expectType; })}>
            <option value="">(don’t check)</option>
            {types.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-2">
        <Field label="Note">
          <input value={t.note ?? ""} onChange={(e) => edit((x) => { at(x).note = e.target.value; })} />
        </Field>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-brand">Answers ({Object.keys(t.answers).length} given)</summary>
        <div className="mt-2">
          <AnswersEditor
            fields={d.fields}
            answers={t.answers}
            prefix={name}
            onChange={(k, v) => edit((x) => { const a = at(x).answers; if (v === undefined) delete a[k]; else a[k] = v; })}
          />
        </div>
      </details>
    </div>
  );
}

/* ---------------------------------------------------------------- builder ---------------------------------------------------------------- */

export function ScoringBuilder({ initial, action }: { initial: ScoringModel; action: (fd: FormData) => void | Promise<void> }) {
  const [d, setD] = useState<Draft>(() => fromModel(initial));
  const [tryA, setTryA] = useState<Answers>({});
  // Runs the mutation immediately (inside the event handler) on a deep copy, so event values are read synchronously.
  const edit: Edit = (fn) => {
    const next = structuredClone(d);
    fn(next);
    setD(next);
  };

  const model = useMemo(() => toModel(d), [d]);
  const check = useMemo(() => validateForPublish(model), [model]);
  const tests = useMemo(() => runTests(model), [model]);
  const preview = useMemo(() => evaluate(model, tryA), [model, tryA]);
  const json = useMemo(() => JSON.stringify(model), [model]);
  const typeNames = useMemo(() => [...new Set([...d.leadTypes.map((l) => l.type).filter(Boolean), d.defaultLeadType])], [d.leadTypes, d.defaultLeadType]);
  const warnings = useMemo(() => {
    const keys = new Set(d.fields.map((f) => f.key));
    const w: string[] = [];
    for (const l of d.leadTypes) for (const k of new Set(fieldsIn(l.when))) if (!keys.has(k)) w.push(`Lead type "${l.type}" refers to unknown question "${k}".`);
    for (const f of d.fields) if (f.type === "select" && !f.options?.length) w.push(`"${f.label}" has no options.`);
    return w;
  }, [d.fields, d.leadTypes]);
  const labelOf = (k: string) => d.fields.find((f) => f.key === k)?.label ?? k;

  return (
    <form
      action={action}
      className="space-y-6"
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (e.key === "Enter" && t.tagName === "INPUT") e.preventDefault();
      }}
    >
      <input type="hidden" name="json" value={json} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Settings" description="Score = clamp(base + points). Unknown or skipped answers add 0 unless a blank value is set. The clamp applies after summing.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Model name">
                <input value={d.name} onChange={(e) => edit((x) => { x.name = e.target.value; })} />
              </Field>
              <Field label="Currency (3 letters)">
                <input value={d.currency} maxLength={3} onChange={(e) => edit((x) => { x.currency = e.target.value.toUpperCase(); })} />
              </Field>
              <Field label="Base points">
                <NumInput label="Base points" className="w-full text-left" value={d.base} onChange={(n) => edit((x) => { x.base = n ?? 0; })} />
              </Field>
              <Field label="Minimum score">
                <NumInput label="Minimum score" className="w-full text-left" value={d.clamp.min} onChange={(n) => { if (n !== null) edit((x) => { x.clamp.min = n; }); }} />
              </Field>
              <Field label="Maximum score (cap)">
                <NumInput label="Maximum score (cap)" className="w-full text-left" value={d.clamp.max} onChange={(n) => { if (n !== null) edit((x) => { x.clamp.max = n; }); }} />
              </Field>
              <Field label="Default lead type">
                <input value={d.defaultLeadType} onChange={(e) => edit((x) => { x.defaultLeadType = e.target.value; })} />
              </Field>
              <Field label="Default velocity">
                <select value={d.defaultVelocity} onChange={(e) => edit((x) => { x.defaultVelocity = e.target.value as VelocityBand; })}>
                  {VELOCITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card title="Questions & points" description="Each question on the form, in order, with the points each answer adds.">
            <div className="space-y-3">
              {d.fields.map((f, i) => <FieldCard key={f._id} f={f} i={i} d={d} edit={edit} />)}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  edit((x) => {
                    x.seq += 1;
                    const key = uniqueKey("new_question", new Set(x.fields.map((f) => f.key)));
                    x.fields.push({ _id: x.seq, _auto: true, key, label: "New question", type: "select", options: [] });
                  })
                }
              >
                + Add question
              </Button>
            </div>
          </Card>

          <Card title="Lead types" description="Checked in order; the first match wins. If none match, the default lead type applies.">
            <div className="space-y-3">
              {d.leadTypes.map((l, i) => <LeadCard key={l._id} l={l} i={i} d={d} edit={edit} />)}
              <p className="text-sm">
                Otherwise: <strong>{d.defaultLeadType || "(set a default)"}</strong> <Badge>{d.defaultVelocity}</Badge>
              </p>
              <Button type="button" variant="secondary" onClick={() => edit((x) => { x.seq += 1; x.leadTypes.push({ _id: x.seq, type: `Lead type ${x.leadTypes.length + 1}`, when: { all: [] } }); })}>
                + Add lead type
              </Button>
            </div>
          </Card>

          <Card title="Test cases" description="Publishing is blocked unless every case produces the expected score (and type, when set).">
            <div className="space-y-3">
              {d.tests.map((t, i) => <TestCard key={t._id} t={t} i={i} d={d} edit={edit} outcome={tests.outcomes[i]} typeNames={typeNames} />)}
              <Button type="button" variant="secondary" onClick={() => edit((x) => { x.seq += 1; x.tests.push({ _id: x.seq, name: `Case ${x.tests.length + 1}`, answers: {}, expect: evaluate(toModel(x), {}).score }); })}>
                + Add test case
              </Button>
            </div>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
          <Card title="Try it" description="Answer as a lead would; nothing is saved.">
            <AnswersEditor fields={d.fields} answers={tryA} prefix="Try it" onChange={(k, v) => setTryA((a) => ({ ...a, [k]: v }))} />
            <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm" aria-live="polite">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="num text-2xl font-semibold">{preview.score}</span>
                <span className="text-xs text-muted">raw {preview.raw}{preview.capped ? " · capped" : ""}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone="blue">{preview.leadType}</Badge>
                <Badge tone={preview.velocity === "fast" ? "green" : preview.velocity === "slow" ? "amber" : "gray"}>{preview.velocity}</Badge>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs">
                <li className="flex justify-between"><span>Base</span><span className="num">{d.base}</span></li>
                {preview.breakdown.map((b, j) => (
                  <li key={j} className="flex justify-between gap-2">
                    <span className="truncate">{labelOf(b.field)}: {b.answer ?? <em>blank</em>}</span>
                    <span className="num">{b.points > 0 ? `+${b.points}` : b.points}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" className={cn(smallBtn, "mt-2")} onClick={() => setTryA({})}>Clear answers</button>
          </Card>

          <Card title="Validation" description="Runs the same checks as publishing.">
            {check.ok ? (
              <Notice tone="green">Ready to publish: all {tests.outcomes.length} tests pass.</Notice>
            ) : (
              <div role="alert">
                <Notice tone="red">
                  <ul className="list-disc space-y-0.5 pl-4 text-xs">
                    {check.errors.map((e, j) => <li key={j}>{e}</li>)}
                  </ul>
                </Notice>
              </div>
            )}
            {warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                {warnings.map((w, j) => <li key={j}>{w}</li>)}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel p-4">
        <Field label="Change note">
          <input name="notes" className="w-full sm:w-72" placeholder="What changed and why" />
        </Field>
        <Button name="intent" value="draft" variant="secondary">
          Save draft
        </Button>
        <Button name="intent" value="publish" disabled={!check.ok} aria-describedby={check.ok ? undefined : "publish-blocked"}>
          Run tests & publish
        </Button>
        {!check.ok && <span id="publish-blocked" className="text-xs text-red-700">Fix the validation errors to publish.</span>}
      </div>
    </form>
  );
}
