import { createServerFn } from "@tanstack/react-start";
import { requireAuthUser } from "../lib/auth/guard";
import { getDatabaseAdapter } from "../data/database";

export const getAdminSnapshotFn = createServerFn({ method: "GET" })
  .validator((input: { tenantId?: string; days?: number }) => ({
    tenantId: input?.tenantId ? String(input.tenantId) : undefined,
    days: input?.days ?? 7,
  }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { readAdminSnapshot } = await import("./service");
    return readAdminSnapshot(getDatabaseAdapter(), user.id, data.tenantId, data.days);
  });
