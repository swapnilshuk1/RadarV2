import { z } from "zod";

const text = z.string().trim().min(1).max(160);
const phrases = z.array(text).min(1).max(80);

export const searchTaxonomySchema = z
  .object({
    taxonomy: z
      .object({
        version: z.string().trim().min(1).max(40),
        concentricRings: z.object({
          primary: z.array(text).max(100),
          adjacent: z.array(text).max(100),
          excluded: z.array(text).max(100),
        }),
        descriptions: z.record(z.string().trim().min(1).max(1000)),
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

export const taxonomyMutationSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("draft_concept"),
      dimension: z.string().trim().min(1).max(100),
      concept: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(1000),
      phrases,
    }),
    z.object({ kind: z.literal("discard"), revisionId: z.string().min(1) }),
    z.object({ kind: z.literal("publish"), revisionId: z.string().min(1) }),
    z.object({ kind: z.literal("revert"), revisionId: z.string().min(1) }),
  ])
  .and(
    z.object({
      reason: z.string().trim().min(3).max(1000),
      expectedState: z.string().min(1),
    }),
  );

export type TaxonomyMutation = z.infer<typeof taxonomyMutationSchema>;
