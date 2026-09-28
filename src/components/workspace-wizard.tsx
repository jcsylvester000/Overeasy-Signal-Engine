"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "./ui";

export type TemplateSummary = { id: string; name: string; description: string; leadTypes: string[]; fields: number; regulated: boolean; currency: string };
type State = { error?: string } | null;
type Props = { orgName: string; cancelHref: string; templates: TemplateSummary[]; zones: string[]; action: (prev: State, fd: FormData) => Promise<State> };

const STEPS = ["Business", "Industry", "Client access", "Review"] as const;
const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "PHP"];
const ROLES = [
  { id: "client_viewer", label: "Client viewer", hint: "Sees results only" },
  { id: "analyst", label: "Analyst", hint: "Results + reports" },
  { id: "manager", label: "Manager", hint: "Can change setup" },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
      {pending ? "Creating workspace…" : "Create workspace"}
    </button>
  );
}

export function WorkspaceWizard({ orgName, cancelHref, templates, zones, action }: Props) {
  const [state, formAction] = useActionState(action, null);
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [v, setV] = useState(() => ({
    name: "",
    domain: "",
    timezone: "America/New_York",
    currency: "USD",
    template: templates[0]?.id ?? "land-acquisition",
    invite_email: "",
    invite_role: "client_viewer",
    attest: false,
  }));
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const tpl = templates.find((t) => t.id === v.template) ?? templates[0];

  function validate(s: number): string | null {
    if (s === 0) {
      if (v.name.trim().length < 2) return "Enter the client or business name.";
      const d = v.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return "The website domain looks wrong. Use a form like example.com.";
    }
    if (s === 2 && v.invite_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.invite_email.trim())) return "The invite email looks wrong (or leave it empty).";
    return null;
  }
  const next = () => {
    const e = validate(step);
    setStepError(e);
    if (!e) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <form
      action={formAction}
      onKeyDown={(e) => {
        // Enter moves to the next step instead of submitting early.
        if (e.key === "Enter" && step < STEPS.length - 1 && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          next();
        }
      }}
      className="rounded-lg border border-line bg-panel shadow-sm"
    >
      {/* Everything is submitted at the end; hidden inputs carry values from earlier steps. */}
      {Object.entries(v).map(([k, val]) => (typeof val === "boolean" ? (val ? <input key={k} type="hidden" name={k} value="on" /> : null) : <input key={k} type="hidden" name={k} value={val} />))}

      <ol className="flex border-b border-line text-xs sm:text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              disabled={i > step}
              onClick={() => i < step && setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn("flex w-full items-center gap-2 px-3 py-3 text-left", i === step ? "font-semibold text-ink" : i < step ? "text-ink hover:bg-gray-50" : "text-muted")}
            >
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs", i < step ? "bg-accent text-white" : i === step ? "bg-brand text-white" : "bg-gray-100 text-muted")}>{i < step ? "✓" : i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-4 p-5">
        {step === 0 && (
          <>
            <div>
              <h2 className="text-base font-semibold">About the client</h2>
              <p className="text-sm text-muted">One workspace is one client business under {orgName}: its website, CRM pipeline and ad accounts.</p>
            </div>
            <label className="block">
              <span className="text-xs font-medium">Client / business name</span>
              <input autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Acme Land Co" className="mt-1 w-full" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Website domain (optional)</span>
              <input value={v.domain} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" className="mt-1 w-full" />
              <span className="mt-1 block text-xs text-muted">Creates the site key for the tracking snippet. You can add more sites later.</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium">Timezone</span>
                {zones.length ? (
                  <select value={v.timezone} onChange={(e) => set("timezone", e.target.value)} className="mt-1 w-full">
                    {(zones.includes(v.timezone) ? zones : [v.timezone, ...zones]).map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                ) : (
                  <input value={v.timezone} onChange={(e) => set("timezone", e.target.value)} className="mt-1 w-full" />
                )}
                <span className="mt-1 block text-xs text-muted">
                  Used for daily reports and spend.{" "}
                  <button type="button" className="underline hover:text-ink" onClick={() => set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || v.timezone)}>
                    Use this device&apos;s timezone
                  </button>
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Currency</span>
                <select value={v.currency} onChange={(e) => set("currency", e.target.value)} className="mt-1 w-full">
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-muted">Lead values are sent to ad platforms in this currency.</span>
              </label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <h2 className="text-base font-semibold">What kind of business is it?</h2>
              <p className="text-sm text-muted">The template sets the starting lead scoring, lead types, value ladder and CRM stage rules. Everything can be edited later.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Industry template">
              {templates.map((t) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={v.template === t.id}
                  key={t.id}
                  onClick={() => set("template", t.id)}
                  className={cn("rounded-md border p-3 text-left transition", v.template === t.id ? "border-brand ring-2 ring-brand/30" : "border-line hover:border-gray-400")}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {t.name}
                    {t.regulated && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">regulated</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted">{t.description}</p>
                  <p className="mt-2 text-xs">
                    <span className="text-muted">Lead types:</span> {t.leadTypes.join(", ") || "—"} · {t.fields} scored questions
                  </p>
                </button>
              ))}
            </div>
            {tpl?.regulated && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Regulated vertical: raw contact details are not stored and hashed contact data is never uploaded to ad platforms. Only click IDs and values are sent.
              </p>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h2 className="text-base font-semibold">Give the client access (optional)</h2>
              <p className="text-sm text-muted">Invite someone at the client to see this workspace only. They get an email to set a password. You can skip this and invite people later.</p>
            </div>
            <label className="block">
              <span className="text-xs font-medium">Client email</span>
              <input type="email" value={v.invite_email} onChange={(e) => set("invite_email", e.target.value)} placeholder="owner@client.com" className="mt-1 w-full" />
            </label>
            <fieldset>
              <legend className="text-xs font-medium">Their role</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {ROLES.map((r) => (
                  <label key={r.id} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2", v.invite_role === r.id ? "border-brand" : "border-line")}>
                    <input type="radio" name="_role" checked={v.invite_role === r.id} onChange={() => set("invite_role", r.id)} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{r.label}</span>
                      <span className="block text-xs text-muted">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <h2 className="text-base font-semibold">Review and create</h2>
              <p className="text-sm text-muted">After this you land on the setup checklist: install the tracking snippet, connect the CRM, then the ad accounts.</p>
            </div>
            <dl className="grid gap-x-6 gap-y-2 rounded-md border border-line p-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted">Client</dt>
              <dd className="font-medium">{v.name}</dd>
              <dt className="text-muted">Website</dt>
              <dd>{v.domain || "— (add later)"}</dd>
              <dt className="text-muted">Timezone · currency</dt>
              <dd>
                {v.timezone} · {v.currency}
              </dd>
              <dt className="text-muted">Industry template</dt>
              <dd>{tpl?.name}</dd>
              <dt className="text-muted">Client access</dt>
              <dd>{v.invite_email ? `${v.invite_email} (${ROLES.find((r) => r.id === v.invite_role)?.label})` : "No invite"}</dd>
              <dt className="text-muted">Ad platforms · CRM</dt>
              <dd>Start in dry run: nothing is sent until you connect accounts and switch modes.</dd>
            </dl>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={v.attest} onChange={(e) => set("attest", e.target.checked)} className="mt-0.5" />
              <span>
                I confirm this client&apos;s forms are not directed at children under 13, will not collect health, criminal or other sensitive data unless the workspace is a regulated vertical, and the client&apos;s privacy policy discloses sharing with ad platforms.
              </span>
            </label>
          </>
        )}

        {(stepError || state?.error) && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900">
            {stepError ?? state?.error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <Link href={cancelHref} className="text-sm text-muted hover:text-ink">
          Cancel
        </Link>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={back} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-gray-50">
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              {step === 2 && !v.invite_email ? "Skip for now" : "Continue"}
            </button>
          ) : v.attest ? (
            <Submit />
          ) : (
            <button type="button" disabled className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white opacity-50">
              Create workspace
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
