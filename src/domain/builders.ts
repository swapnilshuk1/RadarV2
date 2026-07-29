// src/domain/builders.ts
import { CandidateProjection } from "../lib/domain/candidate_projection";
import { CandidateProfile } from "./candidate";

export interface ICandidateProjectionBuilder {
  fromProfile(profile: CandidateProfile): CandidateProjection;
}
