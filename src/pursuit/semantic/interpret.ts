/**
 * One entry point that runs the whole pursuit interpretation and returns a
 * reproducible snapshot plus the derived drafts the thesis needs.
 */

import type { RoleBrief } from "../role-brief";
import type { CandidateArchetype, CandidateClaim, StyleProfile } from "../types";
import {
  buildBundles,
  classifyClaim,
  composePositioning,
  decomposeMandate,
  deriveObjectionDrafts,
  fingerprint,
  lensRelationships,
  mapEvidence,
  rankProof,
  type ObjectionDraft,
  type RankedProof,
} from "./engine";
import { SEMANTIC_VERSIONS, type ClaimClassification, type LensRelationshipRow, type SemanticSnapshot } from "./types";

export interface Interpretation {
  snapshot: SemanticSnapshot;
  classifications: Map<string, ClaimClassification>;
  ranked: RankedProof[];
  lenses: LensRelationshipRow[];
  objectionDrafts: ObjectionDraft[];
  chosenArchetypeId: string | null;
}

export function interpretPursuit(input: {
  brief: RoleBrief;
  claims: readonly CandidateClaim[];
  archetypes: readonly CandidateArchetype[];
  style: StyleProfile;
  preferredArchetypeId?: string | null;
  /** Stored classifications (from the claim cache) take precedence when current. */
  cachedClassifications?: ReadonlyMap<string, ClaimClassification>;
}): Interpretation {
  const { brief, claims, archetypes, style } = input;
  const mandate = decomposeMandate(brief);
  const classifications = new Map<string, ClaimClassification>();
  for (const claim of claims) {
    const cached = input.cachedClassifications?.get(claim.id);
    classifications.set(
      claim.id,
      cached && cached.version === SEMANTIC_VERSIONS.claimClassifier ? cached : classifyClaim(claim),
    );
  }
  const bundles = buildBundles(claims);
  const { mappings, coverage } = mapEvidence(mandate, claims, classifications, bundles);
  const coreDirect = coverage.find((c) => c.dimensionId === "dim-core")?.best === "DIRECT";
  const lenses = lensRelationships(mandate, archetypes, claims, classifications, mappings, coreDirect, style);
  const chosenArchetypeId =
    input.preferredArchetypeId ??
    lenses[0]?.archetypeId ??
    archetypes.find((a) => a.isDefault)?.id ??
    null;
  const chosen = archetypes.find((a) => a.id === chosenArchetypeId) ?? null;
  const ranked = rankProof(mandate, claims, classifications, mappings, bundles, style, chosen?.pinnedClaimIds ?? []);
  const positioning = composePositioning(mandate, coverage);
  positioning.supporting = [
    ...positioning.supporting,
    ...lenses.filter((l) => l.relationship !== "LOW" && l.archetypeId !== chosenArchetypeId).map((l) => l.archetypeName),
  ].slice(0, 4);
  const objectionDrafts = deriveObjectionDrafts(mandate, coverage, mappings, claims, classifications);

  const proofRelationships: Record<string, SemanticSnapshot["proofRelationships"][string]> = {};
  for (const r of ranked) proofRelationships[r.claimId] = r.licensed;

  const snapshot: SemanticSnapshot = {
    versions: SEMANTIC_VERSIONS,
    candidateContextFingerprint: fingerprint(
      claims.map((c) => [c.id, c.statement, c.employer, c.roleTitle, c.provenance]),
    ),
    roleContextFingerprint: fingerprint([
      brief.jobHash,
      brief.roleTitle,
      brief.company,
      brief.mandatePriorities,
      brief.mandateOutcomes,
      brief.requirements,
    ]),
    mandate,
    classifications: [...classifications.values()],
    bundles,
    mappings,
    coverage,
    positioning,
    proofRelationships,
    knownContacts: [],
  };

  return { snapshot, classifications, ranked, lenses, objectionDrafts, chosenArchetypeId };
}
