import { createServerFn } from "@tanstack/react-start";
import { getDatabaseAdapter } from "../data/database";
import { requireAuthUser } from "../lib/auth/guard";
import { taxonomyMutationSchema } from "./taxonomy-contracts";

export const getTaxonomySnapshotFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const { readTaxonomySnapshot } = await import("./taxonomy-store");
  return readTaxonomySnapshot(getDatabaseAdapter(), user.id);
});

export const changeTaxonomyFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => taxonomyMutationSchema.parse(input))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { mutateTaxonomy } = await import("./taxonomy-store");
    return mutateTaxonomy(getDatabaseAdapter(), user.id, data);
  });
