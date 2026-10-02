import { createServerFn } from "@tanstack/react-start";
import { requireAuthUser } from "../lib/auth/guard";
import { getDatabaseAdapter } from "../data/database";
import { configMutationSchema } from "./config-contracts";
export const getConfigSnapshotFn = createServerFn({ method: "GET" })
  .validator((input: { tenantId?: string }) => ({ tenantId: input?.tenantId }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { readConfigSnapshot } = await import("./config-store");
    return readConfigSnapshot(getDatabaseAdapter(), user.id, data.tenantId);
  });
export const changeConfigFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => configMutationSchema.parse(input))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { mutateConfig } = await import("./config-store");
    return mutateConfig(getDatabaseAdapter(), user.id, data);
  });
