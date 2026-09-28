import "server-only";

/**
 * Custom domains for white-label partners (ADM-03), hosted on Netlify: add the partner's app/tag domain as a
 * domain alias of this site; Netlify provisions TLS once the partner's CNAME points at the site.
 * Needs NETLIFY_AUTH_TOKEN (personal access token) and NETLIFY_SITE_ID. Without them this is a no-op.
 */
export async function addDomainAliases(domains: (string | null | undefined)[]): Promise<{ ok: boolean; message: string }> {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const site = process.env.NETLIFY_SITE_ID;
  const wanted = domains.filter((d): d is string => Boolean(d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)));
  if (!wanted.length) return { ok: true, message: "No domains to add." };
  if (!token || !site) return { ok: false, message: "Domains saved. Automatic setup needs NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID; until then add them in Netlify → Domain management." };
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const cur = await fetch(`https://api.netlify.com/api/v1/sites/${site}`, { headers: h });
  if (!cur.ok) return { ok: false, message: `Netlify API ${cur.status}` };
  const siteJson = (await cur.json()) as { domain_aliases?: string[]; default_domain?: string };
  const aliases = Array.from(new Set([...(siteJson.domain_aliases ?? []), ...wanted]));
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${site}`, { method: "PATCH", headers: h, body: JSON.stringify({ domain_aliases: aliases }) });
  if (!res.ok) return { ok: false, message: `Netlify API ${res.status}` };
  return { ok: true, message: `Added to Netlify. Point a CNAME for ${wanted.join(", ")} to ${siteJson.default_domain ?? "the site's netlify.app address"}; TLS is issued automatically.` };
}
