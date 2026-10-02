export const pipelines = ["evaluation", "dossier", "factual_review", "pursuit", "scrape"] as const;
export type ProtectedPipeline = (typeof pipelines)[number];
export const quotaDimensions = [
  "reasoning_monthly",
  "writing_monthly",
  "evaluations_daily",
  "memos_daily",
  "pursuits_monthly",
  "scrapes_daily",
  "concurrent_jobs",
] as const;
export type QuotaDimension = (typeof quotaDimensions)[number];
export type TenantQuota = Record<QuotaDimension, number | null> & {
  job_input_tokens: number;
  job_output_tokens: number;
};
export function validateQuota(value: unknown): TenantQuota {
  if (!value || typeof value !== "object") throw new Error("INVALID_QUOTA");
  const input = value as Record<string, unknown>;
  const result: Record<string, number | null> = {};
  for (const key of [...quotaDimensions, "job_input_tokens", "job_output_tokens"] as const) {
    const v = input[key];
    if (v === null && quotaDimensions.includes(key as QuotaDimension)) {
      result[key] = null;
      continue;
    }
    if (
      typeof v !== "number" ||
      !Number.isSafeInteger(v) ||
      v < 0 ||
      v > 1_000_000_000 ||
      (key.startsWith("job_") && v < 1)
    )
      throw new Error(`INVALID_QUOTA: ${key}`);
    result[key] = v;
  }
  return result as TenantQuota;
}
export type ProtectionAction =
  | { kind: "quota"; tenant: string; quota: unknown; reason: string }
  | {
      kind: "override";
      tenant: string;
      dimension: QuotaDimension;
      limit: number;
      expires: number;
      reason: string;
    }
  | {
      kind: "pause";
      tenant?: string;
      pipeline: ProtectedPipeline | "*";
      paused: boolean;
      reason: string;
    }
  | {
      kind: "resume_job";
      tenant: string;
      pipeline: ProtectedPipeline;
      jobId: string;
      reason: string;
    }
  | { kind: "acknowledge"; alertId: string; reason: string };
export type ProtectionMutation = ProtectionAction & { expectedState: string };

export const validateProtectionMutation = (input: ProtectionMutation) => {
  if (
    !input ||
    !["quota", "override", "pause", "acknowledge", "resume_job"].includes(input.kind) ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 1000
  )
    throw new Error("VALID_ACTION_REASON_REQUIRED");
  if (
    "tenant" in input &&
    input.tenant !== undefined &&
    (typeof input.tenant !== "string" || !input.tenant.trim() || input.tenant.length > 256)
  )
    throw new Error("INVALID_TENANT");
  if (
    ["quota", "override", "resume_job"].includes(input.kind) &&
    !("tenant" in input && input.tenant)
  )
    throw new Error("TENANT_REQUIRED");
  if (
    input.kind === "resume_job" &&
    (!pipelines.includes(input.pipeline) ||
      typeof input.jobId !== "string" ||
      !input.jobId ||
      input.jobId.length > 256)
  )
    throw new Error("INVALID_JOB");
  if (
    input.kind === "acknowledge" &&
    (typeof input.alertId !== "string" || !input.alertId || input.alertId.length > 256)
  )
    throw new Error("INVALID_ALERT");
  if (typeof input.expectedState !== "string") throw new Error("ADMIN_STATE_REQUIRED");
  if (input.kind === "quota") return { ...input, quota: validateQuota(input.quota) };
  if (
    input.kind === "override" &&
    (!quotaDimensions.includes(input.dimension) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 0 ||
      input.limit > 1_000_000_000 ||
      !Number.isSafeInteger(input.expires) ||
      input.expires <= Date.now() ||
      input.expires > Date.now() + 30 * 86400000)
  )
    throw new Error("INVALID_QUOTA_OVERRIDE");
  if (
    input.kind === "pause" &&
    (!["*", ...pipelines].includes(input.pipeline) || typeof input.paused !== "boolean")
  )
    throw new Error("INVALID_PAUSE");
  return input;
};
