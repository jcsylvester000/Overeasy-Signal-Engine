"use client";

import { useState } from "react";
import { cn } from "./ui";

export function CopyBlock({ text, dark = true }: { text: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className={cn("overflow-x-auto rounded p-3 pr-20 text-xs", dark ? "bg-gray-900 text-gray-100" : "bg-gray-50")}>{text}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded border border-gray-500 bg-white/90 px-2 py-0.5 text-xs text-gray-900 hover:bg-white"
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type Platform = { id: string; label: string; steps: string[]; note?: string };

// Menu names change over time; the steps name the setting to look for.
const PLATFORMS: Platform[] = [
  { id: "html", label: "Any website", steps: ["Open the site's main template or layout file.", "Paste the snippet just before </head> so it loads on every page.", "Publish, then open the site: the status above turns green within seconds."] },
  {
    id: "wordpress",
    label: "WordPress",
    steps: ["Option A: install our WordPress plugin (Plugins → Add New → Upload), then enter the site key in Settings → Signal Engine.", "Option B: with a header/footer code plugin (for example WPCode), add the snippet to the site-wide header.", "Clear any caching plugin, then open the site."],
    note: "Works with Contact Form 7, Elementor, Gravity Forms, WPForms, Formidable and Ninja Forms: their success messages confirm each lead.",
  },
  {
    id: "gtm",
    label: "Google Tag Manager",
    steps: ["Tags → New → Custom HTML, paste the snippet.", "Trigger: All Pages (or Consent Initialization if your consent banner runs through Tag Manager).", "Submit and publish the container.", "Or import our Tag Manager template and enter the site key."],
  },
  { id: "webflow", label: "Webflow", steps: ["Site settings → Custom code → Head code: paste the snippet.", "Save and publish the site."], note: "Webflow custom code needs a paid site plan. Webflow form success messages (.w-form-done) are detected automatically." },
  { id: "wix", label: "Wix", steps: ["Settings → Custom code (under Advanced) → Add custom code.", "Paste the snippet, apply to All pages, place in Head, load once.", "Publish."], note: "Wix needs a premium plan with a connected domain for custom code. Wix forms that render in an iframe are counted when their success message appears on the page." },
  { id: "shopify", label: "Shopify", steps: ["Online Store → Themes → … → Edit code → layout/theme.liquid.", "Paste the snippet just before </head>, then save."], note: "Checkout pages do not run theme code; the tag tracks contact and quote forms, not purchases." },
  { id: "squarespace", label: "Squarespace", steps: ["Settings → Developer tools (or Advanced) → Code injection → Header.", "Paste the snippet and save."], note: "Code injection is only available on plans that include it." },
  { id: "ghl", label: "GoHighLevel sites & funnels", steps: ["Site or funnel Settings → Tracking code → Header code: paste the snippet.", "For GHL forms embedded on another website, add data-embed-params=\"on\" to the snippet and add a hidden field named ose_visitor to the GHL form, then send it in the CRM workflow webhook. The website visit and the CRM contact then merge into one lead."] },
];

export function InstallGuide({ snippet }: { snippet: string }) {
  const [tab, setTab] = useState("html");
  const p = PLATFORMS.find((x) => x.id === tab) ?? PLATFORMS[0];
  return (
    <div>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Where is the site built?">
        {PLATFORMS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === tab}
            onClick={() => setTab(x.id)}
            className={cn("rounded px-2 py-1 text-xs", x.id === tab ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <CopyBlock text={snippet} />
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        {p.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {p.note && <p className="mt-2 text-xs text-muted">{p.note}</p>}
    </div>
  );
}
