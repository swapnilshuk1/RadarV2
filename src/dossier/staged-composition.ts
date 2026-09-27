import { z } from "zod";
import { bindMemoReferences } from "./bound-memo-schema";
import {
  compositionSchema,
  narrativePlanSchema,
  memoPointSchema,
  researchSchema,
  type Research,
  type ReasoningModel,
  type FactualReviewReceipt,
  type JsonValue,
  type Dossier,
} from "./contracts";
import type { StagedResearchInput } from "./staged-role";
import type { StagedDecisionResult } from "./staged-decision-contract";
import { validateClaims } from "./grounding";
import {
  MemoPlanRepair,
  validateMemoPlan,
  validateMemoSectionCoverage,
  validateTargetedPlanRepair,
} from "./memo-integrity";
import {
  memoWritingInstruction,
  memoInputPacket,
  validateMemoCopy,
  assembleMemo,
  MemoCopyRepair,
  type MemoSection,
} from "./composition";
import { outputSchemaFor } from "./evidence";
import { reviewMemo, MemoReviewRepair } from "./memo-review";
import { FACTUAL_REVIEW_POLICY_VERSION } from "./factual-review-integrity";
export { FACTUAL_REVIEW_POLICY_VERSION } from "./factual-review-integrity";
const editorialSchema = z
  .object({ rationale: z.string().min(1), narrativePlan: narrativePlanSchema })
  .strict();
export const memoDraftSchema = z
  .object({
    rationale: z.string().min(1),
    narrativePlan: narrativePlanSchema.extend({ memoPoints: z.array(memoPointSchema).min(1) }),
    memo: compositionSchema,
  })
  .strict();
const memoPlanPatchSchema = z
  .object({ memoPoints: z.array(memoPointSchema).min(1) })
  .strict();
export function bindStagedEditorial(
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
  proposal: unknown,
): Research {
  const editorial = editorialSchema.parse(proposal);
  const known = new Set(frozen.evidence.map((claim) => claim.id));
  if (
    !editorial.narrativePlan.claimIds.length ||
    editorial.narrativePlan.claimIds.some((id) => !known.has(id))
  )
    throw new Error("EDITORIAL_CLAIM_PROVENANCE_INVALID");
  if (
    [...known].some(
      (id) => editorial.rationale.includes(id) || editorial.narrativePlan.argument.includes(id),
    )
  )
    throw new Error(
      "Keep internal evidence identifiers out of visible narrative; use claimIds only",
    );
  validateClaims(frozen.evidence, frozen.sources);
  return researchSchema.parse({
    claims: frozen.evidence,
    resolutions: staged.trace.resolutions,
    candidateConflicts: frozen.candidateConflicts,
    narrativePlan: editorial.narrativePlan,
    evaluation: {
      verdict: staged.decision.verdict,
      screeningViability: staged.decision.screeningViability,
      rationale: editorial.rationale,
      claimIds: editorial.narrativePlan.claimIds,
      requirements: staged.trace.requirements.map((r) => ({
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
        reasoning: r.mappingReasoning,
      })),
    },
  });
}

type Draft = z.infer<typeof memoDraftSchema>;
type Repair = {
  sections: MemoSection[];
  editorial: boolean;
  issue: string;
  planOnly?: boolean;
  missingRequirementIds?: string[];
  missingResolutionFields?: string[];
};
const sectionKeys = Object.keys(compositionSchema.shape) as MemoSection[];

function compactMemoRepairInput(
  packet: ReturnType<typeof memoInputPacket>,
  previous: Draft | undefined,
  repair: Repair,
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
) {
  if (repair.planOnly && previous) {
    const missingRequirementIds = new Set(repair.missingRequirementIds ?? []);
    const missingResolutionFields = new Set(repair.missingResolutionFields ?? []);
    return {
      input: {
        fixedDecision: packet.fixedDecision,
        requirements: staged.trace.requirements.filter((requirement) =>
          missingRequirementIds.has(requirement.id),
        ),
        referenceScope: staged.trace.resolutions.filter((resolution) =>
          missingResolutionFields.has(resolution.field),
        ),
        assignedMemoPoints: previous.narrativePlan.memoPoints.filter((point) =>
          repair.sections.includes(point.section as MemoSection),
        ),
      },
      previous: { narrativePlan: previous.narrativePlan },
      repair: repair.issue,
      repairSections: repair.sections,
      repairEditorial: true,
      missingRequirementIds: [...missingRequirementIds],
      missingResolutionFields: [...missingResolutionFields],
    };
  }

  if (repair.editorial || !previous || !repair.sections.length) {
    const previousEditorial = previous
      ? { rationale: previous.rationale, narrativePlan: previous.narrativePlan }
      : undefined;
    return {
      input: packet,
      previous: repair.editorial && !repair.sections.length ? previousEditorial : previous,
      repair: repair.issue,
      repairSections: repair.sections,
      repairEditorial: repair.editorial,
    };
  }

  const points = (previous.narrativePlan.memoPoints ?? []).filter((point) =>
    repair.sections.includes(point.section as MemoSection),
  );
  const requirementIds = new Set(points.flatMap((point) => point.requirementIds));
  const resolutionFields = new Set(points.flatMap((point) => point.resolutionFields));
  const claimIds = new Set(points.flatMap((point) => point.claimIds));
  const byId = new Map(frozen.evidence.map((claim) => [claim.id, claim]));
  const includeClaim = (id: string) => {
    if (claimIds.has(id)) {
      byId.get(id)?.derivedFrom.forEach((parent) => {
        if (!claimIds.has(parent)) {
          claimIds.add(parent);
          includeClaim(parent);
        }
      });
    }
  };
  [...claimIds].forEach(includeClaim);

  const filterClaims = <T extends { id: string }>(claims: T[]) =>
    claims.filter((claim) => claimIds.has(claim.id));
  const priorMemo = Object.fromEntries(
    repair.sections.map((section) => [section, previous.memo[section]]),
  );

  return {
    input: {
      candidateEvidence: {
        ...packet.candidateEvidence,
        facts: filterClaims(packet.candidateEvidence.facts),
      },
      opportunity: packet.opportunity,
      roleEvidence: filterClaims(packet.roleEvidence),
      contextEvidence: filterClaims(packet.contextEvidence),
      relationalEvidence: filterClaims(packet.relationalEvidence),
      fixedDecision: packet.fixedDecision,
      requirements: staged.trace.requirements.filter((requirement) =>
        requirementIds.has(requirement.id),
      ),
      operatingConditions: staged.trace.role.operatingConditions,
      referenceScope: staged.trace.resolutions.filter((resolution) =>
        resolutionFields.has(resolution.field),
      ),
      assignedMemoPoints: points,
      budgets: packet.budgets,
    },
    previous: {
      rationale: previous.rationale,
      narrativePlan: {
        ...previous.narrativePlan,
        memoPoints: points,
      },
      memo: priorMemo,
    },
    repair: repair.issue,
    repairSections: repair.sections,
    repairEditorial: false,
  };
}

/** Validate all independent boundaries together so a repair sees every defect. */
function inspectDraft(
  value: unknown,
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
): { result: { draft: Draft; research: Research; memo: Draft["memo"] } } | { repair: Repair; draft?: Draft } {
  const parsed = memoDraftSchema.safeParse(value);
  if (!parsed.success) {
    const sections = new Set<MemoSection>();
    let editorial = false;
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "memo") {
        const key = issue.path[1] as MemoSection;
        (sectionKeys.includes(key) ? [key] : sectionKeys).forEach((k) => sections.add(k));
      } else {
        editorial = true;
        if (!issue.path.length) sectionKeys.forEach((k) => sections.add(k));
      }
    }
    return { repair: { sections: [...sections], editorial, issue: parsed.error.message } };
  }
  const draft = parsed.data;
  let research: Research;
  try {
    research = bindStagedEditorial(frozen, staged, {
      rationale: draft.rationale,
      narrativePlan: draft.narrativePlan,
    });
  } catch (error) {
    return { repair: { sections: [], editorial: true, issue: String(error) }, draft };
  }
  const issues: string[] = [],
    sections = new Set<MemoSection>();
  let editorial = false;
  try {
    validateMemoPlan(research, staged);
  } catch (error) {
    editorial = true;
    if (error instanceof MemoPlanRepair) {
      return {
        repair: {
          sections: error.sections as MemoSection[],
          editorial: true,
          planOnly: true,
          issue: error.message,
          missingRequirementIds: error.missingRequirementIds,
          missingResolutionFields: error.missingResolutionFields,
        },
        draft,
      };
    }
    issues.push(String(error));
  }
  let memo = draft.memo;
  try {
    memo = validateMemoCopy(memo, research, staged);
  } catch (error) {
    (error instanceof MemoCopyRepair ? error.sections : sectionKeys).forEach((k) =>
      sections.add(k),
    );
    issues.push(String(error));
  }
  for (const key of ["candidateFit", "decisionConditions"] as const) {
    try {
      validateMemoSectionCoverage(key, memo, research.narrativePlan, staged);
    } catch (error) {
      sections.add(key);
      issues.push(String(error));
    }
  }
  if (issues.length)
    return { repair: { sections: [...sections], editorial, issue: issues.join("; ") }, draft };
  return { result: { draft, research, memo } };
}

/** A repair can replace only explicitly requested blocks. Untouched output is
 * retained byte-for-byte, including factual review and durable checkpoints. */
async function writeMemo(
  writer: ReasoningModel,
  packet: unknown,
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
  onStage: (stage: string) => void,
  previous?: Draft,
  requested?: Repair,
) {
  let value: unknown = previous,
    repair = requested,
    lastResponse: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const shape: z.ZodRawShape = {};
    if (repair?.editorial) {
      if (repair.planOnly) {
        shape.narrativePlan = memoPlanPatchSchema;
      } else {
        shape.rationale = memoDraftSchema.shape.rationale;
        shape.narrativePlan = memoDraftSchema.shape.narrativePlan;
      }
    }
    if (repair?.sections.length && !repair.planOnly)
      shape.memo = compositionSchema
        .pick(
          Object.fromEntries(repair.sections.map((k) => [k, true])) as Record<MemoSection, true>,
        )
        .strict();
    const schema = repair ? z.object(shape).strict() : memoDraftSchema;
    const instruction = repair
      ? memoWritingInstruction +
        (repair.planOnly
          ? "\nPLAN-ONLY REPAIR MODE: Return only narrativePlan.memoPoints, and only points in repairSections. For an existing point ID, preserve its text, claimIds, and existing references; only add the requested missingRequirementIds/missingResolutionFields. New points are allowed only when needed to attach requested targets. Do not return or alter any other plan fields, memo prose, rationale, or unrelated references."
          : "\nREPAIR MODE: Return ONLY the blocks requested by the response schema. Other blocks are application-preserved; do not regenerate them. Keep narrative point IDs and unaffected assignments stable. Correct every listed issue.")
      : memoWritingInstruction;
    const response = await writer.generate(
      instruction,
      repair
        ? compactMemoRepairInput(
            packet as ReturnType<typeof memoInputPacket>,
            value as Draft | undefined,
            repair,
            frozen,
            staged,
          )
        : packet,
      outputSchemaFor(writer, schema),
      { stage: repair ? "memo-repair" : "memo-draft", attempt: attempt + 1 },
    );
    lastResponse = response;
    if (repair) {
      const patch = schema.safeParse(response);
      if (!patch.success) {
        repair = { ...repair, issue: repair.issue + "; Patch schema: " + patch.error.message };
        continue;
      }
      const prior = value as Partial<Draft> | undefined;
      if (repair.planOnly && prior?.narrativePlan && patch.data.narrativePlan) {
        const allowed = new Set(repair.sections);
        const priorPoints = prior.narrativePlan.memoPoints ?? [];
        const priorById = new Map(priorPoints.map((point) => [point.id, point]));
        const returned = memoPlanPatchSchema.parse(patch.data.narrativePlan).memoPoints;
        if (returned.some((point) => !allowed.has(point.section as MemoSection))) {
          repair = {
            ...repair,
            issue: repair.issue + "; Plan patch returned a memoPoint outside repairSections",
          };
          continue;
        }
        const invalidIdentity = returned.some((point) => {
          const existing = priorById.get(point.id);
          return existing && !allowed.has(existing.section as MemoSection);
        });
        if (invalidIdentity) {
          repair = {
            ...repair,
            issue: repair.issue + "; Plan patch attempted to reuse an unaffected memoPoint id",
          };
          continue;
        }
        const mergedById = new Map(priorPoints.map((point) => [point.id, point]));
        returned.forEach((point) => mergedById.set(point.id, point));
        const nextPlan = {
          ...prior.narrativePlan,
          memoPoints: [...mergedById.values()],
        };
        try {
          validateTargetedPlanRepair(prior.narrativePlan, nextPlan, {
            sections: repair.sections,
            requirementIds: repair.missingRequirementIds ?? [],
            resolutionFields: repair.missingResolutionFields ?? [],
            allowedRequirementIds: staged.trace.requirements.map((requirement) => requirement.id),
            allowedResolutionFields: staged.trace.resolutions.map((resolution) => resolution.field),
          });
        } catch (error) {
          repair = { ...repair, issue: repair.issue + "; " + String(error) };
          continue;
        }
        value = {
          rationale: prior.rationale,
          narrativePlan: nextPlan,
          memo: prior.memo,
        };
      } else {
        value = {
          rationale: patch.data.rationale ?? prior?.rationale,
          narrativePlan: patch.data.narrativePlan ?? prior?.narrativePlan,
          memo: { ...prior?.memo, ...patch.data.memo },
        };
      }
    } else value = response;
    const checked = inspectDraft(value, frozen, staged);
    if ("result" in checked) return checked.result;
    if (checked.draft) value = checked.draft;
    repair = checked.repair;
    onStage("Correcting only the affected memo blocks");
  }
  await writer.discardResponse?.(lastResponse);
  throw new Error(`Dossier generation needs source/reasoning repair: ${repair?.issue}`);
}

function memoWriter(
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
  model: ReasoningModel,
): ReasoningModel {
  const catalog = {
    claimIds: frozen.evidence.map((c) => c.id),
    requirementIds: staged.trace.requirements.map((r) => r.id),
    resolutionFields: staged.trace.resolutions.map((r) => r.field),
  };
  return {
    id: model.id,
    version: model.version,
    configurationFingerprint: model.configurationFingerprint,
    schemaFormat: model.schemaFormat,
    discardResponse: model.discardResponse?.bind(model),
    generate: (instruction, input, schema, metadata) =>
      model.generate(
        instruction,
        input,
        schema ? bindMemoReferences(schema, catalog) : schema,
        metadata,
      ),
  };
}

/** A structurally validated draft deliberately carries no factual-review receipt. */
export async function composeStagedDraft(
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
  model: ReasoningModel,
  onStage: (stage: string) => void = () => {},
): Promise<Dossier> {
  const result = await writeMemo(
    memoWriter(frozen, staged, model),
    memoInputPacket(frozen, staged),
    frozen,
    staged,
    onStage,
  );
  return {
    ...assembleMemo(frozen, result.research, result.memo, model),
    sourceInputFingerprint: frozen.fingerprint,
    canonicalDecisionTrace: structuredClone(staged.trace) as unknown as JsonValue,
  };
}

export async function composeStagedDossier(
  frozen: StagedResearchInput,
  staged: StagedDecisionResult,
  model: ReasoningModel,
  factualReviewer: ReasoningModel,
  onStage: (stage: string) => void = () => {},
  initialDraft?: Dossier,
  onDefect: () => Promise<void> = async () => {},
) {
  const accepted = new Map<string, FactualReviewReceipt>();
  const writer = memoWriter(frozen, staged, model);
  onStage("Writing the complete executive memo");
  const packet = memoInputPacket(frozen, staged);
  let previous: Draft | undefined = initialDraft
    ? memoDraftSchema.parse({
        rationale: initialDraft.verdict.rationale,
        narrativePlan: initialDraft.narrativePlan,
        memo: compositionSchema.parse(initialDraft),
      })
    : undefined;
  let repair: Repair | undefined;
  for (let reviewAttempt = 0; reviewAttempt < 3; reviewAttempt++) {
    const seeded = previous && !repair ? inspectDraft(previous, frozen, staged) : undefined;
    if (seeded && !("result" in seeded)) throw new Error("REVIEW_DRAFT_INVALID");
    const result =
      seeded && "result" in seeded
        ? seeded.result
        : await writeMemo(writer, packet, frozen, staged, onStage, previous, repair);
    onStage("Checking factual support for the memo");
    let receipts: FactualReviewReceipt[];
    try {
      receipts = await reviewMemo(
        factualReviewer,
        frozen,
        staged,
        result.research,
        result.memo,
        accepted,
        onDefect,
      );
    } catch (error) {
      if (error instanceof MemoReviewRepair) await onDefect();
      if (!(error instanceof MemoReviewRepair) || reviewAttempt === 2) throw error;
      previous = result.draft;
      repair = { sections: error.sections, editorial: false, issue: error.message };
      onStage("Correcting the memo against its source evidence");
      continue;
    }
    const dossier = assembleMemo(frozen, result.research, result.memo, model);
    onStage("Ready");
    return {
      ...dossier,
      generation: {
        ...dossier.generation,
        factualReviewer: {
          model: `${factualReviewer.id}/${factualReviewer.version}`,
          policyVersion: FACTUAL_REVIEW_POLICY_VERSION,
        },
        factualReviews: receipts,
      },
      sourceInputFingerprint: frozen.fingerprint,
      canonicalDecisionTrace: structuredClone(staged.trace) as unknown as JsonValue,
    };
  }
  throw new Error("MEMO_REVIEW_EXHAUSTED");
}