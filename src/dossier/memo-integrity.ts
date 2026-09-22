import { validateMemoCopy } from "./composition";
import { isDeepStrictEqual } from "node:util";
import { compositionSchema, memoSections, type Dossier, type Research } from "./contracts";
import type { StagedDecisionResult } from "./staged-decision-contract";
import { parseCanonicalStagedDecisionResult } from "./staged-decision-integrity";

type MemoPlanSection = (typeof memoSections)[number];

export class MemoPlanRepair extends Error {
  constructor(
    readonly sections: MemoPlanSection[],
    message: string,
  ) {
    super(message);
    this.name = "MemoPlanRepair";
  }
}

export function validateMemoPlan(
  research: Pick<Research, "claims" | "narrativePlan">,
  staged: StagedDecisionResult,
) {
  const points = research.narrativePlan.memoPoints ?? [];
  const claims = new Set(research.claims.map((c) => c.id)),
    requirements = new Set(staged.trace.requirements.map((r) => r.id)),
    fields = new Set(staged.trace.resolutions.map((r) => r.field));
  if (!points.length || new Set(points.map((p) => p.id)).size !== points.length)
    throw new Error("MEMO_PLAN_IDENTITY_INVALID");
  for (const p of points)
    if (
      p.claimIds.some((id) => !claims.has(id)) ||
      p.requirementIds.some((id) => !requirements.has(id)) ||
      p.resolutionFields.some((f) => !fields.has(f))
    )
      throw new Error("MEMO_PLAN_REFERENCE_INVALID");
  if (
    [...requirements].some(
      (id) => !points.some((p) => p.section === "candidateFit" && p.requirementIds.includes(id)),
    )
  )
    throw new MemoPlanRepair(["candidateFit"], "MEMO_PLAN_REQUIREMENT_COVERAGE");
  const conditions = points.filter((p) => p.section === "decisionConditions");
  const requiredFields = staged.decision.decisionHinges.flatMap((h) => h.resolutionFields);
  const requiredIds = [
    ...staged.decision.decisionHinges.flatMap((h) => h.requirementIds),
    ...staged.decision.screeningDriverRequirementIds,
  ];
  const missingFields = requiredFields.filter(
    (f) => !conditions.some((p) => p.resolutionFields.includes(f)),
  );
  const missingIds = requiredIds.filter(
    (id) => !conditions.some((p) => p.requirementIds.includes(id)),
  );
  if (missingFields.length || missingIds.length)
    throw new MemoPlanRepair(
      ["decisionConditions"],
      `MEMO_PLAN_DECISION_COVERAGE: decisionConditions missing fields ${missingFields.join(", ")}; requirements ${missingIds.join(", ")}`,
    );
  const materialFields = Object.values(staged.decision.careerCapital)
    .filter((a) => a.material)
    .flatMap((a) => a.resolutionFields);
  const missingCareer = materialFields.filter(
    (f) =>
      !points.some(
        (p) =>
          ["opportunityValue", "decisionConditions"].includes(p.section) &&
          p.resolutionFields.includes(f),
      ),
  );
  if (missingCareer.length)
    throw new MemoPlanRepair(
      ["opportunityValue", "decisionConditions"],
      `MEMO_PLAN_CAREER_COVERAGE: opportunityValue or decisionConditions missing ${missingCareer.join(", ")}`,
    );
}

/** Storage and serving recheck coverage against the immutable decision, not prose. */
export function assertMemoIntegrity(dossier: Dossier) {
  const trace = dossier.canonicalDecisionTrace as unknown as StagedDecisionResult["trace"];
  const staged = parseCanonicalStagedDecisionResult({ decision: trace?.decision, trace });
  if (!isDeepStrictEqual(dossier.resolutions, staged.trace.resolutions))
    throw new Error("MEMO_SCOPE_TRACE_MISMATCH");
  const mapped = staged.trace.requirements.map((r) => ({
    requirement: r.requirement,
    mandatory: r.strength === "REQUIRED",
    decisionRole: r.screeningGate
      ? "HARD_SCREEN"
      : r.strength === "PREFERRED"
        ? "PREFERENCE"
        : r.roleImportance,
    status: r.status,
    roleClaimIds: r.roleClaimIds,
    candidateClaimIds: r.candidateClaimIds,
  }));
  if (
    dossier.verdict.verdict !== staged.decision.verdict ||
    dossier.verdict.screeningViability !== staged.decision.screeningViability ||
    !isDeepStrictEqual(
      dossier.verdict.requirements.map(({ reasoning: _reasoning, ...r }) => r),
      mapped,
    )
  )
    throw new Error("MEMO_MAPPING_TRACE_MISMATCH");
  const claims = [
    ...dossier.evidence.roleClaims,
    ...dossier.evidence.candidateClaims,
    ...dossier.evidence.contextualClaims,
    ...dossier.evidence.relationalClaims,
  ];
  validateMemoCopy(
    dossier,
    {
      claims,
      narrativePlan: dossier.narrativePlan,
      evaluation: dossier.verdict,
      resolutions: dossier.resolutions,
      candidateConflicts: dossier.candidateConflicts,
    },
    staged,
  );
  validateMemoPlan({ claims, narrativePlan: dossier.narrativePlan }, staged);
  validateMemoSectionCoverage("candidateFit", dossier, dossier.narrativePlan, staged);
  validateMemoSectionCoverage("decisionConditions", dossier, dossier.narrativePlan, staged);
}

/** Mechanical omissions are repaired before paying for factual review. */
export function validateMemoSectionCoverage(
  section: string,
  value: unknown,
  plan: Research["narrativePlan"],
  staged: StagedDecisionResult,
) {
  const required = new Set(staged.trace.requirements.map((r) => r.id));
  if (section === "candidateFit") {
    const rows = compositionSchema.pick({ candidateFit: true }).parse(value).candidateFit;
    const fit = rows.flatMap((r) => r.requirementIds);
    const unknown = fit.filter((id) => !required.has(id)),
      missing = [...required].filter((id) => !fit.includes(id));
    if (unknown.length || missing.length)
      throw new Error(
        `MEMO_FIT_COVERAGE_INVALID: unknown ${unknown.join(", ")}; missing ${missing.join(", ")}`,
      );
  }
  if (section === "decisionConditions") {
    const rows = compositionSchema
      .pick({ decisionConditions: true })
      .parse(value).decisionConditions;
    const fields = new Set(staged.trace.resolutions.map((r) => r.field));
    if (
      rows.some(
        (r) =>
          r.requirementIds.some((id) => !required.has(id)) ||
          r.resolutionFields.some((f) => !fields.has(f)),
      )
    )
      throw new Error("MEMO_CONDITION_REFERENCE_INVALID");
    const points = plan.memoPoints!.filter((p) => p.section === "decisionConditions");
    const missingIds = [...new Set(points.flatMap((p) => p.requirementIds))].filter(
      (id) => !rows.some((r) => r.requirementIds.includes(id)),
    );
    const missingFields = [...new Set(points.flatMap((p) => p.resolutionFields))].filter(
      (f) => !rows.some((r) => r.resolutionFields.includes(f)),
    );
    if (missingIds.length || missingFields.length)
      throw new Error(
        `MEMO_CONDITION_COVERAGE_INVALID: condition rows missing requirementIds ${missingIds.join(", ")}; resolutionFields ${missingFields.join(", ")}. Preserve the corresponding planned meaning and attach these references to the appropriate rows.`,
      );
  }
}
