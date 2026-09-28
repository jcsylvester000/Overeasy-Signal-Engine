import "server-only";

export type InstallCheck = {
  at: string;
  url: string;
  status: "found" | "wrong_key" | "via_tag_manager" | "not_found" | "unreachable";
  detail: string;
  http?: number;
};

/** Pure: reads a page's HTML for the tag snippet. Exported for tests. */
export function inspectHtml(html: string, siteKey: string): Pick<InstallCheck, "status" | "detail"> {
  const tags = html.match(/<script\b[^>]*ose\.js[^>]*>/gi) ?? [];
  if (tags.some((t) => t.includes(siteKey))) return { status: "found", detail: "The tag with this site key is in the page HTML." };
  if (tags.length) return { status: "wrong_key", detail: "A Signal Engine tag is on the page, but with a different site key. Copy the snippet for this site again." };
  if (/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(html))
    return { status: "via_tag_manager", detail: "Google Tag Manager is on the page, so the tag may load through it. Open the site in a browser: the live status above turns green within seconds." };
  return { status: "not_found", detail: "The tag is not in the page HTML. Paste the snippet before </head> and publish the site." };
}

function safeUrl(domain: string): URL | null {
  try {
    const u = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);
    const h = u.hostname;
    // Only public host names (no IPs, localhost or internal names): this runs server-side.
    if (u.protocol !== "https:" || !h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)(localhost|local|internal|lan)$/i.test(h)) return null;
    return u;
  } catch {
    return null;
  }
}

/** Fetches the site's home page (8 s, 2 MB max) and looks for the tag. */
export async function checkInstall(domain: string, siteKey: string): Promise<InstallCheck> {
  const at = new Date().toISOString();
  const u = safeUrl(domain);
  if (!u) return { at, url: domain, status: "unreachable", detail: "The domain is not a public https address." };
  try {
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "SignalEngine-InstallCheck/1.0", accept: "text/html" } });
    const text = (await res.text()).slice(0, 2_000_000);
    if (!res.ok) return { at, url: u.toString(), status: "unreachable", http: res.status, detail: `The site answered HTTP ${res.status}.` };
    return { at, url: res.url || u.toString(), http: res.status, ...inspectHtml(text, siteKey) };
  } catch (e) {
    return { at, url: u.toString(), status: "unreachable", detail: `Could not load the site (${String((e as Error).message ?? e).slice(0, 120)}).` };
  }
}
