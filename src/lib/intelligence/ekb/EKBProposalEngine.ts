// src/lib/intelligence/ekb/EKBProposalEngine.ts

export interface EKBProposalPayload {
  id: string;
  proposalType: "NEW_CAPABILITY" | "NEW_ALIAS" | "RELATIONSHIP_DRIFT";
  targetDomain: string;
  proposalJson: string;
  compilerStatus: "PENDING" | "VALIDATED" | "MERGED" | "REJECTED";
  createdAt: string;
}

export class EKBProposalEngine {
  private static proposals: EKBProposalPayload[] = [];

  public static submitProposal(
    proposalType: "NEW_CAPABILITY" | "NEW_ALIAS" | "RELATIONSHIP_DRIFT",
    targetDomain: string,
    data: any
  ): EKBProposalPayload {
    const id = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const proposal: EKBProposalPayload = {
      id,
      proposalType,
      targetDomain,
      proposalJson: JSON.stringify(data),
      compilerStatus: "PENDING",
      createdAt: new Date().toISOString(),
    };

    this.proposals.push(proposal);
    return proposal;
  }

  public static getPendingProposals(): EKBProposalPayload[] {
    return this.proposals.filter((p) => p.compilerStatus === "PENDING");
  }
}
