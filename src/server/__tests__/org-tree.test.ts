import { describe, expect, it } from "vitest";
import { chainOf, descendantsOf, type OrgNode } from "@/lib/org-tree";

const n = (id: string, parent_id: string | null, type: OrgNode["type"] = "partner"): OrgNode => ({ id, parent_id, type, name: id, slug: id, brand: null, custom_domain: null, tag_domain: null, settings: null });
const tree = [n("p", null, "platform"), n("a", "p"), n("a1", "a", "direct"), n("b", "p"), n("a1x", "a1", "direct")];

describe("org tree (cached, replaces per-level queries)", () => {
  it("chain is root → leaf", () => {
    expect(chainOf(tree, "a1x").map((o) => o.id)).toEqual(["p", "a", "a1", "a1x"]);
  });
  it("descendants include the org itself and every level below", () => {
    expect(descendantsOf(tree, "a").sort()).toEqual(["a", "a1", "a1x"]);
    expect(descendantsOf(tree, "b")).toEqual(["b"]);
  });
});
