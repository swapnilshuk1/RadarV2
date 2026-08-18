import { EvidenceSufficiency } from "../../domain/semantic";

export interface EvidenceRichnessResult {
  sufficiency: EvidenceSufficiency;
  count: number;
  structuralSignalsCount: number;
}

export class EvidenceRichnessCalculator {
  private static readonly STRUCTURAL_DIM_KEYS = new Set([
    "functionalScope",
    "mandate",
    "operatingLevel",
    "decisionAuthority",
    "commercialScope",
    "reportingLine",
    "teamSize",
    "pnlOwnership",
    "budgetOwnership",
    "compensation"
  ]);

  public static calculate(opportunity: any): EvidenceRichnessResult {
    if (!opportunity || !Array.isArray(opportunity.dimensions)) {
      return { sufficiency: "INSUFFICIENT", count: 0, structuralSignalsCount: 0 };
    }

    let extractedCount = 0;
    let structuralSignalsCount = 0;

    opportunity.dimensions.forEach((dim: any) => {
      const jdEv = dim?.jdEvidence;
      if (!jdEv) return;
      if (jdEv.status === "Missing" || jdEv.status === "Missing Evidence") return;

      const val = typeof jdEv.value === "string" ? jdEv.value.trim() : jdEv.value;
      if (val === null || val === undefined || val === "" || val === "UNKNOWN" || val === "Missing" || val === "{}") {
        return;
      }

      extractedCount++;
      if (this.STRUCTURAL_DIM_KEYS.has(dim.key)) {
        structuralSignalsCount++;
      }
    });

    // Decision-relevant sufficiency requires both structural grounding (>= 2 anchors) and minimum extracted count (>= 3)
    const isSufficient = structuralSignalsCount >= 2 && extractedCount >= 3;

    return {
      sufficiency: isSufficient ? "SUFFICIENT" : "INSUFFICIENT",
      count: extractedCount,
      structuralSignalsCount
    };
  }
}
