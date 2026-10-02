import { z } from "zod";
import { computeDeterministicHash } from "../lib/ontology/compiler/OntologyCompiler";
import {
  intelligenceTaxonomySchema,
  intelligenceReference,
  validateIntelligenceTaxonomy,
  type IntelligenceTaxonomy,
} from "../lib/ontology/intelligence-taxonomy";
export const pinnedIntelligenceSchema = z
  .object({
    revisionId: z.string().min(1),
    fingerprint: z.string().min(1),
    definition: intelligenceTaxonomySchema,
  })
  .strict();
export type PinnedIntelligence = z.infer<typeof pinnedIntelligenceSchema>;
export const intelligenceFingerprint = (definition: IntelligenceTaxonomy) =>
  computeDeterministicHash(intelligenceReference(definition));
export function pinIntelligence(
  revisionId: string,
  definition: IntelligenceTaxonomy,
): PinnedIntelligence {
  return {
    revisionId,
    fingerprint: intelligenceFingerprint(definition),
    definition: validateIntelligenceTaxonomy(definition),
  };
}
export function readPinnedIntelligence(value: unknown): PinnedIntelligence | undefined {
  if (value === undefined) return undefined;
  const pinned = pinnedIntelligenceSchema.parse(value);
  if (intelligenceFingerprint(pinned.definition) !== pinned.fingerprint)
    throw new Error("INTELLIGENCE_SNAPSHOT_FINGERPRINT_MISMATCH");
  return pinned;
}
