import { validateMemoCopy } from "./composition";
import { isDeepStrictEqual } from "node:util";
import { compositionSchema, memoSections, type Dossier, type Research } from "./contracts";
import type { StagedDecisionResult } from "./staged-decision-contract";
import { parseCanonicalStagedDecisionResult } from "./staged-decision-integrity";

type MemoPlanSection = (typeof memoSections)[number];

export type MemoPlanRepairAssignment = {
  kind: "requirement" | "resolutionField";
  id: string;
  sections: MemoPlanSection[];
};

export type MemoPlanRepairTargets = {
  sections: MemoPlanSection[];
  requirementIds: string[];
  resolutionFields: string[];
  assignments?: MemoPlanRepairAssignment[];
  allowedRequirementIds?: string[];
  allowedResolutionFields?: string[];
};

export class MemoPlanRepair extends Error {
  constructor(
    readonly sections: MemoPlanSection[],
    message: string,
    readonly missingRequirementIds: string[] = [],
    readonly missingResolutionFields: string[] = [],
    readonly targetAssignments: MemoPlanRepairAssignment[] = [],
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
  const missingFitRequirementIds = [...requirements].filter(
    (id) => !points.some((p) => p.section === "candidateFit" && p.requirementIds.includes(id)),
  );
  const conditions = points.filter((p) => p.section === "decisionConditions");
  const requiredFields = staged.decision.decisionHinges.flatMap((h) => h.resolutionFields);
  const requiredIds = [
    ...staged.decision.decisionHinges.flatMap((h) => h.requirementIds),
    ...staged.decision.screeningDriverRequirementIds,
  ];
  const missingFields = [...new Set(requiredFields)].filter(
    (f) => !conditions.some((p) => p.resolutionFields.includes(f)),
  );
  const missingIds = [...new Set(requiredIds)].filter(
    (id) => !conditions.some((p) => p.requirementIds.includes(id)),
  );
  const materialFields = [
    ...new Set(
      Object.values(staged.decision.careerCapital)
        .filter((a) => a.material)
        .flatMap((a) => a.resolutionFields),
    ),
  ];
  const missingCareer = materialFields.filter(
    (f) =>
      !points.some(
        (p) =>
          ["opportunityValue", "decisionConditions"].includes(p.section) &&
          p.resolutionFields.includes(f),
      ),
  );

  const assignments: MemoPlanRepairAssignment[] = [
    ...missingFitRequirementIds.map((id) => ({
      kind: "requirement" as const,
      id,
      sections: ["candidateFit" as MemoPlanSection],
    })),
    ...missingIds.map((id) => ({
      kind: "requirement" as const,
      id,
      sections: ["decisionConditions" as MemoPlanSection],
    })),
    ...missingFields.map((id) => ({
      kind: "resolutionField" as const,
      id,
      sections: ["decisionConditions" as MemoPlanSection],
    })),
    ...missingCareer
      .filter((id) => !missingFields.includes(id))
      .map((id) => ({
        kind: "resolutionField" as const,
        id,
        sections: ["opportunityValue", "decisionConditions"] as MemoPlanSection[],
      })),
  ];

  if (assignments.length) {
    const issues: string[] = [];
    if (missingFitRequirementIds.length)
      issues.push(`MEMO_PLAN_REQUIREMENT_COVERAGE: candidateFit missing ${missingFitRequirementIds.join(", ")}`);
    if (missingFields.length || missingIds.length)
      issues.push(
        `MEMO_PLAN_DECISION_COVERAGE: decisionConditions missing fields ${missingFields.join(", ")}; requirements ${missingIds.join(", ")}`,
      );
    if (missingCareer.length)
      issues.push(
        `MEMO_PLAN_CAREER_COVERAGE: opportunityValue or decisionConditions missing ${missingCareer.join(", ")}`,
      );
    throw new MemoPlanRepair(
      [...new Set(assignments.flatMap((target) => target.sections))],
      issues.join("; "),
      [...new Set(assignments.filter((target) => target.kind === "requirement").map((target) => target.id))],
      [...new Set(assignments.filter((target) => target.kind === "resolutionField").map((target) => target.id))],
      assignments,
    );
  }

}

export function validateTargetedPlanRepair(
  previous: Research["narrativePlan"],
  next: Research["narrativePlan"],
  targets: MemoPlanRepairTargets,
) {
  const { memoPoints: previousPoints = [], ...previousHeader } = previous;
  const { memoPoints: nextPoints = [], ...nextHeader } = next;
  if (!isDeepStrictEqual(previousHeader, nextHeader))
    throw new Error("MEMO_PLAN_REPAIR_MUTATED_CONTEXT");

  const allowedSections = new Set(targets.sections);
  const targetRequirements = new Set(targets.requirementIds);
  const targetFields = new Set(targets.resolutionFields);
  const assignments = targets.assignments ?? [
    ...targets.requirementIds.map((id) => ({ kind: "requirement" as const, id, sections: targets.sections })),
    ...targets.resolutionFields.map((id) => ({ kind: "resolutionField" as const, id, sections: targets.sections })),
  ];
  const requirementTargetAllowed = (id: string, section: MemoPlanSection) =>
    assignments.some((target) => target.kind === "requirement" && target.id === id && target.sections.includes(section));
  const fieldTargetAllowed = (id: string, section: MemoPlanSection) =>
    assignments.some((target) => target.kind === "resolutionField" && target.id === id && target.sections.includes(section));
  const allowedRequirementIds = new Set(
    targets.allowedRequirementIds ?? [
      ...previousPoints.flatMap((point) => point.requirementIds),
      ...targets.requirementIds,
    ],
  );
  const allowedResolutionFields = new Set(
    targets.allowedResolutionFields ?? [
      ...previousPoints.flatMap((point) => point.resolutionFields),
      ...targets.resolutionFields,
    ],
  );
  const nextById = new Map(nextPoints.map((point) => [point.id, point]));

  for (const prior of previousPoints) {
    const candidate = nextById.get(prior.id);
    if (!candidate) throw new Error(`MEMO_PLAN_REPAIR_REMOVED_POINT:${prior.id}`);
    if (
      candidate.section !== prior.section ||
      candidate.point !== prior.point ||
      !isDeepStrictEqual(candidate.claimIds, prior.claimIds)
    )
      throw new Error(`MEMO_PLAN_REPAIR_REWROTE_POINT:${prior.id}`);

    for (const id of prior.requirementIds)
      if (!candidate.requirementIds.includes(id))
        throw new Error(`MEMO_PLAN_REPAIR_REMOVED_REQUIREMENT:${id}`);
    for (const field of prior.resolutionFields)
      if (!candidate.resolutionFields.includes(field))
        throw new Error(`MEMO_PLAN_REPAIR_REMOVED_FIELD:${field}`);

    const addedRequirements = candidate.requirementIds.filter((id) => !prior.requirementIds.includes(id));
    const addedFields = candidate.resolutionFields.filter((field) => !prior.resolutionFields.includes(field));
    if ((addedRequirements.length || addedFields.length) && !allowedSections.has(candidate.section))
      throw new Error(`MEMO_PLAN_REPAIR_WRONG_SECTION:${candidate.section}`);
    if (addedRequirements.some((id) => !requirementTargetAllowed(id, candidate.section)))
      throw new Error("MEMO_PLAN_REPAIR_ADDED_UNREQUESTED_REQUIREMENT");
    if (addedFields.some((field) => !fieldTargetAllowed(field, candidate.section)))
      throw new Error("MEMO_PLAN_REPAIR_ADDED_UNREQUESTED_FIELD");
  }

  const previousIds = new Set(previousPoints.map((point) => point.id));
  for (const point of nextPoints.filter((point) => !previousIds.has(point.id))) {
    if (!allowedSections.has(point.section))
      throw new Error(`MEMO_PLAN_REPAIR_NEW_POINT_WRONG_SECTION:${point.section}`);
    if (point.requirementIds.some((id) => !allowedRequirementIds.has(id)))
      throw new Error("MEMO_PLAN_REPAIR_NEW_POINT_UNREQUESTED_REQUIREMENT");
    if (point.resolutionFields.some((field) => !allowedResolutionFields.has(field)))
      throw new Error("MEMO_PLAN_REPAIR_NEW_POINT_UNREQUESTED_FIELD");
    // The point may carry other canonical references for context, but it must
    // exist because of this repair and satisfy at least one requested mapping
    // in a section that is valid for that mapping.
    if (
      !point.requirementIds.some((id) => requirementTargetAllowed(id, point.section)) &&
      !point.resolutionFields.some((field) => fieldTargetAllowed(field, point.section))
    )
      throw new Error("MEMO_PLAN_REPAIR_NEW_POINT_WITHOUT_TARGET");
  }

  for (const target of assignments) {
    const covered = nextPoints.some((point) => {
      if (!target.sections.includes(point.section)) return false;
      return target.kind === "requirement"
        ? point.requirementIds.includes(target.id)
        : point.resolutionFields.includes(target.id);
    });
    if (!covered)
      throw new Error(
        target.kind === "requirement"
          ? `MEMO_PLAN_REPAIR_TARGET_REQUIREMENT_MISSING:${target.id}`
          : `MEMO_PLAN_REPAIR_TARGET_FIELD_MISSING:${target.id}`,
      );
  }
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
