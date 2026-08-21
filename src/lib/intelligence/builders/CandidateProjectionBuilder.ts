// src/lib/intelligence/builders/CandidateProjectionBuilder.ts

import { CandidateProjection } from "../../domain/candidate_projection";
import { CandidateProfile } from "../../../data/candidate-profile";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { CandidateSeniorityClassifier } from "../classifiers/CandidateSeniorityClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import { OperatingLevel } from "../../domain/semantic";
import { ICandidateProjectionBuilder } from "../../../domain/builders";
import type { EvidenceGraph } from "../../../domain/evidence";
import type { ResolvedOntology } from "../extraction/OntologyResolver";
import { SemanticResolutionEngine } from "../semantic/SemanticResolutionEngine";
import type { CanonicalSemanticEvidence } from "../semantic/types";

export class CandidateProjectionBuilderImpl implements ICandidateProjectionBuilder {
  public fromProfile(profile: CandidateProfile): CandidateProjection {
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
    const candidateSeniorityLevelRaw = CandidateSeniorityClassifier.classify(title, candidateText);
    const workNature = WorkNatureClassifier.classify(candidateText, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(candidateText, title);
    const commercialScope = CommercialScopeClassifier.classify(candidateText, title);

    // Use the classifier output directly, preserving authoritative classification
    const operatingLevel = {
      value: operatingLevelRaw.value,
      evidenceIds: operatingLevelRaw.evidenceIds,
      confidence: operatingLevelRaw.confidence
    };

    // P0-E: Candidate seniority level - distinct from operating level
    const candidateSeniorityLevel = {
      value: candidateSeniorityLevelRaw.value,
      evidenceIds: candidateSeniorityLevelRaw.evidenceIds,
      confidence: candidateSeniorityLevelRaw.confidence
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

    const defaultThemes = [
      "Growth Marketing",
      "Digital Transformation",
      "CRM Strategy",
      "Commercial Growth",
      "Performance Marketing",
      "theme_growth",
      "theme_commercial",
      "theme_customer",
      "theme_transformation",
      "theme_digital"
    ];
    const extractedThemes = profile.executiveIdentity?.executiveThemes || [];
    const executiveThemes = extractedThemes.length > 0 ? extractedThemes : defaultThemes;

    const attentionWindow =
      (profile as any).attentionWindow ??
      profile.preferences?.attentionWindow ??
      (profile as any).headspaceCapacityPerMonth;

    // Phase 5C.2: Canonical Semantic Evidence Extraction
    const compositional = SemanticResolutionEngine.extractCompositional(candidateText);
    const semanticEvidence: CanonicalSemanticEvidence[] = [...compositional.evidenceList];
    const uniqueCaps = Array.from(new Set(coreCapabilities));
    for (const cap of uniqueCaps) {
      const res = SemanticResolutionEngine.resolveCapability(cap, undefined, candidateText);
      if (res && !semanticEvidence.some(e => e.canonicalConcept === res.canonicalConcept && e.sourcePhrase === res.sourcePhrase)) {
        semanticEvidence.push(res);
      }
    }

    return {
      operatingLevel,
      candidateSeniorityLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      yearsOfExperience: profile.experience?.yearsExperience || 0,
      coreCapabilities: uniqueCaps,
      preferredLocations: profile.preferences?.locations || [],
      preferredWorkModel,
      executiveThemes,
      attentionWindow,
      semanticEvidence
    };
  }

  public fromEvidence(graph: EvidenceGraph, resolved: ResolvedOntology): CandidateProjection {
    const claims = resolved.resolvedClaims.map(c => c.statement);
    const skills = resolved.resolvedSkills;
    const caps = resolved.resolvedCapabilities;

    const fullText = graph.facts.map(f => f.value).join("\n");

    const operatingLevelRaw = OperatingLevelClassifier.classify(fullText, "Executive");
    const candidateSeniorityLevelRaw = CandidateSeniorityClassifier.classify("Executive", fullText);
    const workNature = WorkNatureClassifier.classify(fullText, "Executive");
    const decisionAuthority = DecisionAuthorityClassifier.classify(fullText, "Executive");
    const commercialScope = CommercialScopeClassifier.classify(fullText, "Executive");

    // Use the classifier output directly, preserving authoritative classification
    const operatingLevel = {
      value: operatingLevelRaw.value,
      evidenceIds: operatingLevelRaw.evidenceIds,
      confidence: operatingLevelRaw.confidence
    };

    // P0-E: Candidate seniority level - distinct from operating level
    const candidateSeniorityLevel = {
      value: candidateSeniorityLevelRaw.value,
      evidenceIds: candidateSeniorityLevelRaw.evidenceIds,
      confidence: candidateSeniorityLevelRaw.confidence
    };

    const defaultThemes = [
      "Growth Marketing",
      "Digital Transformation",
      "CRM Strategy",
      "Commercial Growth",
      "Performance Marketing",
      "theme_growth",
      "theme_commercial",
      "theme_customer",
      "theme_transformation",
      "theme_digital"
    ];
    const extractedThemes = Array.from(new Set(claims.slice(0, 5)));
    const executiveThemes = extractedThemes.length > 0 ? extractedThemes : defaultThemes;

    // Phase 5C.2: Canonical Semantic Evidence Extraction
    const compositional = SemanticResolutionEngine.extractCompositional(fullText);
    const semanticEvidence: CanonicalSemanticEvidence[] = [...compositional.evidenceList];
    const uniqueSkillsCaps = Array.from(new Set([...caps, ...skills]));
    for (const cap of uniqueSkillsCaps) {
      const res = SemanticResolutionEngine.resolveCapability(cap, undefined, fullText);
      if (res && !semanticEvidence.some(e => e.canonicalConcept === res.canonicalConcept && e.sourcePhrase === res.sourcePhrase)) {
        semanticEvidence.push(res);
      }
    }

    return {
      operatingLevel,
      candidateSeniorityLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      yearsOfExperience: 15,
      coreCapabilities: uniqueSkillsCaps,
      preferredLocations: [],
      preferredWorkModel: "ANY",
      executiveThemes,
      semanticEvidence
    };
  }
}
