/*
 * Website tag (M1). Loaded async from the partner's tag domain:
 *   <script async src="https://t.{partner-domain}/ose.js" data-site="SITE_KEY"></script>
 * Captures ad click IDs, UTMs, ValueTrack IDs and click time as first/last touch; auto-binds forms;
 * exposes window.ose = { lead, identify, consent, debug }. No dependencies, no eval, no render blocking.
 * Never reads password, card or government-ID fields.
 */
type Dict = Record<string, string>;
type Touch = Dict & { click_ts: string };
type Store = { v: string; first?: Touch; last?: Touch; c?: Dict };

declare global {
  interface Window {
    ose?: OseApi & { q?: unknown[][] };
    dataLayer?: unknown[];
  }
}
type OseApi = {
  lead: (d: { form?: string; email?: string; phone?: string; name?: string; geo?: string; answers?: Record<string, string | number>; test?: boolean }) => Promise<unknown>;
  identify: (d: { email?: string; phone?: string }) => void;
  consent: (c: { ad_user_data?: "granted" | "denied"; ad_personalization?: "granted" | "denied" }) => void;
  debug: () => { store: Store; events: unknown[] };
  version: string;
};

(function () {
  const VERSION = "1.0.0";
  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>("script[data-site][src*='ose.js']");
  if (!script || window.ose?.version) return;
  const SITE = script.getAttribute("data-site") || "";
  const ENDPOINT = new URL("/v1/collect", script.src).toString();
  const KEY = "_ose";
  const CLICK = ["gclid", "gbraid", "wbraid", "msclkid", "fbclid"];
  const PARAMS = [...CLICK, "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "campaignid", "adgroupid", "keyword", "device"];
  const RENAME: Dict = { campaignid: "campaign_id", adgroupid: "adgroup_id" };
  const SENSITIVE = /pass|pwd|card|cc-|cvv|cvc|ssn|social|iban|account.?number|routing|tax.?id|pin\b/i;
  const events: unknown[] = [];

  function read(): Store {
    try {
      const ls = localStorage.getItem(KEY);
      if (ls) return JSON.parse(ls);
    } catch {}
    const m = document.cookie.match(/(?:^|; )_ose=([^;]*)/);
    if (m) {
      try {
        return JSON.parse(decodeURIComponent(m[1]));
      } catch {}
    }
    return { v: rid() };
  }
  function write(s: Store) {
    const val = JSON.stringify(s);
    try {
      localStorage.setItem(KEY, val);
    } catch {}
    // First-party cookie mirror (90 days). Safari ITP may shorten it; the server-side visit record is authoritative.
    document.cookie = `${KEY}=${encodeURIComponent(JSON.stringify({ v: s.v }))}; max-age=${90 * 86400}; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function rid() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return "v_" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  const store = read();

  function consentFromDataLayer(): Dict {
    const out: Dict = { ...(store.c || {}) };
    for (const e of window.dataLayer || []) {
      const x = e as unknown[] | { 0?: unknown; 1?: unknown; 2?: Dict };
      const arr = Array.isArray(x) ? x : [x[0], x[1], x[2]];
      if (arr[0] === "consent" && (arr[1] === "default" || arr[1] === "update") && arr[2] && typeof arr[2] === "object") {
        const c = arr[2] as Dict;
        if (c.ad_user_data) out.ad_user_data = c.ad_user_data;
        if (c.ad_personalization) out.ad_personalization = c.ad_personalization;
      }
    }
    return out;
  }

  function send(payload: Dict | Record<string, unknown>, wantResponse = false): Promise<unknown> {
    const body = JSON.stringify({ k: SITE, v: store.v, tv: VERSION, c: consentFromDataLayer(), ...payload });
    events.unshift({ at: new Date().toISOString(), ...payload });
    events.length = Math.min(events.length, 50);
    if (!wantResponse && navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return Promise.resolve(null);
    return fetch(ENDPOINT, { method: "POST", body, headers: { "content-type": "text/plain" }, keepalive: true, credentials: "omit" })
      .then((r) => r.json())
      .catch(() => null);
  }

  function capture() {
    const q = new URLSearchParams(location.search);
    const t: Touch = { click_ts: new Date().toISOString() };
    let found = false;
    for (const p of PARAMS) {
      const v = q.get(p);
      if (v) {
        t[RENAME[p] || p] = v.slice(0, 300);
        found = true;
      }
    }
    if (!found) return;
    t.landing_url = location.origin + location.pathname; // no query string: never store PII from URLs
    if (document.referrer) t.referrer = document.referrer.split("?")[0];
    if (!store.first) store.first = t; // first touch is never overwritten
    store.last = t;
    write(store);
    send({ t: "visit", a: t });
  }

  function attribution(): Dict {
    return { ...(store.first || {}), ...(store.last || {}) };
  }

  // ---- forms -----------------------------------------------------------------
  function fieldKey(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
    return (el.getAttribute("data-ose-field") || el.name || el.id || "").trim();
  }
  function isSensitive(el: Element & { type?: string; autocomplete?: string }, key: string) {
    return el.type === "password" || el.type === "hidden" && key.startsWith("ose_") || SENSITIVE.test(key) || SENSITIVE.test(el.autocomplete || "");
  }
  function injectHidden(form: HTMLFormElement) {
    const a = attribution();
    const set = (n: string, v?: string) => {
      if (!v) return;
      let i = form.querySelector<HTMLInputElement>(`input[name="${n}"]`);
      if (!i) {
        i = document.createElement("input");
        i.type = "hidden";
        i.name = n;
        form.appendChild(i);
      }
      i.value = v;
    };
    set("ose_visitor", store.v);
    for (const k of ["gclid", "gbraid", "wbraid", "msclkid", "utm_source", "utm_campaign", "click_ts"]) set(k === "click_ts" ? "ose_click_ts" : k, a[k]);
  }
  function collect(form: HTMLFormElement) {
    const answers: Record<string, string> = {};
    let email = "", phone = "", name = "", first = "", last = "";
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name && !el.getAttribute?.("data-ose-field")) continue;
      const key = fieldKey(el);
      if (!key || isSensitive(el, key) || el.disabled) continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      const val = String(el.value || "").trim().slice(0, 500);
      if (!val) continue;
      const k = key.toLowerCase();
      if (el.type === "email" || /e-?mail/.test(k)) email = val;
      else if (el.type === "tel" || /phone|mobile|tel\b/.test(k)) phone = val;
      else if (/^(full_?)?name$/.test(k)) name = val;
      else if (/first.?name|fname/.test(k)) first = val;
      else if (/last.?name|lname|surname/.test(k)) last = val;
      else if (k.startsWith("ose_") || CLICK.includes(k) || k.startsWith("utm_")) continue;
      else if (/message|comment|note/.test(k)) continue; // free text is not scored and may hold PII
      else answers[k.replace(/[^a-z0-9_]/g, "_").slice(0, 48)] = val;
    }
    return { email, phone, name: name || [first, last].filter(Boolean).join(" "), answers };
  }
  function bind() {
    document.addEventListener(
      "submit",
      (ev) => {
        const form = ev.target as HTMLFormElement;
        if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-ose-ignore")) return;
        if (form.querySelector("input[type=password]")) return; // never touch login/sign-up forms
        injectHidden(form);
        const d = collect(form);
        if (!d.email && !d.phone && !Object.keys(d.answers).length) return;
        send({ t: "lead", a: attribution(), l: { form: form.getAttribute("data-ose-form") || form.id || form.getAttribute("name") || location.pathname, ...d } });
      },
      true,
    );
    // Pre-fill hidden fields so the site's own handler (or CRM form) also receives the click IDs.
    const fill = () => document.querySelectorAll("form").forEach((f) => !f.hasAttribute("data-ose-ignore") && injectHidden(f));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
    else fill();
  }

  // ---- SPA support -------------------------------------------------------------
  function watchHistory() {
    const wrap = (fn: "pushState" | "replaceState") => {
      const orig = history[fn];
      history[fn] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const r = orig.apply(this, args);
        setTimeout(capture, 0);
        return r;
      } as History["pushState"];
    };
    wrap("pushState");
    wrap("replaceState");
    addEventListener("popstate", capture);
  }

  const api: OseApi = {
    version: VERSION,
    lead: (d) => send({ t: "lead", a: attribution(), l: { answers: {}, ...d } }, true),
    identify: (d) => {
      // Identity is only sent with a lead; nothing is stored in the browser.
      void d;
    },
    consent: (c) => {
      store.c = { ...(store.c || {}), ...c } as Dict;
      write(store);
    },
    debug: () => ({ store, events }),
  };

  const queued = window.ose?.q || [];
  window.ose = api;
  capture();
  bind();
  watchHistory();
  for (const [m, ...args] of queued) (api as unknown as Record<string, (...a: unknown[]) => unknown>)[m as string]?.(...args);
})();

export {};
