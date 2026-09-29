/**
 * src/pursuit/role-brief.ts
 *
 * Narrow read-only adapter from RADAR's evaluation output to the input the
 * Pursuit Cockpit needs. Keeping this translation in one small file is what lets
 * the rest of src/pursuit/ stay portable: if the upstream dossier contract
 * changes, only this file moves.
 */

import type { ServedOpportunity } from "../data/opportunity-fixtures";
import { isEvaluated } from "../data/opportunity-fixtures";
import type { Dossier } from "../dossier/contracts";

export interface RoleRequirement {
  requirement: string;
  mandatory: boolean;
  decisionRole: string;
  status: string;
  reasoning: string;
  /** Canonical dossier lineage: the evaluation's own relational evidence. */
  roleClaimIds: string[];
  candidateClaimIds: string[];
  /** Text of the dossier candidate claims this requirement was judged on. */
  candidateEvidence: string[];
}

/** Canonical evaluation lineage carried from the serving read model. */
export interface BriefLineage {
  opportunityVersion: string | null;
  evaluationContextFingerprint: string | null;
  evaluationFingerprint: string | null;
}

/**
 * Everything the pursuit reasoning is allowed to know about the role. Note what
 * is absent: no candidate facts. Those come only from the Evidence Ledger, so a
 * job description can never manufacture a candidate achievement.
 */
export interface RoleBrief {
  jobHash: string;
  company: string;
  roleTitle: string;
  location: string | null;
  verdict: string | null;
  recommendation: string | null;
  whyNow: string | null;
  mandateArchetype: string | null;
  primaryDriver: string | null;
  primaryRisk: string | null;
  hiringRisk: string | null;
  positioning: string[];
  requirements: RoleRequirement[];
  /** Mandate priorities and outcomes carried verbatim from the memo. */
  mandatePriorities: string[];
  mandateOutcomes: string[];
  /** Unresolved decision conditions become interview questions, not silence. */
  openQuestions: string[];
  executiveThesis: string | null;
  applyUrl: string | null;
  lineage: BriefLineage;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function fromDossier(dossier: Dossier): Partial<RoleBrief> {
  const candidateText = new Map(
    (dossier.evidence?.candidateClaims ?? []).map((claim) => [claim.id, claim.text]),
  );
  return {
    executiveThesis: text(dossier.executiveThesis?.text),
    mandatePriorities: (dossier.mandate?.priorities ?? []).map((p) => p.text),
    mandateOutcomes: (dossier.mandate?.outcomes ?? []).map((p) => p.text),
    openQuestions: (dossier.decisionConditions ?? [])
      .map((condition) => condition.question?.text)
      .filter((value): value is string => Boolean(value)),
    requirements: (dossier.verdict?.requirements ?? []).map((requirement) => ({
      requirement: requirement.requirement,
      mandatory: requirement.mandatory,
      decisionRole: requirement.decisionRole,
      status: requirement.status,
      reasoning: requirement.reasoning,
      roleClaimIds: requirement.roleClaimIds ?? [],
      candidateClaimIds: requirement.candidateClaimIds ?? [],
      candidateEvidence: (requirement.candidateClaimIds ?? [])
        .map((id) => candidateText.get(id))
        .filter((value): value is string => Boolean(value)),
    })),
    verdict: dossier.verdict?.verdict ?? null,
  };
}

export function toRoleBrief(opportunity: ServedOpportunity): RoleBrief {
  const base: RoleBrief = {
    jobHash: opportunity.jobHash,
    company: (opportunity as { company?: string }).company ?? "Unknown company",
    roleTitle: (opportunity as { role?: string }).role ?? "Unknown role",
    location: null,
    verdict: null,
    recommendation: null,
    whyNow: null,
    mandateArchetype: null,
    primaryDriver: null,
    primaryRisk: null,
    hiringRisk: null,
    positioning: [],
    requirements: [],
    mandatePriorities: [],
    mandateOutcomes: [],
    openQuestions: [],
    executiveThesis: null,
    applyUrl: null,
    lineage: {
      opportunityVersion: text((opportunity as { opportunityVersion?: string }).opportunityVersion),
      evaluationContextFingerprint: text(opportunity.evaluationContextFingerprint),
      evaluationFingerprint: text(opportunity.evaluationFingerprint),
    },
  };

  if (!isEvaluated(opportunity)) return base;

  const evaluated = opportunity;
  const brief: RoleBrief = {
    ...base,
    location: text(evaluated.location),
    verdict: text(evaluated.decision),
    recommendation: text(evaluated.recommendation),
    whyNow: text(evaluated.whyNow),
    mandateArchetype: text(evaluated.mandateArchetype),
    primaryDriver: text(evaluated.primaryDriver),
    primaryRisk: text(evaluated.primaryRisk),
    hiringRisk: text(evaluated.hiringRisk),
    positioning: Array.isArray(evaluated.positioning) ? evaluated.positioning : [],
    applyUrl: text(evaluated.applyUrl),
  };

  return evaluated.richDossier ? { ...brief, ...fromDossier(evaluated.richDossier) } : brief;
}
