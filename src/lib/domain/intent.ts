export interface CandidateIntent {
  id: string;
  candidateId: string;
  desiredRoles: string[];
  preferredLocations: string[];
  salaryBand: {
    min: number;
    max: number;
    currency: string;
  };
  industries: string[];
  updatedAt: string;
}
