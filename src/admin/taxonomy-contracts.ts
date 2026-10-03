import { z } from "zod";
import { intelligenceTaxonomySchema } from "../lib/ontology/intelligence-taxonomy";

const text = z.string().trim().min(1).max(160);
const key = text.refine(
  (value) => !["__proto__", "constructor", "prototype"].includes(value.toLowerCase()),
  "Reserved taxonomy key",
);
const phrases = z.array(text).min(1).max(80);

export const searchTaxonomySchema = z
  .object({
    intelligence: intelligenceTaxonomySchema.optional(),
    taxonomy: z
      .object({
        version: z.string().trim().min(1).max(40),
        concentricRings: z.object({
          primary: z.array(text).max(100),
          adjacent: z.array(text).max(100),
          excluded: z.array(text).max(100),
        }),
        descriptions: z.record(z.string().trim().min(1).max(1000)),
        retired: z.array(text).max(100).default([]),
      })
      .strict(),
    lexicon: z
      .object({
        version: z.string().trim().min(1).max(40),
        dimensions: z.record(z.record(phrases)),
      })
      .strict(),
  })
  .strict();

export type SearchTaxonomy = z.infer<typeof searchTaxonomySchema>;

export const discoveryStructure = (value: SearchTaxonomy) => ({
  concepts: Object.fromEntries(
    Object.entries(value.lexicon.dimensions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dimension, entries]) => [dimension, Object.keys(entries).sort()]),
  ),
  rings: Object.fromEntries(
    Object.entries(value.taxonomy.concentricRings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, [...values].sort()]),
  ),
  retired: [...value.taxonomy.retired].sort(),
});

export const taxonomyMutationSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("intelligence_edit"),
      nodeId: key,
      name: text,
      description: z.string().trim().max(1000),
      aliases: z.array(text).max(80),
    }),
    z.object({
      kind: z.literal("intelligence_add"),
      nodeId: key,
      name: text,
      nodeKind: z.enum(["domain", "discipline", "capability"]),
      parentId: key.nullable(),
      aliases: z.array(text).max(80),
      description: z.string().trim().max(1000),
      classification: z.enum(["CORE", "ADJACENT", "CONTEXT"]),
    }),
    z.object({ kind: z.literal("intelligence_move"), nodeId: key, parentId: key.nullable() }),
    z.object({ kind: z.literal("intelligence_retire"), nodeId: key }),
    z.object({
      kind: z.literal("intelligence_classify"),
      nodeId: key,
      classification: z.enum(["CORE", "ADJACENT", "CONTEXT"]),
    }),
    z.object({
      kind: z.literal("intelligence_shadow"),
      revisionId: text,
      tokenCap: z.number().int().min(1000).max(2000000),
      tenantId: key.optional(),
      limit: z.number().int().min(1).max(10).default(3),
    }),
    z.object({
      kind: z.literal("draft_concept"),
      dimension: key,
      concept: key,
      description: z.string().trim().min(1).max(1000),
      phrases,
    }),
    z.object({
      kind: z.literal("add_concept"),
      dimension: key,
      concept: key,
      description: z.string().trim().min(1).max(1000),
      phrases,
      ring: z.enum(["primary", "adjacent", "excluded"]),
    }),
    z.object({
      kind: z.literal("retire_concept"),
      dimension: key,
      concept: key,
    }),
    z.object({ kind: z.literal("discard"), revisionId: z.string().min(1) }),
    z.object({
      kind: z.literal("publish"),
      revisionId: z.string().min(1),
      confirmation: z.literal("PUBLISH").optional(),
    }),
    z.object({ kind: z.literal("revert"), revisionId: z.string().min(1) }),
    z.object({ kind: z.literal("shadow"), revisionId: z.string().min(1) }),
  ])
  .and(
    z.object({
      reason: z.string().trim().min(3).max(1000),
      expectedState: z.string().min(1),
    }),
  );

export type TaxonomyMutation = z.infer<typeof taxonomyMutationSchema>;
