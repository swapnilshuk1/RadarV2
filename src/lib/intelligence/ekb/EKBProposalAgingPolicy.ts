// src/lib/intelligence/ekb/EKBProposalAgingPolicy.ts

export interface KnowledgeDebtRecord {
  id: string;
  termOrNode: string;
  debtCategory: "COMPILER_REJECTION" | "AMBIGUOUS_ALIAS" | "LOW_CONFIDENCE";
  diagnosticMessage: string;
  status: "ACTIVE" | "RESOLVED" | "EXPIRED";
}

export class EKBProposalAgingPolicy {
  private static knowledgeDebt: KnowledgeDebtRecord[] = [];

  /**
   * Adaptive Evidence Threshold Calculator:
   * Niche roles (e.g. "Chief Quantum Architect") require fewer document occurrences (e.g. 2 docs)
   * Universal roles (e.g. "Leadership") require higher document occurrences (e.g. 50 docs).
   */
  public static calculateAdaptiveThreshold(termName: string, domainRarity: "NICHE" | "UNIVERSAL" | "STANDARD" = "STANDARD"): number {
    if (domainRarity === "NICHE") return 2;
    if (domainRarity === "UNIVERSAL") return 30;
    return 5; // Standard domain threshold
  }

  /**
   * Validates relationship edge bounds without silent clipping.
   * If edge cost > 0.80 or < 0.05, it REJECTS the edge and logs Knowledge Debt!
   */
  public static validateEdgeCostStrict(source: string, target: string, proposedCost: number): { valid: boolean; debtReason?: string } {
    if (proposedCost < 0.05 || proposedCost > 0.80) {
      const debtId = `debt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const debtRecord: KnowledgeDebtRecord = {
        id: debtId,
        termOrNode: `${source} -> ${target}`,
        debtCategory: "COMPILER_REJECTION",
        diagnosticMessage: `Relationship cost ${proposedCost.toFixed(2)} out of DAG bounds [0.05, 0.80]. Proposal rejected rather than silently clipped.`,
        status: "ACTIVE",
      };
      this.knowledgeDebt.push(debtRecord);
      return { valid: false, debtReason: debtRecord.diagnosticMessage };
    }
    return { valid: true };
  }

  public static getActiveKnowledgeDebt(): KnowledgeDebtRecord[] {
    return this.knowledgeDebt.filter((d) => d.status === "ACTIVE");
  }
}
