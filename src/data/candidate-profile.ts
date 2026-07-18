import raw from "./candidate-profile.json";

export type CandidateEvidence = { type: string; proof: string };
export type CandidateProfile = typeof raw & {
  evidence: CandidateEvidence[];
};

export const candidateProfile = raw as unknown as CandidateProfile;
