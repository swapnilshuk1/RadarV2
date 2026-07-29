export interface DecisionLog {
  id: string;
  candidateId: string;
  jobHash: string;
  action: "PURSUE" | "CONSIDER" | "PASS" | "UNDECIDED";
  reflection?: string; // The user-provided journaling note explaining their call
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  candidateId: string;
  jobHash: string;
  stage: "SCRAPED" | "APPLIED" | "SCREENING" | "TECHNICAL" | "FINAL_ROUND" | "OFFER" | "REJECTED";
  notes?: string;
  createdAt: string;
}
