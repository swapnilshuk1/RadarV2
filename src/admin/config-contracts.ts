import { z } from "zod";
const lane = z
  .object({
    model: z.enum(["legacy", "zai.glm-5", "deepseek.v3.2"]),
    concurrency: z.number().int().min(1).max(8),
    timeoutMs: z.number().int().min(30000).max(180000),
    maxOutputTokens: z.number().int().min(4096).max(16384),
  })
  .strict();
export const engineConfigSchema = z
  .object({
    reasoning: lane,
    writing: lane,
    pursuitInputTokens: z.number().int().min(10000).max(100000),
    pursuitOutputTokens: z.number().int().min(3000).max(20000),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const name of ["reasoning", "writing"] as const) {
      const selected = config[name];
      if (
        selected.model === "legacy" &&
        (selected.concurrency !== (name === "reasoning" ? 4 : 2) ||
          selected.timeoutMs !== 120000 ||
          selected.maxOutputTokens !== 16384)
      )
        ctx.addIssue({
          code: "custom",
          path: [name],
          message:
            "Existing host assignments keep their host limits; select an explicit model to edit lane limits",
        });
    }
  });
export type EngineConfig = z.infer<typeof engineConfigSchema>;
export type ModelLane = "reasoning" | "writing";
export const baselineConfig: EngineConfig = {
  reasoning: { model: "legacy", concurrency: 4, timeoutMs: 120000, maxOutputTokens: 16384 },
  writing: { model: "legacy", concurrency: 2, timeoutMs: 120000, maxOutputTokens: 16384 },
  pursuitInputTokens: 20000,
  pursuitOutputTokens: 5000,
};
export const configMutationSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("draft"), config: engineConfigSchema }),
    z.object({ kind: z.literal("discard"), revisionId: z.string().min(1) }),
    z.object({
      kind: z.literal("publish"),
      revisionId: z.string().min(1),
      benchId: z.string().min(1),
    }),
    z.object({ kind: z.literal("revert"), revisionId: z.string().min(1) }),
    z.object({
      kind: z.literal("bench"),
      revisionId: z.string().min(1),
      tokenCap: z.number().int().min(50000).max(1000000),
    }),
  ])
  .and(
    z.object({
      tenantId: z.string().min(1).optional(),
      reason: z.string().trim().min(3).max(1000),
    }),
  );
export type ConfigMutation = z.infer<typeof configMutationSchema>;
