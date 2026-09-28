"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

type Factor = { id: string; friendly_name?: string; status: string; factor_type: string };

/** TOTP two-factor enrollment (Supabase Auth MFA). */
export function MfaManager() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function load() {
    const { data } = await browserClient().auth.mfa.listFactors();
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.factor_type === "totp"));
  }
  useEffect(() => {
    let alive = true;
    browserClient()
      .auth.mfa.listFactors()
      .then(({ data }) => alive && setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.factor_type === "totp")))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function start() {
    setBusy(true);
    setMsg(null);
    // Remove stale unverified factors first (Supabase allows only a limited number).
    for (const f of factors.filter((x) => x.status !== "verified")) await browserClient().auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await browserClient().auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${factors.length + 1}` });
    setBusy(false);
    if (error || !data) return setMsg(error?.message ?? "Could not start enrollment");
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function verify() {
    if (!enroll) return;
    setBusy(true);
    const { error } = await browserClient().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    setBusy(false);
    if (error) return setMsg("That code did not work. Check the time on your phone and try again.");
    setEnroll(null);
    setCode("");
    setMsg("Two-factor authentication is on.");
    await load();
    router.refresh();
  }
  async function remove(id: string) {
    const { error } = await browserClient().auth.mfa.unenroll({ factorId: id });
    setMsg(error ? error.message : "Authenticator removed.");
    await load();
    router.refresh();
  }

  const verified = factors.filter((f) => f.status === "verified");
  return (
    <div className="space-y-3 text-sm">
      {verified.length ? (
        <ul className="space-y-1">
          {verified.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded border border-line px-3 py-2">
              <span>{f.friendly_name ?? "Authenticator app"} — active</span>
              <button onClick={() => remove(f.id)} className="text-xs text-red-700 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">Two-factor authentication is off.</p>
      )}
      {!enroll && (
        <button onClick={start} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {verified.length ? "Add another authenticator" : "Turn on two-factor authentication"}
        </button>
      )}
      {enroll && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <p>Scan this code with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="Two-factor QR code" className="h-40 w-40 bg-white" />
          <p className="text-xs text-muted">
            Can&apos;t scan? Enter this key: <code className="break-all">{enroll.secret}</code>
          </p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code" className="w-32" />
            <button onClick={verify} disabled={busy || code.trim().length !== 6} className="rounded-md bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50">
              Verify
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}

/** Second sign-in step for users with a verified authenticator. */
export function MfaChallenge({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const sb = browserClient();
    const { data } = await sb.auth.mfa.listFactors();
    const f = (data?.totp ?? [])[0];
    if (!f) {
      setBusy(false);
      return setErr("No authenticator is set up for this account.");
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() });
    setBusy(false);
    if (error) return setErr("That code did not work. Try the newest code.");
    router.replace(next);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">6-digit code from your authenticator app</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
      </label>
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button disabled={busy || code.trim().length !== 6} className="w-full rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
