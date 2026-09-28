import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { clientIp, json, notConfigured, problem, rateLimited } from "@/lib/api/http";
import { Attribution, Consent, intakeLead } from "@/server/intake";

export const dynamic = "force-dynamic";

/**
 * POST /v1/collect — beacons from the website tag (visit, lead). Public endpoint: authenticated by
 * site key + Origin allow-list, rate-limited per IP and site. Sent as text/plain to avoid CORS preflight.
 */
const Beacon = z.object({
  k: z.string().min(8).max(64), // site key
  t: z.enum(["visit", "lead"]),
  v: z.string().min(8).max(64), // visitor id
  tv: z.string().max(20).optional(), // tag version
  a: Attribution.optional(),
  c: Consent.optional(),
  l: z
    .object({
      form: z.string().max(100).optional(),
      email: z.string().max(320).nullish(),
      phone: z.string().max(40).nullish(),
      name: z.string().max(200).nullish(),
      geo: z.string().max(100).nullish(),
      answers: z.record(z.string().max(48), z.union([z.string().max(500), z.number(), z.null()])).default({}),
      test: z.boolean().optional(),
    })
    .optional(),
});

type Site = { id: string; workspace_id: string; allowed_origins: string[] };

function cors(origin: string | null) {
  return origin ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } : undefined;
}

function originAllowed(site: Site, origin: string | null): boolean {
  if (!site.allowed_origins?.length) return true; // not yet restricted (install check will warn)
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return site.allowed_origins.some((o) => o === origin || o === host || (o.startsWith("*.") && host.endsWith(o.slice(1))));
  } catch {
    return false;
  }
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  const nc = notConfigured();
  if (nc) return nc;
  if (rateLimited(`collect:ip:${clientIp(req)}`, 120)) return problem(429, "Too many requests", h);

  const raw = await req.text();
  if (raw.length > 32_000) return problem(413, "Too large", h);
  let parsed;
  try {
    parsed = Beacon.safeParse(JSON.parse(raw));
  } catch {
    return problem(400, "Invalid JSON", h);
  }
  if (!parsed.success) return problem(422, "Invalid beacon", h);
  const b = parsed.data;

  const db = admin();
  const { data: site } = await db.from("sites").select("id,workspace_id,allowed_origins").eq("site_key", b.k).maybeSingle<Site>();
  if (!site) return problem(404, "Unknown site", h);
  if (!originAllowed(site, origin)) return problem(403, "Origin not allowed", h);
  if (rateLimited(`collect:site:${site.id}`, 3000)) return problem(429, "Too many requests", h);

  await db.from("sites").update({ last_event_at: new Date().toISOString(), ...(b.tv ? { tag_version: b.tv } : {}) }).eq("id", site.id);

  if (b.t === "visit") {
    const a = b.a ?? {};
    const hasTouch = Boolean(a.gclid || a.gbraid || a.wbraid || a.msclkid || a.fbclid || a.utm_source || a.utm_campaign);
    if (!hasTouch) return json({ ok: true, recorded: false }, 200, h);
    const row = { workspace_id: site.workspace_id, site_id: site.id, visitor_id: b.v, ...a, click_ts: a.click_ts ?? new Date().toISOString(), consent: b.c ?? {} };
    const { data: firstExists } = await db.from("visits").select("id").eq("site_id", site.id).eq("visitor_id", b.v).eq("touch", "first").limit(1).maybeSingle();
    // First touch is never overwritten; every new ad touch becomes the latest last touch (CAP-02).
    if (!firstExists) await db.from("visits").insert({ ...row, touch: "first" });
    await db.from("visits").insert({ ...row, touch: "last" });
    return json({ ok: true, recorded: true }, 200, h);
  }

  if (!b.l) return problem(422, "Missing lead payload", h);
  const result = await intakeLead({
    workspaceId: site.workspace_id,
    siteId: site.id,
    source: "tag",
    visitor_id: b.v,
    form: b.l.form,
    email: b.l.email,
    phone: b.l.phone,
    name: b.l.name,
    geo: b.l.geo,
    answers: b.l.answers,
    attribution: b.a,
    consent: b.c,
    test: b.l.test,
  });
  // The browser gets the lead id and score so the site's thank-you tag can fire a valued conversion with the same transaction id.
  return json({ ok: true, lead_id: result.lead_id, score: result.score, lead_type: result.lead_type }, 200, h);
}
