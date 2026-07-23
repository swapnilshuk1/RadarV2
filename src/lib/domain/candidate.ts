export interface Evidence {
  id: string;
  sourceId: string;
  text: string;
  section?: string;
  qualityScore: number;
  createdAt: string;
}

export interface Claim {
  statement: string;
  confidence: number;
  evidenceIds: string[];
}

export interface CandidateProjection {
  id: string;
  personId: string;
  timeline: Array<{
    id: string;
    role: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    description?: string;
  }>;
  skills: string[];
  claims: Claim[];
  updatedAt: string;
}
