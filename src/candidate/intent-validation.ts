import { z } from "zod";

export const DESIRED_ROLE_LEVEL_MAX_LENGTH = 1024;

export const decisionPreferencesSchema = z.object({
  desiredNextRoleLevel: z.string().trim().min(1).max(DESIRED_ROLE_LEVEL_MAX_LENGTH, "Use at most 1,024 characters for desired next-role level.").optional(),
  careerMove: z.enum(["PROGRESSION", "LATERAL", "DELIBERATE_RESET", "FOUNDER", "PORTFOLIO"]).optional(),
  leadershipPreference: z.enum(["LEADERSHIP", "PLAYER_COACH", "INDIVIDUAL_CONTRIBUTOR", "ANY"]).optional(),
  minimumTeamSize: z.number().int().nonnegative().max(100_000).optional(),
  minimumCommercialScope: z.enum(["FUNCTIONAL", "BUDGET_OWNERSHIP", "REVENUE_OWNERSHIP", "PNL_OWNERSHIP", "ENTERPRISE"]).optional(),
  startupStageAppetite: z.array(z.enum(["ESTABLISHED", "SCALE_UP", "EARLY_STAGE", "PRE_REVENUE"])).max(4).optional(),
  founderInterest: z.enum(["YES", "NO", "OPEN"]).optional(),
  personalCapitalInvestment: z.enum(["YES", "NO", "OPEN"]).optional(),
  compensationPreference: z.enum(["CASH_PRIORITY", "BALANCED", "EQUITY_PRIORITY"]).optional(),
  timeZoneTolerance: z.enum(["LOCAL_HOURS", "LIMITED_OVERLAP", "US_HOURS_OK", "ANY"]).optional(),
  industriesSought: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  industriesAvoided: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  nonNegotiables: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
}).strict();

export const careerIntentSchema = z.object({
  tenantId: z.string().min(1), personId: z.string().min(1),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]).optional(),
  targetSalaryAmount: z.number().finite().nonnegative().max(10_000_000_000).optional(),
  minSalaryUsd: z.number().finite().nonnegative().max(10_000_000_000).optional(),
  preferredLocations: z.array(z.string().trim().min(1).max(120)).max(20),
  targetTitles: z.array(z.string().trim().min(1).max(160)).max(20),
  preferredWorkModel: z.enum(["HYBRID", "REMOTE", "ON_SITE", "ANY"]).optional(),
  travelTolerance: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  decisionPreferences: decisionPreferencesSchema.optional(),
});


export function formatIntentSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Please try again.";
  let issues: Array<{ path?: Array<string | number>; message?: string }> | undefined;
  if (error instanceof z.ZodError) issues = error.issues;
  else { try { const parsed = JSON.parse(message); if (Array.isArray(parsed)) issues = parsed; } catch {} }
  const issue = issues?.[0];
  const detail = issue ? `${issue.path?.join(".") === "decisionPreferences.desiredNextRoleLevel" ? "Desired next-role level" : issue.path?.join(".") || "Career intent"}: ${issue.message || "Check this value."}` : message;
  return `Could not save career intent. ${detail}`;
}
