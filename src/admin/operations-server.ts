import { createServerFn } from "@tanstack/react-start";
import { requireAuthUser } from "../lib/auth/guard";
import { getDatabaseAdapter } from "../data/database";
import { operationsMutationSchema } from "./operations-contracts";
import { searchConnectionMutation } from "./search-connection-contracts";
const safeError = (error: unknown) =>
  new Error(
    error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "OPERATION_FAILED",
  );
export const getOperationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const { readOperations } = await import("./operations-service");
  const { readSearchConnection } = await import("./search-connections");
  return {
    operations: await readOperations(getDatabaseAdapter(), user.id),
    connection: await readSearchConnection(getDatabaseAdapter(), user.id),
  };
});
export const changeOperationsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const result = operationsMutationSchema.safeParse(input);
    if (!result.success) throw new Error("INVALID_OPERATION");
    return result.data;
  })
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { mutateOperations } = await import("./operations-service");
    try {
      return await mutateOperations(getDatabaseAdapter(), user.id, data);
    } catch (error) {
      throw safeError(error);
    }
  });
export const changeSearchConnectionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const result = searchConnectionMutation.safeParse(input);
    if (!result.success) throw new Error("INVALID_CONNECTION_INPUT");
    return result.data;
  })
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { mutateSearchConnection } = await import("./search-connections");
    try {
      return await mutateSearchConnection(getDatabaseAdapter(), user.id, data);
    } catch (error) {
      throw safeError(error);
    }
  });
