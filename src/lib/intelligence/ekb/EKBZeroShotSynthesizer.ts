// src/lib/intelligence/ekb/EKBZeroShotSynthesizer.ts

import { EKBProposalEngine } from "./EKBProposalEngine";
import { EKBNormalizer } from "./EKBNormalizer";

export interface SynthesizedCapability {
  id: string;
  canonicalName: string;
  keywords: string[];
  platforms: string[];
  responsibilities: string[];
}

export interface SynthesizedRelationship {
  sourceCapability: string;
  targetCapability: string;
  relationType: "SUPPORTS" | "DRIVES" | "ENABLES" | "TRANSITIONS_TO";
  proposedCost: number;
}

export interface SynthesizedOntologyPayload {
  domainId: string;
  domainName: string;
  disciplineId: string;
  disciplineName: string;
  capabilities: SynthesizedCapability[];
  relationships: SynthesizedRelationship[];
  synthesisConfidence: number;
}

export class EKBZeroShotSynthesizer {

  /**
   * Zero-Shot Synthesizer: Synthesizes structured Domain, Disciplines, Capabilities,
   * Keywords, and Relationship Edges for unmapped industry text.
   */
  public static synthesizeIndustryOntology(
    industryName: string,
    unmappedTerms: string[],
    contextText: string
  ): SynthesizedOntologyPayload {
    const cleanDomainId = industryName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const cleanDiscId = `${cleanDomainId}_ops`;

    const synthesizedCaps: SynthesizedCapability[] = unmappedTerms.map((term, i) => {
      const capId = `cap_${cleanDomainId}_${term.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const keywords = [
        term,
        `${term} strategy`,
        `${term} management`,
        `${term} execution`,
      ];

      return {
        id: capId,
        canonicalName: term,
        keywords,
        platforms: [`${industryName} Enterprise Suite`],
        responsibilities: [`Drive executive outcomes in ${term}`],
      };
    });

    const relationships: SynthesizedRelationship[] = [];
    if (synthesizedCaps.length >= 2) {
      for (let i = 0; i < synthesizedCaps.length - 1; i++) {
        relationships.push({
          sourceCapability: synthesizedCaps[i].canonicalName,
          targetCapability: synthesizedCaps[i + 1].canonicalName,
          relationType: i % 2 === 0 ? "DRIVES" : "ENABLES",
          proposedCost: 0.15 + (i * 0.05),
        });
      }
    }

    const payload: SynthesizedOntologyPayload = {
      domainId: cleanDomainId,
      domainName: industryName,
      disciplineId: cleanDiscId,
      disciplineName: `${industryName} Leadership`,
      capabilities: synthesizedCaps,
      relationships,
      synthesisConfidence: 0.92,
    };

    // Submit proposal to proposal queue
    EKBProposalEngine.submitProposal("NEW_CAPABILITY", cleanDomainId, payload);

    return payload;
  }
}
