import { z } from "zod";
export const searchConnectionMutation = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("candidate"),
      key: z
        .string()
        .trim()
        .min(20)
        .max(512)
        .regex(/^[^\s\x00-\x1f\x7f]+$/),
    }),
    z.object({ kind: z.literal("test"), credentialId: z.string().min(1) }),
    z.object({ kind: z.literal("activate"), credentialId: z.string().min(1) }),
    z.object({ kind: z.literal("rollback") }),
    z.object({ kind: z.literal("test_host") }),
    z.object({ kind: z.literal("confirm_recovered") }),
    z.object({ kind: z.literal("retire"), credentialId: z.string().min(1) }),
  ])
  .and(
    z.object({
      expectedRevision: z.number().int().nonnegative(),
      reason: z.string().trim().min(3).max(500),
    }),
  );
export type SearchConnectionMutation = z.infer<typeof searchConnectionMutation>;
