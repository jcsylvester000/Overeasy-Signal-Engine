# Tag patch proposal: support GTM-injected loading

**File:** `src/tag/ose.ts` (not modified by the integrations work; apply separately)

## Problem

The GTM Custom Template loads the tag with the sandboxed `injectScript` API. That API
cannot set attributes on the `<script>` element, so `data-site` is missing. As a result:

1. `SITE` resolves to `""`, so every event is sent without a site key.
2. When `document.currentScript` is `null`, the fallback selector
   `script[data-site][src*='ose.js']` never matches, so the tag exits without running.

The template works around the missing attribute by setting `window.oseConfig = { site }`
**before** injecting `https://{tagHost}/ose.js?site={siteKey}`.

## Change (3 edits, backwards compatible)

```diff
 declare global {
   interface Window {
     ose?: OseApi & { q?: unknown[][] };
     dataLayer?: unknown[];
+    oseConfig?: { site?: string };
   }
 }
@@
 (function () {
   const VERSION = "1.0.0";
-  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>("script[data-site][src*='ose.js']");
+  const script =
+    (document.currentScript as HTMLScriptElement | null) ??
+    document.querySelector<HTMLScriptElement>("script[data-site][src*='ose.js']") ??
+    document.querySelector<HTMLScriptElement>("script[src*='/ose.js']"); // GTM injectScript: no data-site
   if (!script || window.ose?.version) return;
-  const SITE = script.getAttribute("data-site") || "";
+  const SITE =
+    script.getAttribute("data-site") ||
+    window.oseConfig?.site ||
+    new URL(script.src).searchParams.get("site") ||
+    "";
   const ENDPOINT = new URL("/v1/collect", script.src).toString();
```

`ENDPOINT` needs no textual change: it is already derived from `script.src`, and with the
new third selector `script` is now the injected `script[src*='/ose.js']` element, so the
collect endpoint stays on the same tag host the template injected from.

## Precedence

`data-site` attribute (hand-installed snippet) > `window.oseConfig.site` (GTM template) >
`?site=` query parameter on the script URL (extra safety net) > empty string.

## Optional hardening

- Skip start-up when no site key is found, to avoid anonymous traffic:
  `if (!SITE) return;` directly after the `SITE` line.
- Add a unit test that injects a script without `data-site`, sets
  `window.oseConfig = { site: "site_test123" }`, and asserts the beacon body has
  `k: "site_test123"`.
