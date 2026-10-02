import { createServerFn } from "@tanstack/react-start";
import { requireAuthUser } from "../lib/auth/guard";
import { getDatabaseAdapter } from "../data/database";
import { validateProtectionMutation } from "./protection-contracts";
export const changeProtectionFn = createServerFn({ method: "POST" })
  .validator(validateProtectionMutation)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { applyProtectionMutation } = await import("./protection-mutations");
    return applyProtectionMutation(getDatabaseAdapter(), user.id, data);
  });
