import raw from "./candidate-profile.json";
import { CandidateProfile as DomainCandidateProfile } from "../domain/candidate";

// Cast the raw JSON directly to the new formal domain type
export const candidateProfile = raw as unknown as DomainCandidateProfile;
export type CandidateProfile = DomainCandidateProfile;
