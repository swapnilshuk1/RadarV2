// src/lib/intelligence/builders/CandidateProjectionBuilder.ts

import { CandidateEvidenceReference, CandidateProjection } from "../../domain/candidate_projection";
import { CandidateProfile } from "../../../data/candidate-profile";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { CandidateSeniorityClassifier } from "../classifiers/CandidateSeniorityClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import { OperatingLevel } from "../../domain/semantic";
import { ICandidateProjectionBuilder } from "../../../domain/builders";
import type { EvidenceGraph, ExtractedFact } from "../../../domain/evidence";
import type { ResolvedOntology } from "../extraction/OntologyResolver";
import { SemanticResolutionEngine } from "../semantic/SemanticResolutionEngine";
import type { CanonicalSemanticEvidence } from "../semantic/types";

export class CandidateProjectionBuilderImpl implements ICandidateProjectionBuilder {
  private static isUnsupportedPrimaryCapability(capability: string): boolean {
    return /\b(?:ebitda|board\s+reporting|m\s*&\s*a|merger|enterprise(?:-|\s+)wide\s+p&l|enterprise\s+sales)\b/i.test(capability);
  }

  private static chooseArchetype(title: string, capabilities: string[], themes: string[]): string | undefined {
    const text = `${title} ${capabilities.join(" ")} ${themes.join(" ")}`.toLowerCase();
    if (!text.trim() || (title === "Unknown" && capabilities.length === 0 && themes.length === 0)) return undefined;
    if (/growth|commercial|revenue/.test(text) && /transform|digital|crm/.test(text)) return "Commercial Growth & Transformation";
    if (/growth|commercial|revenue/.test(text)) return "Commercial Growth Leader";
    if (/transform|digital|crm/.test(text)) return "Digital Transformation Leader";
    return "Functional Leader";
  }

  private static isTargetOrAspiration(text: string): boolean {
    return /\b(?:target(?:\s+role)?|aspir(?:ation|e|ing)?|seeking|desired|future|next\s+role|career\s+goal)\b/i.test(text);
  }

  private static extractTitle(text: string): string | undefined {
    return text.match(/\b(?:chief\s+\w+(?:\s+\w+)?\s+officer|(?:senior\s+)?(?:vice\s+president|vp|director|head\s+of)\s+[a-z][^\n,;.]*)/i)?.[0]?.trim();
  }

  private static selectAttainedTitle(graph: EvidenceGraph): { title: string; evidence: CandidateEvidenceReference[] } {
    const candidates = graph.facts
      .filter((fact) => fact.type === "EMPLOYMENT")
      .filter((fact) => !CandidateProjectionBuilderImpl.isTargetOrAspiration(`${fact.value}\n${fact.sourceSpan}\n${fact.justification}`))
      .map((fact) => ({
        fact,
        title: CandidateProjectionBuilderImpl.extractTitle(fact.value),
        isCurrent: /\b(?:current(?:ly)?|present|ongoing|incumbent|serving\s+as)\b/i.test(`${fact.value}\n${fact.sourceSpan}\n${fact.justification}`),
      }))
      .filter((candidate): candidate is { fact: ExtractedFact; title: string; isCurrent: boolean } => Boolean(candidate.title && candidate.isCurrent))
      .sort((left, right) => right.fact.confidence - left.fact.confidence || left.fact.id.localeCompare(right.fact.id));

    const selected = candidates[0];
    if (!selected) return { title: "Unknown", evidence: [] };
    return {
      title: selected.title,
      evidence: [{
        id: selected.fact.id,
        quote: selected.fact.value,
        sourceSpan: selected.fact.sourceSpan,
        relation: "ATTAINED_TITLE",
      }],
    };
  }

  private static supportsCapability(capability: string, proof: string): boolean {
    const normalizedCapability = capability.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
    const normalizedProof = proof.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
    if (normalizedProof.includes(normalizedCapability)) return true;
    if (/\bboard\s+reporting\b/i.test(capability)) return /\bboard\s+(?:reporting|presentation|update)\b/i.test(proof);
    if (/\bebitda\b/i.test(capability)) return /\bebitda\b/i.test(proof);
    if (/\b(?:m\s*&\s*a|merger)\b/i.test(capability)) return /\b(?:m\s*&\s*a|merger|acquisition)\b/i.test(proof);
    if (/\benterprise(?:-|\s+)wide\s+p&l\b/i.test(capability)) return /\b(?:enterprise|company|corporate)(?:-|\s+)wide\s+p&l\b/i.test(proof);
    if (/\benterprise\s+sales\b/i.test(capability)) return /\benterprise\s+sales\b/i.test(proof);
    return false;
  }

  private static evidenceForInferredCapability(capability: string, profile: CandidateProfile): CandidateEvidenceReference[] {
    return (profile.evidence || []).flatMap((evidence, index) =>
      CandidateProjectionBuilderImpl.supportsCapability(capability, evidence.proof)
        ? [{
            id: `candidate:profileEvidence:${index}`,
            quote: evidence.proof,
            relation: "SUPPORTS_INFERENCE" as const,
          }]
        : []
    );
  }

  private static evidenceBackedThemes(themes: string[], sourceText: string): string[] {
    const normalizedSource = sourceText.toLowerCase();
    return themes.filter((theme) => {
      const normalizedTheme = theme.trim().toLowerCase();
      return normalizedTheme.length > 0 && normalizedSource.includes(normalizedTheme);
    });
  }

  public fromProfile(profile: CandidateProfile): CandidateProjection {
    // Reconstruct dense resume text representation to feed into classifiers
    const candidateText = [
      profile.identity.currentTitle,
      ...profile.experience.achievements,
      ...profile.evidence.map(e => e.proof),
      ...(profile.executiveCompetencies || []).filter((capability) => !CandidateProjectionBuilderImpl.isUnsupportedPrimaryCapability(String(capability)))
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
    const capabilityEvidence = new Map<string, string[]>();
    if (profile.capabilities) {
      Object.entries(profile.capabilities).forEach(([group, list]) => {
        if (Array.isArray(list)) {
          list.forEach((capability, index) => {
            const name = String(capability).trim();
            if (!name) return;
            const evidenceIds = capabilityEvidence.get(name) || [];
            evidenceIds.push(`candidate:capabilities:${group}:${index}`);
            capabilityEvidence.set(name, evidenceIds);
          });
        }
      });
    }
    if (Array.isArray(profile.executiveCompetencies)) {
      profile.executiveCompetencies.forEach((capability, index) => {
        const name = String(capability).trim();
        if (!name) return;
        const evidenceIds = capabilityEvidence.get(name) || [];
        evidenceIds.push(`candidate:executiveCompetencies:${index}`);
        capabilityEvidence.set(name, evidenceIds);
      });
    }
    const uniqueAllCapabilities = Array.from(capabilityEvidence.keys());
    const inferredCapabilities = uniqueAllCapabilities
      .filter((capability) => CandidateProjectionBuilderImpl.isUnsupportedPrimaryCapability(capability))
      .flatMap((name) => {
        const supportingEvidence = CandidateProjectionBuilderImpl.evidenceForInferredCapability(name, profile);
        if (supportingEvidence.length === 0) return [];
        return [{
          name,
          confidence: 0.55,
          evidenceIds: supportingEvidence.map((evidence) => evidence.id),
          supportingEvidence,
        }];
      });
    const coreCapabilities = uniqueAllCapabilities.filter((capability) => !CandidateProjectionBuilderImpl.isUnsupportedPrimaryCapability(capability));

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

    const extractedThemes = profile.executiveIdentity?.executiveThemes || [];
    const executiveThemes = CandidateProjectionBuilderImpl.evidenceBackedThemes(extractedThemes, candidateText);
    const attainedTitle = profile.identity.currentTitle?.trim() || "Unknown";

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
      attainedTitle,
      attainedSeniority: candidateSeniorityLevel.value,
      attainedTitleEvidence: attainedTitle === "Unknown" ? [] : [{
        id: "candidate:profile.identity.currentTitle",
        quote: attainedTitle,
        relation: "ATTAINED_TITLE",
      }],
      operatingLevel,
      candidateSeniorityLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      yearsOfExperience: profile.experience?.yearsExperience || 0,
      coreCapabilities: uniqueCaps,
      demonstratedCapabilities: uniqueCaps,
      inferredCapabilities,
      preferredLocations: profile.preferences?.locations || [],
      preferredWorkModel,
      executiveThemes,
      archetype: CandidateProjectionBuilderImpl.chooseArchetype(attainedTitle, uniqueCaps, executiveThemes),
      targetTrajectory: profile.strategy?.targetTitles || [],
      attentionWindow,
      semanticEvidence
    };
  }

  public fromEvidence(graph: EvidenceGraph, resolved: ResolvedOntology): CandidateProjection {
    const nonTargetFacts = graph.facts.filter((fact) =>
      !CandidateProjectionBuilderImpl.isTargetOrAspiration(`${fact.value}\n${fact.sourceSpan}\n${fact.justification}`)
    );
    const nonTargetFactIds = new Set(nonTargetFacts.map((fact) => fact.id));
    const claims = resolved.resolvedClaims
      .filter((claim) => claim.evidenceIds.some((id) => nonTargetFactIds.has(id)))
      .map((claim) => claim.statement);
    const fullText = nonTargetFacts.map(f => f.value).join("\n");
    const skills = resolved.resolvedSkills.filter((skill) => fullText.toLowerCase().includes(skill.toLowerCase()));
    const caps = resolved.resolvedCapabilities;
    const attained = CandidateProjectionBuilderImpl.selectAttainedTitle(graph);
    const attainedTitle = attained.title;
    const noEvidence = fullText.trim().length === 0;
    const operatingLevelRaw = noEvidence
      ? { value: "UNKNOWN" as const, evidenceIds: [], confidence: 0 }
      : OperatingLevelClassifier.classify(fullText, attainedTitle);
    const candidateSeniorityLevelRaw = noEvidence
      ? { value: "UNKNOWN" as const, evidenceIds: [], confidence: 0 }
      : CandidateSeniorityClassifier.classify(attainedTitle, fullText);
    const workNature = noEvidence
      ? { value: "UNKNOWN" as const, evidenceIds: [], confidence: 0 }
      : WorkNatureClassifier.classify(fullText, attainedTitle);
    const decisionAuthority = noEvidence
      ? { value: "UNKNOWN" as const, evidenceIds: [], confidence: 0 }
      : DecisionAuthorityClassifier.classify(fullText, attainedTitle);
    const commercialScope = noEvidence
      ? { value: "UNKNOWN" as const, evidenceIds: [], confidence: 0 }
      : CommercialScopeClassifier.classify(fullText, attainedTitle);

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

    const extractedThemes = Array.from(new Set(claims.slice(0, 5)));
    const executiveThemes = extractedThemes;

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
      attainedTitle,
      attainedSeniority: candidateSeniorityLevel.value,
      attainedTitleEvidence: attained.evidence,
      operatingLevel,
      candidateSeniorityLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      yearsOfExperience: 0,
      coreCapabilities: uniqueSkillsCaps,
      demonstratedCapabilities: uniqueSkillsCaps,
      inferredCapabilities: [],
      preferredLocations: [],
      preferredWorkModel: "ANY",
      executiveThemes,
      archetype: CandidateProjectionBuilderImpl.chooseArchetype(attainedTitle, uniqueSkillsCaps, executiveThemes),
      semanticEvidence
    };
  }
}
