import { describe, expect, it } from "vitest";
import { brandCssVars, brandFromChain } from "@/lib/brand";

const platform = { id: "p", parent_id: null, type: "platform", brand: {} };
const partner = { id: "a", parent_id: "p", type: "partner", brand: { appName: "Agency Leads", primary: "#123456" } };
const partnerNoBrand = { id: "b", parent_id: "p", type: "partner", brand: {} };
const direct = { id: "d", parent_id: "p", type: "direct", brand: {} };

describe("platform brand vs white-label", () => {
  it("direct clients get the Overeasy brand", () => {
    const b = brandFromChain([platform, direct], "d");
    expect(b.logoUrl).toBe("/brand/overeasy-logo.svg");
    expect(b.theme).toBe("overeasy");
    expect(brandCssVars(b)).toContain("Work Sans");
  });
  it("partners never inherit the Overeasy name, logo or theme", () => {
    const b = brandFromChain([platform, partner], "a");
    expect(b.appName).toBe("Agency Leads");
    expect(b.logoUrl).toBeUndefined();
    expect(b.theme).toBeUndefined();
    const n = brandFromChain([platform, partnerNoBrand], "b");
    expect(n.appName).not.toMatch(/overeasy/i);
    expect(n.logoUrl).toBeUndefined();
    expect(brandCssVars(n)).not.toContain("Work Sans");
  });
});
