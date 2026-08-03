import type { Opportunity } from "../../../data/opportunity-fixtures";

export type OrganizationType = "founder_led" | "institutional" | "private_equity" | "public_company";
export type TransformationStage = "none" | "modernization" | "turnaround";
export type ScoreTier = "HIGH" | "MEDIUM" | "LOW";

export interface EditorialContext {
  organizationType: OrganizationType;
  transformationStage: TransformationStage;
  hasPnlOwnership: boolean;
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
    const isTurnaround = narrativeLower.includes("turnaround") || narrativeLower.includes("restructure");
    const isModernization = narrativeLower.includes("transformation") || narrativeLower.includes("digitiz") || narrativeLower.includes("moderniz");

    let transformationStage: TransformationStage = "none";
    if (isTurnaround) transformationStage = "turnaround";
    else if (isModernization) transformationStage = "modernization";

    // Check P&L ownership
    const hasPnlOwnership =
      narrativeLower.includes("p&l") ||
      narrativeLower.includes("commercial") ||
      narrativeLower.includes("revenue") ||
      narrativeLower.includes("budget") ||
      roleLower.includes("cmo") ||
      roleLower.includes("cgo") ||
      roleLower.includes("vp");

    return {
      organizationType,
      transformationStage,
      hasPnlOwnership,
      scoreTier,
      rawScore
    };
  }
}
