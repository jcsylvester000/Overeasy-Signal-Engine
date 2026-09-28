import "server-only";
import { admin } from "@/lib/supabase/admin";

/**
 * All organizations in one query, kept in memory for 30 s per server instance.
 * Brand resolution, MFA policy and team scope walk this tree instead of doing one database
 * round trip per parent organization. Writes to organizations call invalidateOrgTree().
 */
export type OrgNode = {
  id: string;
  parent_id: string | null;
  type: "platform" | "partner" | "direct";
  name: string;
  slug: string;
  brand: Record<string, unknown> | null;
  custom_domain: string | null;
  tag_domain: string | null;
  settings: Record<string, unknown> | null;
};

const TTL = 30_000;
let cached: { at: number; nodes: OrgNode[] } | null = null;
let inflight: Promise<OrgNode[]> | null = null;

export function invalidateOrgTree() {
  cached = null;
}

export async function orgTree(): Promise<OrgNode[]> {
  if (cached && Date.now() - cached.at < TTL) return cached.nodes;
  inflight ??= (async () => {
    try {
      const { data, error } = await admin().from("organizations").select("id,parent_id,type,name,slug,brand,custom_domain,tag_domain,settings");
      if (error) throw new Error(error.message);
      const nodes = (data ?? []) as OrgNode[];
      cached = { at: Date.now(), nodes };
      return nodes;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Root → leaf chain for an organization (max 6 levels). */
export function chainOf(nodes: OrgNode[], orgId: string): OrgNode[] {
  const out: OrgNode[] = [];
  let cur = nodes.find((o) => o.id === orgId);
  for (let i = 0; cur && i < 6; i++) {
    out.unshift(cur);
    const parent: string | null = cur.parent_id;
    cur = parent ? nodes.find((o) => o.id === parent) : undefined;
  }
  return out;
}

export function descendantsOf(nodes: OrgNode[], orgId: string): string[] {
  const out = [orgId];
  for (let i = 0; i < out.length && i < 1000; i++) for (const o of nodes) if (o.parent_id === out[i] && !out.includes(o.id)) out.push(o.id);
  return out;
}

const ROLE_RANK: Record<string, number> = { owner: 5, admin: 4, manager: 3, analyst: 2, client_viewer: 1 };

/**
 * Effective org-level rank per organization for a user (same rule as app.org_rank: the highest
 * org-wide role held on the organization or any ancestor). One query + the cached tree.
 */
export async function orgRanksFor(userId: string): Promise<Map<string, number>> {
  const [nodes, { data }] = await Promise.all([orgTree(), admin().from("memberships").select("org_id,role").eq("user_id", userId).is("workspace_id", null)]);
  const direct = new Map<string, number>();
  for (const m of data ?? []) direct.set(m.org_id as string, Math.max(direct.get(m.org_id as string) ?? 0, ROLE_RANK[m.role as string] ?? 0));
  const out = new Map<string, number>();
  for (const o of nodes) out.set(o.id, Math.max(0, ...chainOf(nodes, o.id).map((c) => direct.get(c.id) ?? 0)));
  return out;
}
