import { EvidenceSufficiency } from "../../domain/semantic";

export class EvidenceRichnessCalculator {
  public static calculate(opportunity: any): { sufficiency: EvidenceSufficiency; count: number } {
    if (!opportunity || !Array.isArray(opportunity.dimensions)) {
      return { sufficiency: "INSUFFICIENT", count: 0 };
    }

    let extractedCount = 0;
    opportunity.dimensions.forEach((dim: any) => {
      if (dim.jdEvidence && dim.jdEvidence.value !== null && dim.jdEvidence.status !== "Missing") {
        extractedCount++;
      }
    });

    return {
      sufficiency: extractedCount >= 4 ? "SUFFICIENT" : "INSUFFICIENT",
      count: extractedCount
    };
  }
}
