import type { ScoringModel } from "../scoring/types";
import type { ValueModel } from "../value/types";
import { landScoring, landValue } from "./land-acquisition";
import { b2bScoring, b2bValue, homeScoring, homeValue, legalScoring, legalValue } from "./others";

export type IndustryTemplate = {
  id: string;
  name: string;
  description: string;
  scoring: ScoringModel;
  value: ValueModel;
  stageEntryRules: Partial<Record<string, string>>;
  /** Regulated vertical (health, legal, financial distress): hashed contact data is never uploaded. */
  regulated?: boolean;
};

/** Industry templates (SCR-05). A template is cloned into a workspace and then owned by that workspace. */
export const TEMPLATES: IndustryTemplate[] = [
  {
    id: "land-acquisition",
    name: "Land acquisition",
    description: "Seller leads for land buyers. Lead types: Title / Probate, Fast Cash, High Value, Low Value.",
    scoring: landScoring,
    value: landValue,
    stageEntryRules: {
      qualified: "Seller reached, owns the parcel, open to an offer.",
      opportunity: "Parcel checked (comps, access) and an offer is being prepared.",
      contract: "Purchase agreement signed by the seller.",
      sold: "Assigned / resold to an end buyer.",
      funded: "Funds received.",
    },
  },
  {
    id: "home-services",
    name: "Home services",
    description: "HVAC, roofing, solar, remodelling quote requests.",
    scoring: homeScoring,
    value: homeValue,
    stageEntryRules: { qualified: "Homeowner confirmed, in service area.", opportunity: "Site visit booked.", contract: "Quote accepted.", funded: "Job paid." },
  },
  {
    id: "legal",
    name: "Legal intake",
    description: "Case intake for law firms (contingency or retainer).",
    scoring: legalScoring,
    value: legalValue,
    regulated: true,
    stageEntryRules: { qualified: "Passed intake screen.", opportunity: "Consultation held.", contract: "Engagement signed.", funded: "Fee collected." },
  },
  {
    id: "b2b-services",
    name: "B2B services",
    description: "Demo or quote requests for service businesses and SaaS.",
    scoring: b2bScoring,
    value: b2bValue,
    stageEntryRules: { qualified: "Meets ICP, meeting booked.", opportunity: "Proposal sent.", contract: "Signed.", funded: "First invoice paid." },
  },
];

export function getTemplate(id: string | null | undefined): IndustryTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
