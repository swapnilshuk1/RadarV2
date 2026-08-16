import type { Opportunity } from "../../../data/opportunity-fixtures";

export type OrganizationType = "founder_led" | "institutional" | "private_equity" | "public_company";
export type TransformationStage = "none" | "modernization" | "turnaround";
export type ScoreTier = "HIGH" | "MEDIUM" | "LOW";

export type ProvenanceSource = "ENGINE_VERIFIED" | "TITLE_HEURISTIC";

export interface EditorialContext {
  organizationType: OrganizationType;
  transformationStage: TransformationStage;
  hasPnlOwnership: boolean;
  pnlProvenance: ProvenanceSource;
  mandateProvenance: ProvenanceSource;
  scoreTier: ScoreTier;
  rawScore: number;
}

export class EditorialContextBuilder {
  public static build(opportunity: Opportunity): EditorialContext {
    const rawScore = opportunity.recommendationResult?.score ?? 50;
    
    // Determine Score Tier
    let scoreTier: ScoreTier = "MEDIUM";
    if (rawScore >= 75 || opportunity.decision === "PURSUE") {
      scoreTier = "HIGH";
    } else if (rawScore < 50 || opportunity.decision === "PASS") {
      scoreTier = "LOW";
    }

    // Check Founder-led indicators
    const companyLower = (opportunity.company || "").toLowerCase();
    const roleLower = (opportunity.role || "").toLowerCase();
    const narrativeLower = ((opportunity.primaryDriver || "") + " " + (opportunity.primaryConcern || "")).toLowerCase();
    
    const isFounderLed =
      narrativeLower.includes("founder") ||
      narrativeLower.includes("promoter") ||
      narrativeLower.includes("owner-led") ||
      roleLower.includes("founder");

    const isPE = narrativeLower.includes("private equity") || narrativeLower.includes("pe-backed");
    const isPublic = narrativeLower.includes("public company") || narrativeLower.includes("listed");

    let organizationType: OrganizationType = "institutional";
    if (isFounderLed) organizationType = "founder_led";
    else if (isPE) organizationType = "private_equity";
    else if (isPublic) organizationType = "public_company";

    // Check Transformation Stage
    let transformationStage: TransformationStage = "none";
    let mandateProvenance: ProvenanceSource = "TITLE_HEURISTIC";

    const mandateDim = opportunity.dimensions?.find(d => d.key === "mandate");
    if (mandateDim && (mandateDim.jdEvidence.status === "Explicit" || mandateDim.jdEvidence.status === "Inferred") && mandateDim.jdEvidence.value) {
      const val = String(mandateDim.jdEvidence.value).toLowerCase();
      if (val.includes("turnaround") || val.includes("restructure")) {
        transformationStage = "turnaround";
      } else if (val.includes("transformation") || val.includes("digitiz") || val.includes("moderniz")) {
        transformationStage = "modernization";
      }
      mandateProvenance = "ENGINE_VERIFIED";
    }

    if (mandateProvenance === "TITLE_HEURISTIC") {
      const isTurnaround = narrativeLower.includes("turnaround") || narrativeLower.includes("restructure");
      const isModernization = narrativeLower.includes("transformation") || narrativeLower.includes("digitiz") || narrativeLower.includes("moderniz");

      if (isTurnaround) transformationStage = "turnaround";
      else if (isModernization) transformationStage = "modernization";
    }

    // Check P&L ownership
    let hasPnlOwnership = false;
    let pnlProvenance: ProvenanceSource = "TITLE_HEURISTIC";

    const commercialAccDim = opportunity.dimensions?.find(d => d.key === "commercialAccountability");
    if (commercialAccDim) {
      const val = commercialAccDim.jdEvidence?.value;
      if (typeof val === "boolean") {
        hasPnlOwnership = val;
        pnlProvenance = "ENGINE_VERIFIED";
      } else if (val !== undefined && val !== null) {
        const strVal = String(val).toLowerCase();
        if (strVal === "false" || strVal === "none" || strVal === "no") {
          hasPnlOwnership = false;
          pnlProvenance = "ENGINE_VERIFIED";
        } else if (strVal === "true" || strVal.includes("p&l") || strVal.includes("profit") || strVal.includes("revenue") || strVal.includes("commercial") || strVal.includes("budget") || strVal.includes("fee-book") || strVal.includes("topline") || strVal.includes("category")) {
          hasPnlOwnership = true;
          pnlProvenance = "ENGINE_VERIFIED";
        }
      }
    }

    if (pnlProvenance === "TITLE_HEURISTIC") {
      hasPnlOwnership =
        narrativeLower.includes("p&l") ||
        narrativeLower.includes("commercial") ||
        narrativeLower.includes("revenue") ||
        narrativeLower.includes("budget") ||
        roleLower.includes("cmo") ||
        roleLower.includes("cgo") ||
        roleLower.includes("vp");
    }

    return {
      organizationType,
      transformationStage,
      hasPnlOwnership,
      pnlProvenance,
      mandateProvenance,
      scoreTier,
      rawScore
    };
  }
}
