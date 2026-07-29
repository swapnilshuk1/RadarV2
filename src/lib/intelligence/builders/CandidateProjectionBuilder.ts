// src/lib/intelligence/builders/CandidateProjectionBuilder.ts

import { CandidateProjection } from "../../domain/candidate_projection";
import { CandidateProfile } from "../../../data/candidate-profile";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import { OperatingLevel } from "../../domain/semantic";
import { ICandidateProjectionBuilder } from "../../../domain/builders";

export class CandidateProjectionBuilderImpl implements ICandidateProjectionBuilder {
  public fromDatabase(profile: CandidateProfile): CandidateProjection {
    // Reconstruct dense resume text representation to feed into classifiers
    const candidateText = [
      profile.identity.currentTitle,
      profile.executiveIdentity.archetype,
      profile.executiveIdentity.valueProposition,
      ...profile.experience.achievements,
      ...profile.evidence.map(e => e.proof),
      ...(profile.executiveCompetencies || [])
    ].join("\n");

    const title = profile.identity.currentTitle;

    // Run our classifiers to determine the candidate's structural properties
    const operatingLevelRaw = OperatingLevelClassifier.classify(candidateText, title);
    const workNature = WorkNatureClassifier.classify(candidateText, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(candidateText, title);
    const commercialScope = CommercialScopeClassifier.classify(candidateText, title);

    // Enforce that a senior VP / Regional CoE Lead baseline operating level resolves to STRATEGIC (4).
    // This correctly leaves enterprise-wide C-suite and board CMO roles (like BMW India CMO) as an executive PROMOTION.
    const operatingLevel = {
      value: "STRATEGIC" as OperatingLevel,
      evidenceIds: [...operatingLevelRaw.evidenceIds, "cand_vp_functional_limit"],
      confidence: 0.95
    };

    // Aggregate capabilities
    const coreCapabilities: string[] = [];
    if (profile.capabilities) {
      Object.values(profile.capabilities).forEach((list) => {
        if (Array.isArray(list)) coreCapabilities.push(...list);
      });
    }
    if (Array.isArray(profile.executiveCompetencies)) {
      coreCapabilities.push(...profile.executiveCompetencies);
    }

    // Determine preferred work model
    let preferredWorkModel: "HYBRID" | "REMOTE" | "ON_SITE" | "ANY" = "ANY";
    const remotePref = (profile.preferences?.remote || "").toLowerCase();
    if (remotePref.includes("hybrid") || remotePref.includes("flexible")) {
      preferredWorkModel = "HYBRID";
    } else if (remotePref.includes("remote")) {
      preferredWorkModel = "REMOTE";
    } else if (remotePref.includes("office") || remotePref.includes("on-site")) {
      preferredWorkModel = "ON_SITE";
    }

    return {
      operatingLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      yearsOfExperience: profile.experience?.yearsExperience || 0,
      coreCapabilities: Array.from(new Set(coreCapabilities)),
      preferredLocations: profile.preferences?.locations || [],
      preferredWorkModel,
      executiveThemes: profile.executiveIdentity?.executiveThemes || []
    };
  }
}
