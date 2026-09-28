import { describe, expect, it } from "vitest";
import { flattenWorkflowPayload, workflowFields } from "../webhooks";

describe("CRM workflow payload parsing", () => {
  it("reads GHL-style payload with customData taking priority", () => {
    const f = workflowFields(
      flattenWorkflowPayload({
        contact_id: "c123",
        email: "Seller@Example.com",
        phone: "+18285550100",
        full_name: "Jane Seller",
        pipeline_stage: "Under Contract",
        opportunity: { id: "o9", pipeline_name: "Seller Pipeline", monetary_value: 18000 },
        customData: { stage: "contract", value: "18,000" },
        attributionSource: { gclid: "Cj0K" },
      }),
    );
    expect(f).toMatchObject({ stage: "contract", contactId: "c123", email: "Seller@Example.com", value: "18,000", pipeline: "Seller Pipeline" });
    expect(f.attribution).toEqual({ gclid: "Cj0K" });
  });
  it("falls back to the CRM's stage name when no custom stage is sent", () => {
    const f = workflowFields(flattenWorkflowPayload({ id: "c1", pipleline_stage: "Offer Sent", status: "open" }));
    expect(f.stage).toBe("Offer Sent");
    expect(f.contactId).toBe("c1");
    expect(f.pipeline).toBe("default");
  });
});
