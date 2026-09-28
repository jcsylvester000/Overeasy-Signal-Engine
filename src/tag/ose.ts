/*
 * Website tag (M1). Loaded async from the partner's tag domain:
 *   <script async src="https://t.{partner-domain}/ose.js" data-site="SITE_KEY"></script>
 * Captures ad click IDs, UTMs, ValueTrack IDs and click time as first/last touch; auto-binds forms;
 * exposes window.ose = { lead, identify, consent, debug }. No dependencies, no eval, no render blocking.
 * Never reads password, card or government-ID fields. Observe-only: never cancels or alters a submit.
 *
 * v1.1: binds forms added after load; confirms a submit succeeded before counting it (success message,
 * form hidden, or navigation — discarded when validation errors appear); detects embedded third-party
 * forms (HubSpot, Typeform, JotForm, Calendly, GoHighLevel, …) via their postMessage events; sends a
 * no-PII diagnostics ping (forms and embeds found per page) for the install check.
 * Script attributes: data-confirm="off" · data-embeds="off" · data-embed-params="on" · data-embed-origins="a.com b.com"
 */
type Dict = Record<string, string>;
type Touch = Dict & { click_ts: string };
type Store = { v: string; first?: Touch; last?: Touch; c?: Dict };

declare global {
  interface Window {
    ose?: OseApi & { q?: unknown[][] };
    dataLayer?: unknown[];
    oseConfig?: { site?: string; consentRequired?: boolean };
  }
}
type OseApi = {
  lead: (d: { form?: string; email?: string; phone?: string; name?: string; geo?: string; answers?: Record<string, string | number>; test?: boolean }) => Promise<unknown>;
  identify: (d: { email?: string; phone?: string }) => void;
  consent: (c: { ad_user_data?: "granted" | "denied"; ad_personalization?: "granted" | "denied"; ad_storage?: "granted" | "denied" }) => void;
  debug: () => { store: Store; events: unknown[]; pending: number; forms: number; embeds: string[] };
  version: string;
};

(function () {
  const VERSION = "1.1.0";
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-site][src*='ose.js']") ??
    document.querySelector<HTMLScriptElement>("script[src*='/ose.js']"); // GTM injectScript cannot set data-site
  if (!script || window.ose?.version) return;
  const SITE = script.getAttribute("data-site") || window.oseConfig?.site || new URL(script.src).searchParams.get("site") || "";
  if (!SITE) return;
  const ENDPOINT = new URL("/v1/collect", script.src).toString();
  // Consent-required mode (EU/UK/CH sites): store and send nothing until the CMP grants ad_storage.
  const CONSENT_REQUIRED = script.getAttribute("data-consent") === "required" || window.oseConfig?.consentRequired === true;
  let visitSent = false;
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
    if (!granted()) return;
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

  function consentFromDataLayer(): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = { ...(store.c || {}) };
    // Global Privacy Control (universal opt-out signal): honoured server-side per workspace policy.
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) out.gpc = true;
    for (const e of window.dataLayer || []) {
      const x = e as unknown[] | { 0?: unknown; 1?: unknown; 2?: Dict };
      const arr = Array.isArray(x) ? x : [x[0], x[1], x[2]];
      if (arr[0] === "consent" && (arr[1] === "default" || arr[1] === "update") && arr[2] && typeof arr[2] === "object") {
        const c = arr[2] as Dict;
        if (c.ad_user_data) out.ad_user_data = c.ad_user_data;
        if (c.ad_personalization) out.ad_personalization = c.ad_personalization;
        if (c.ad_storage) out.ad_storage = c.ad_storage;
      }
    }
    return out;
  }

  function granted(): boolean {
    return !CONSENT_REQUIRED || consentFromDataLayer().ad_storage === "granted";
  }

  /** Called when consent may have changed: persist the pending touch and send the deferred visit. */
  function flush() {
    if (!granted()) return;
    write(store);
    if (store.last && !visitSent) {
      visitSent = true;
      send({ t: "visit", a: store.last });
    }
  }

  function send(payload: Dict | Record<string, unknown>, wantResponse = false): Promise<unknown> {
    // Diagnostics pings carry no visitor id.
    const body = JSON.stringify({ k: SITE, v: payload.t === "ping" ? "anonymous" : store.v, tv: VERSION, c: consentFromDataLayer(), ...payload });
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
    visitSent = false;
    flush();
  }

  function attribution(): Dict {
    if (!granted()) return {};
    return { ...(store.first || {}), ...(store.last || {}) };
  }

  // ---- config ------------------------------------------------------------------
  const opt = (n: string) => script.getAttribute(n);
  const CONFIRM = opt("data-confirm") !== "off";
  const EMBEDS = opt("data-embeds") !== "off";
  const EMBED_PARAMS = opt("data-embed-params") === "on";
  const EXTRA_ORIGINS = (opt("data-embed-origins") || "").toLowerCase().split(/[\s,]+/).filter(Boolean);

  // ---- forms -----------------------------------------------------------------
  type LeadData = { email: string; phone: string; name: string; answers: Record<string, string> };
  type Acc = LeadData & { first: string; last: string };

  function fieldKey(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
    return (el.getAttribute("data-ose-field") || el.name || el.id || "").trim();
  }
  function isSensitive(el: Element & { type?: string; autocomplete?: string }, key: string) {
    return el.type === "password" || el.type === "hidden" && key.startsWith("ose_") || SENSITIVE.test(key) || SENSITIVE.test(el.autocomplete || "");
  }
  const skip = (f: HTMLFormElement) => f.hasAttribute("data-ose-ignore") || !!f.querySelector("input[type=password]"); // never touch login/sign-up forms
  const formName = (f: HTMLFormElement) => (f.getAttribute("data-ose-form") || f.id || f.getAttribute("name") || location.pathname).slice(0, 100);

  function injectHidden(form: HTMLFormElement) {
    if (!granted()) return;
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
      if (i.value !== v) i.value = v;
    };
    set("ose_visitor", store.v);
    for (const k of ["gclid", "gbraid", "wbraid", "msclkid", "utm_source", "utm_campaign", "click_ts"]) set(k === "click_ts" ? "ose_click_ts" : k, a[k]);
  }

  /** Sorts one field into email / phone / name / scored answers. Free text and tracking fields are dropped. */
  function absorb(acc: Acc, key: string, type: string, raw: unknown) {
    const val = String(raw ?? "").trim().slice(0, 500);
    if (!val || !key || SENSITIVE.test(key)) return;
    const k = key.toLowerCase();
    if (type === "email" || /e-?mail/.test(k)) acc.email = val;
    else if (type === "tel" || /phone|mobile|tel\b/.test(k)) acc.phone = val;
    else if (/^(full_?)?name$/.test(k)) acc.name = val;
    else if (/first.?name|fname/.test(k)) acc.first = val;
    else if (/last.?name|lname|surname/.test(k)) acc.last = val;
    else if (k.startsWith("ose_") || CLICK.includes(k) || k.startsWith("utm_")) return;
    else if (/message|comment|note/.test(k)) return; // free text is not scored and may hold PII
    else acc.answers[k.replace(/[^a-z0-9_]/g, "_").slice(0, 48)] = val;
  }
  const newAcc = (): Acc => ({ email: "", phone: "", name: "", first: "", last: "", answers: {} });
  const done = (a: Acc): LeadData => ({ email: a.email, phone: a.phone, name: a.name || [a.first, a.last].filter(Boolean).join(" "), answers: a.answers });
  const hasData = (d: LeadData) => !!(d.email || d.phone || Object.keys(d.answers).length);

  function collect(form: HTMLFormElement): LeadData {
    const acc = newAcc();
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name && !el.getAttribute?.("data-ose-field")) continue;
      const key = fieldKey(el);
      if (!key || isSensitive(el, key) || el.disabled) continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      absorb(acc, key, el.type, el.value);
    }
    return done(acc);
  }

  const recent: Record<string, number> = {};
  function sendLead(form: string, d: LeadData, via: string) {
    const fp = form + "|" + d.email + "|" + d.phone + "|" + JSON.stringify(d.answers);
    const now = Date.now();
    if (recent[fp] && now - recent[fp] < 60_000) return; // double-submit guard
    recent[fp] = now;
    send({ t: "lead", a: attribution(), l: { form, via, ...d } });
  }

  // ---- success confirmation ------------------------------------------------------
  // Common form builders' success / error markers (Contact Form 7, Elementor, Webflow, Gravity, WPForms,
  // Formidable, Ninja Forms, HubSpot) plus generic ones and explicit data-ose-success / data-ose-error.
  const OK_SEL =
    "[data-ose-success],.wpcf7 form.sent .wpcf7-response-output,.elementor-message-success,.w-form-done,.gform_confirmation_message,.wpforms-confirmation-container,.wpforms-confirmation-container-full,.frm_message,.nf-response-msg,.submitted-message,.form-success,.success-message,.alert-success";
  const ERR_SEL =
    "[data-ose-error],[aria-invalid=true],.wpcf7-not-valid-tip,.elementor-message-danger,.w-form-fail,.gfield_error,.wpforms-error,.frm_error,.nf-error-msg,.error-message,.form-error,.field-error,.invalid-feedback,.alert-danger";
  const OK_TEXT = /thank you|thanks for|we('| wi)ll be in touch|received your|message (has been |was )?sent|submission (was )?(successful|received)|successfully (submitted|sent)/i;

  function visible(el: Element | null): boolean {
    if (!el || !el.isConnected) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      if ((e as HTMLElement).hidden) return false;
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
  }
  const signals = (root: ParentNode, sel: string) =>
    Array.from(root.querySelectorAll(sel)).filter((e) => visible(e) && (e.matches("[aria-invalid=true],[data-ose-success],[data-ose-error]") || !!(e.textContent || "").trim())).length;

  type Pending = { form: HTMLFormElement; name: string; data: LeadData; errs: number; ok: number; scope: Element; okText: boolean; done: boolean; poll?: ReturnType<typeof setInterval>; timer?: ReturnType<typeof setTimeout> };
  const pendings: Pending[] = [];

  function finish(p: Pending, via: string | null) {
    if (p.done) return;
    p.done = true;
    clearInterval(p.poll);
    clearTimeout(p.timer);
    pendings.splice(pendings.indexOf(p), 1);
    if (via) sendLead(p.name, p.data, via);
  }
  function check(p: Pending, final = false) {
    if (p.done) return;
    if (signals(document, OK_SEL) > p.ok || (!p.okText && p.scope.isConnected && OK_TEXT.test(p.scope.textContent || ""))) return finish(p, "success");
    if (!visible(p.form)) return finish(p, "form-hidden");
    const errs = signals(p.form, ERR_SEL);
    if (errs > p.errs) return finish(p, null); // validation failed: wait for the next submit
    if (final) finish(p, errs ? null : "timeout");
  }

  function onSubmit(ev: Event) {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement) || skip(form)) return;
    injectHidden(form);
    const data = collect(form);
    if (!hasData(data)) return;
    const name = formName(form);
    if (!CONFIRM || form.hasAttribute("data-ose-now")) return sendLead(name, data, "submit");
    const prev = pendings.find((x) => x.form === form);
    if (prev) finish(prev, null);
    const scope = form.parentElement?.parentElement || document.body;
    const p: Pending = { form, name, data, errs: signals(form, ERR_SEL), ok: signals(document, OK_SEL), scope, okText: OK_TEXT.test(scope.textContent || ""), done: false };
    pendings.push(p);
    p.poll = setInterval(() => check(p), 300);
    p.timer = setTimeout(() => check(p, true), 8000);
  }

  // ---- embedded third-party forms ----------------------------------------------------
  const VENDORS: [RegExp, string][] = [
    [/(^|\.)(hsforms\.(com|net)|hubspot\.com)$/, "hubspot"],
    [/(^|\.)typeform\.com$/, "typeform"],
    [/(^|\.)jotform\.(com|pro|eu)$/, "jotform"],
    [/(^|\.)calendly\.com$/, "calendly"],
    [/(^|\.)(leadconnectorhq|msgsndr|gohighlevel)\.com$/, "ghl"],
    [/(^|\.)tally\.so$/, "tally"],
    [/(^|\.)paperform\.co$/, "paperform"],
    [/(^|\.)cognitoforms\.com$/, "cognito"],
    [/(^|\.)formstack\.com$/, "formstack"],
    [/(^|\.)wufoo\.com$/, "wufoo"],
    [/(^|\.)acuityscheduling\.com$/, "acuity"],
    [/^docs\.google\.com$/, "google-forms"], // detected only: Google Forms sends no submit message
  ];
  function vendorOf(host: string): string | null {
    host = host.toLowerCase();
    if (EXTRA_ORIGINS.some((o) => host === o || host.endsWith("." + o))) return "custom";
    for (const [re, v] of VENDORS) if (re.test(host)) return v;
    return null;
  }
  const embedSeen: Record<string, number> = {};
  function embedLead(vendor: string, d?: LeadData, label = "form") {
    const now = Date.now();
    if (embedSeen[vendor] && now - embedSeen[vendor] < 15_000) return;
    embedSeen[vendor] = now;
    sendLead(`${vendor} ${label}`, d ?? { email: "", phone: "", name: "", answers: {} }, "embed:" + vendor);
  }
  const SUBMIT_MSG = /form[-_ ]?submit|submission[-_ ]?complet|submi(t|ssion)[-_ ]?(ted|success)|formsubmitted|form_submitted|onformsubmitted|event_scheduled|booking[-_ ]?(complete|confirmed)/i;

  function onMessage(e: MessageEvent) {
    const d = e.data as Record<string, unknown> | string | null;
    // HubSpot legacy forms post a callback to the page with the submitted fields.
    if (d && typeof d === "object" && d.type === "hsFormCallback" && d.eventName === "onFormSubmitted") {
      const acc = newAcc();
      const fields = Array.isArray(d.data) ? (d.data as { name?: string; value?: unknown }[]) : Object.entries((d.data as { submissionValues?: Record<string, unknown> })?.submissionValues ?? {}).map(([name, value]) => ({ name, value }));
      for (const f of fields) if (f?.name) absorb(acc, String(f.name), "", f.value);
      return embedLead("hubspot", done(acc));
    }
    let host = "";
    try {
      host = new URL(e.origin).hostname;
    } catch {
      return;
    }
    const vendor = vendorOf(host);
    if (!vendor) return;
    let s = "";
    try {
      s = typeof d === "string" ? d : JSON.stringify(d);
    } catch {
      return;
    }
    if (s && SUBMIT_MSG.test(s.slice(0, 2000))) embedLead(vendor, undefined, vendor === "calendly" || vendor === "acuity" ? "booking" : "form");
  }

  /** Finds embedded forms; with data-embed-params="on" passes the visitor id + click ids into them (for CRM hidden fields). */
  function scanEmbeds(): string[] {
    const out = new Set<string>();
    document.querySelectorAll<HTMLIFrameElement>("iframe[src]").forEach((fr) => {
      let u: URL;
      try {
        u = new URL(fr.src, location.href);
      } catch {
        return;
      }
      const v = vendorOf(u.hostname);
      if (!v) return;
      out.add(v);
      if (!EMBED_PARAMS || !granted() || fr.hasAttribute("data-ose-p") || u.searchParams.has("ose_visitor")) return;
      fr.setAttribute("data-ose-p", "1");
      const a = attribution();
      const add: Dict = { ose_visitor: store.v };
      for (const k of ["gclid", "gbraid", "wbraid", "msclkid", "utm_source", "utm_campaign"]) if (a[k]) add[k] = a[k];
      if (v === "typeform") {
        const h = new URLSearchParams(u.hash.slice(1)); // Typeform hidden fields live in the hash
        for (const k in add) h.set(k, add[k]);
        u.hash = h.toString();
      } else for (const k in add) u.searchParams.set(k, add[k]);
      fr.src = u.toString();
    });
    if (document.querySelector(".hs-form,.hbspt-form,.hs-form-frame")) out.add("hubspot");
    return [...out];
  }

  // ---- diagnostics ping (no personal data: form names, field names, embed vendors) -----------
  function scanForms() {
    return Array.from(document.forms)
      .filter((f) => !skip(f))
      .slice(0, 20)
      .map((f) => {
        const keys: string[] = [];
        let e = false, t = false;
        for (const el of Array.from(f.elements) as HTMLInputElement[]) {
          const k = fieldKey(el);
          if (!k || el.type === "hidden" || el.type === "submit" || el.type === "button" || isSensitive(el, k)) continue;
          if (el.type === "email" || /e-?mail/i.test(k)) e = true;
          if (el.type === "tel" || /phone|mobile/i.test(k)) t = true;
          if (keys.length < 25 && !keys.includes(k)) keys.push(k.slice(0, 48));
        }
        return { n: formName(f), k: keys, e, t };
      });
  }
  let lastSig = -1;
  let pings = 0;
  function ping() {
    const forms = scanForms();
    const embeds = EMBEDS ? scanEmbeds() : [];
    const sig = forms.length + embeds.length * 100;
    if (sig <= lastSig || pings >= 3) return;
    lastSig = sig;
    const id = location.pathname + "#" + sig;
    const canStore = granted();
    let seen: string[] = [];
    if (canStore) {
      try {
        seen = JSON.parse(sessionStorage.getItem("_ose_p") || "[]");
      } catch {}
      if (seen.includes(id)) return;
      try {
        sessionStorage.setItem("_ose_p", JSON.stringify([...seen, id].slice(-50)));
      } catch {}
    }
    pings++;
    send({ t: "ping", p: { path: location.pathname.slice(0, 200), forms, embeds } });
  }

  function bind() {
    document.addEventListener("submit", onSubmit, true); // capture phase: observe only, never preventDefault
    addEventListener("pagehide", () => pendings.slice().forEach((p) => finish(p, "navigated")));
    if (EMBEDS) {
      addEventListener("message", onMessage);
      addEventListener("hs-form-event:on-submission:success", () => embedLead("hubspot")); // HubSpot developer embeds
    }
    // Hidden fields on every form, including forms rendered later (popups, SPAs, page builders).
    const fill = () => document.querySelectorAll("form").forEach((f) => !skip(f) && injectHidden(f));
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        fill();
        ping();
      }, 500);
    };
    const start = () => {
      fill();
      setTimeout(ping, 1500);
      if (typeof MutationObserver === "function") new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }

  // ---- SPA support -------------------------------------------------------------
  function watchHistory() {
    const wrap = (fn: "pushState" | "replaceState") => {
      const orig = history[fn];
      history[fn] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const r = orig.apply(this, args);
        setTimeout(() => {
          capture();
          lastSig = -1;
          pings = 0;
          setTimeout(ping, 1500);
        }, 0);
        return r;
      } as History["pushState"];
    };
    wrap("pushState");
    wrap("replaceState");
    addEventListener("popstate", capture);
  }

  const api: OseApi = {
    version: VERSION,
    lead: (d) => send({ t: "lead", a: attribution(), l: { answers: {}, via: "api", ...d } }, true),
    identify: (d) => {
      // Identity is only sent with a lead; nothing is stored in the browser.
      void d;
    },
    consent: (c) => {
      store.c = { ...(store.c || {}), ...c } as Dict;
      flush();
    },
    debug: () => ({ store, events, pending: pendings.length, forms: scanForms().length, embeds: scanEmbeds() }),
  };

  const queued = window.ose?.q || [];
  window.ose = api;
  capture();
  bind();
  watchHistory();
  if (CONSENT_REQUIRED && !granted()) {
    // Watch the CMP's Consent Mode updates for up to 10 minutes.
    let n = 0;
    const t = setInterval(() => {
      if (granted() || ++n > 600) {
        clearInterval(t);
        flush();
      }
    }, 1000);
  }
  for (const [m, ...args] of queued) (api as unknown as Record<string, (...a: unknown[]) => unknown>)[m as string]?.(...args);
})();

export {};
