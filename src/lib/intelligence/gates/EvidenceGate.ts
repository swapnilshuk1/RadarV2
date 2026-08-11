import { EvaluationStatus, Recommendation } from "../../domain/semantic";

export interface EvidenceGateResult {
  evaluationStatus: EvaluationStatus;
  recommendation: Recommendation;
  priorityScore: number | null;
  structuralConviction: boolean;
  uiLabel: string;
  reason?: string;
  isSparse: boolean;
}

export class EvidenceGate {
  public static evaluate(
    jobText: string,
    roleTitle: string = "",
    companyName: string = ""
  ): EvidenceGateResult {
    const text = (jobText || "").trim();
    const words = text.length > 0 ? text.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;

    // Check if text is sparse (< 25 words)
    if (wordCount < 25) {
      const textLower = (roleTitle + " " + companyName + " " + text).toLowerCase();
      
      // Minimal high-confidence identity check: Is role clearly non-commercial / administrative / technical?
      const nonCommercialKeywords = [
        "software engineer", "developer", "full stack", "frontend", "backend", "architect",
        "qa engineer", "devops", ".net", "bim", "medical", "superintendent", "chartered accountant",
        "tax manager", "legal counsel", "recruitment manager", "hr executive", "cto", "resin",
        "power electronics", "quality director", "clinical", "administration manager", "facilities manager"
      ];

      const isNonCommercial = nonCommercialKeywords.some(kw => textLower.includes(kw));

      if (isNonCommercial) {
        return {
          evaluationStatus: "EVALUATED",
          recommendation: "PASS",
          priorityScore: 0,
          structuralConviction: false,
          uiLabel: "Pass",
          reason: "Sparse text identified as non-commercial or administrative role.",
          isSparse: true
        };
      }

      // Sparse but potentially relevant commercial / growth role
      return {
        evaluationStatus: "SPARSE_SPEC",
        recommendation: null,
        priorityScore: null,
        structuralConviction: false,
        uiLabel: "Needs More Signal",
        reason: "The available posting is too limited (< 25 words) to determine commercial scope or capability fit without guessing.",
        isSparse: true
      };
    }

    // Sufficient evidence
    return {
      evaluationStatus: "EVALUATED",
      recommendation: null,
      priorityScore: 0,
      structuralConviction: false,
      uiLabel: "Evaluated",
      isSparse: false
    };
  }
}
