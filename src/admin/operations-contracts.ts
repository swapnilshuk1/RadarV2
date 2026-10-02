import { z } from "zod";

export const operationalPipelines = ["evaluation", "dossier", "factual_review", "pursuit"] as const;
export type OperationalPipeline = (typeof operationalPipelines)[number];
export type ProviderFailure =
  | "credential"
  | "throttled"
  | "quota_exhausted"
  | "provider_outage"
  | "transport"
  | "timeout"
  | "invalid_response"
  | "vault";
export type WorkIdentity = {
  pipeline: OperationalPipeline;
  jobId: string;
  tenantId: string;
  personId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  contextFingerprint: string;
};
export type RuntimeReceipt = {
  workerName: string;
  instanceId: string;
  runtimeRole: string;
  releaseSha: string;
  databaseFingerprint: string;
  configRevision: string;
  connectionId: string;
  generation: number;
  credentialVersion: string | null;
  credentialSource: "vault" | "host" | "ADC";
  reloadMode: "hot" | "restart";
  reloadStatus: "loaded" | "failed" | "restart_required" | "pending";
  errorCode: string | null;
  startedAt: number;
  loadedAt: number;
  lastSeenAt: number;
  effectiveSettings?: Record<string, unknown>;
};
const count = z.number().int().min(1).max(8);
export const throughputSchema = z
  .object({
    evaluation: count,
    dossier: count,
    factual_review: count,
    pursuit: count,
    providerConcurrency: z.number().int().min(1).max(16),
    profile: z.enum(["Normal", "Conservative", "Recovery"]),
    cohortLimit: z.number().int().min(1).max(100),
  })
  .strict();
export type Throughput = z.infer<typeof throughputSchema>;
export const defaultThroughput: Throughput = {
  evaluation: 2,
  dossier: 2,
  factual_review: 1,
  pursuit: 2,
  providerConcurrency: 4,
  profile: "Normal",
  cohortLimit: 20,
};
export const operationsMutationSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("throughput"),
      settings: throughputSchema,
      revision: z.number().int().nonnegative(),
    }),
    z.object({ kind: z.literal("acknowledge"), incidentId: z.string().uuid() }),
    z.object({
      kind: z.literal("snooze"),
      incidentId: z.string().uuid(),
      minutes: z.number().int().min(1).max(1440),
    }),
    z.object({
      kind: z.literal("preview"),
      incidentId: z.string().uuid(),
      jobIds: z.array(z.string().min(1)).min(1).max(100),
    }),
    z.object({ kind: z.literal("execute"), actionId: z.string().uuid() }),
    z.object({ kind: z.literal("host_probe"), provider: z.enum(["bedrock", "google"]) }),
    z.object({
      kind: z.literal("webhook"),
      url: z.string().url(),
      secret: z.string().min(32).max(512),
      severity: z.enum(["Critical", "High", "Warning"]),
      recovery: z.boolean(),
    }),
  ])
  .and(z.object({ reason: z.string().trim().min(3).max(500) }));
export type OperationsMutation = z.infer<typeof operationsMutationSchema>;

/** Provider-specific codes only: an ambiguous 429 remains throttling. */
export function classifySearchFailure(status?: number, code?: string): ProviderFailure {
  if (code === "QUOTA_EXHAUSTED" || status === 432 || status === 433) return "quota_exhausted";
  if (status === 401 || status === 403) return "credential";
  if (status === 429) return "throttled";
  if (status && status >= 500) return "provider_outage";
  if (code === "TIMEOUT") return "timeout";
  if (code === "VAULT_UNREADABLE") return "vault";
  if (code === "INVALID_RESPONSE") return "invalid_response";
  return "transport";
}
