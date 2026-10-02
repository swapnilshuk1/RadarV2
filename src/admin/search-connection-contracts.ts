import { z } from "zod";
export const searchConnectionMutation = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("candidate"),
      key: z
        .string()
        .trim()
        .regex(/^tvly-[A-Za-z0-9_-]{20,500}$/),
    }),
    z.object({ kind: z.literal("test"), credentialId: z.string().min(1) }),
    z.object({ kind: z.literal("activate"), credentialId: z.string().min(1) }),
    z.object({ kind: z.literal("rollback") }),
    z.object({ kind: z.literal("retire"), credentialId: z.string().min(1) }),
  ])
  .and(
    z.object({
      expectedRevision: z.number().int().nonnegative(),
      reason: z.string().trim().min(3).max(500),
    }),
  );
export type SearchConnectionMutation = z.infer<typeof searchConnectionMutation>;
