import { admin } from "@/lib/supabase/admin";
import { clientIp, json, notConfigured, rateLimited } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/diag/latency — where the server functions run and how long one database round trip takes from there.
 * Pages make 1–3 round trips, so this number × 2 is roughly what the database adds to a page load.
 * No data is returned, only timings.
 */
export async function GET(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  if (rateLimited(`diag:${clientIp(req)}`, 10)) return json({ error: "Too many requests" }, 429);
  const db = admin();
  const ms: number[] = [];
  for (let i = 0; i < 4; i++) {
    const t = performance.now();
    await db.from("organizations").select("id").limit(1);
    ms.push(Math.round(performance.now() - t));
  }
  const warm = ms.slice(1);
  return json({
    functionRegion: process.env.AWS_REGION ?? process.env.NETLIFY_REGION ?? "unknown",
    dbRoundTripMs: { first: ms[0], warmMedian: warm.sort((a, b) => a - b)[1], all: ms },
    note: "Under ~20 ms warm = functions and Supabase in the same region. 150+ ms = different continents; set Netlify's Functions region to the Supabase region.",
  });
}
