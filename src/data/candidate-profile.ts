import raw from "./candidate-profile.json";

export type CandidateEvidence = { type: string; proof: string };
export type CandidateProfile = typeof raw & {
  evidence: CandidateEvidence[];
  executiveCompetencies?: string[];
  preferences?: { remote?: string; [key: string]: any };
  strategy?: any;
  capabilities?: Record<string, string[]>;
};

export const candidateProfile = raw as unknown as CandidateProfile;
