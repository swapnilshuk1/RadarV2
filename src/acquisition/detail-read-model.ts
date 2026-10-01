import type { DatabaseAdapter } from '@/data/database';
import { RICH_DOSSIER_FAILURE_VERSION } from '@/data/sqlite/repositories/SqliteRichDossierStore';
import type {
  AcquisitionFeedState,
  AttentionGateExplanation,
  ScrapedJobDetail,
  ScreeningDriverDetail,
} from './contracts';

const REASON_EXPLANATIONS: Record<
  string,
  { title: string; description: string; impact: 'match' | 'review' | 'exclude' }
> = {
  ROLE_FAMILY_MATCH: {
    title: 'Target Role Family Match',
    description: 'The job title matches one of the target role families defined in your career search plan.',
    impact: 'match',
  },
  ADJACENT_ROLE_FAMILY: {
    title: 'Adjacent Role Family',
    description: 'The job title is closely related to your target executive roles.',
    impact: 'match',
  },
  ROLE_UNKNOWN: {
    title: 'Role Designation Advisory',
    description: 'The title does not match an explicit role family in the search plan, but was admitted for review without contradiction.',
    impact: 'review',
  },
  EXCLUDED_COMPANY: {
    title: 'Excluded Company',
    description: 'The employer is included on your company exclusion list.',
    impact: 'exclude',
  },
  FUNCTION_CONTRADICTION: {
    title: 'Function Contradiction',
    description: 'The business domain or function contradicts your specified target career areas.',
    impact: 'exclude',
  },
  FUNCTION_REVIEW: {
    title: 'Function Requires Review',
    description: 'The job function is in an adjacent domain and requires review.',
    impact: 'review',
  },
  SENIORITY_CONTRADICTION: {
    title: 'Seniority Level Contradiction',
    description: 'The seniority level indicated in the title or posting is outside the executive scope of your search.',
    impact: 'exclude',
  },
  SENIORITY_REVIEW: {
    title: 'Seniority Level Review',
    description: 'The seniority level requires review against executive leadership criteria.',
    impact: 'review',
  },
  EMPLOYMENT_CONTRADICTION: {
    title: 'Employment Type Contradiction',
    description: 'The employment type is outside your executive search scope.',
    impact: 'exclude',
  },
  LOCATION_CONTRADICTION: {
    title: 'Location Outside Target Scope',
    description: 'The job location is outside target geographies without compatible remote/hybrid flexibility.',
    impact: 'exclude',
  },
  LOCATION_REVIEW: {
    title: 'Location Requires Review',
    description: 'The location policy indicates cross-market or remote potential that requires editorial verification.',
    impact: 'review',
  },
  UNUSABLE_PROJECTION: {
    title: 'Unusable Job Projection',
    description: 'The captured content lacked sufficient structured detail to form a complete job projection.',
    impact: 'exclude',
  },
};

interface CandidateDetailRow {
  canonical_job_id: string;
  opportunity_version: string;
  job_hash: string;
  role: string;
  company: string;
  location: string;
  source: string;
  canonical_url: string | null;
  posted_at: string | null;
  raw_content: string | null;
  lifecycle_state: string;
  acquisition_status: string | null;
  captured_at: string | null;
  attention_decision: 'CANDIDATE' | 'NOT_CANDIDATE';
  eligibility: string | null;
  eligibility_reason_codes_json: string | null;
  location_policy: string | null;
  location_evidence: string | null;
  attention_created_at: string;
  se_evaluation_state: string | null;
  se_decision: string | null;
  se_screening_viability: string | null;
  se_blocked_reason: string | null;
  se_evaluation_json: string | null;
  se_evaluated_at: string | null;
  se_model_id: string | null;
  me_evaluation_state: string | null;
  me_decision: string | null;
  me_quality_score: number | null;
  me_rationale: string | null;
  me_evaluation_fingerprint: string | null;
  me_materialized_at: string | null;
  er_status: string | null;
  ej_status: string | null;
  ej_error: string | null;
  ej_updated_at: string | null;
  rq_reason: string | null;
  has_failure_presentation: number;
}

export async function readScrapedJobDetail(
  db: DatabaseAdapter,
  scope: { tenantId: string; personId: string },
  activeContext: { contextFingerprint: string; searchPlanId: string },
  jobHash: string
): Promise<ScrapedJobDetail | null> {
  const row = await db.one<CandidateDetailRow>(
    `SELECT
       co.id AS canonical_job_id,
       ov.id AS opportunity_version,
       co.source_job_id AS job_hash,
       ov.job_title AS role,
       COALESCE(ov.company_name, co.company_name, 'Unknown company') AS company,
       COALESCE(ov.location, '') AS location,
       co.source,
       co.canonical_url,
       ov.posted_at,
       ov.raw_content,
       ov.lifecycle_state,
       ov.acquisition_status,
       co.created_at AS captured_at,
       spc.attention_decision,
       spc.eligibility,
       spc.eligibility_reason_codes_json,
       spc.location_policy,
       spc.location_evidence,
       spc.created_at AS attention_created_at,
       se.evaluation_state AS se_evaluation_state,
       se.decision AS se_decision,
       se.screening_viability AS se_screening_viability,
       se.blocked_reason AS se_blocked_reason,
       se.evaluation_json AS se_evaluation_json,
       se.evaluated_at AS se_evaluated_at,
       se.model_id AS se_model_id,
       me.evaluation_state AS me_evaluation_state,
       me.decision AS me_decision,
       me.quality_score AS me_quality_score,
       me.rationale AS me_rationale,
       me.evaluation_fingerprint AS me_evaluation_fingerprint,
       me.materialized_at AS me_materialized_at,
       er.status AS er_status,
       ej.status AS ej_status,
       ej.last_error AS ej_error,
       ej.updated_at AS ej_updated_at,
       rq.reason AS rq_reason,
       CASE WHEN EXISTS(
         SELECT 1 FROM materialized_dossier_presentations p
         WHERE p.tenant_id = spc.tenant_id
           AND p.person_id = spc.person_id
           AND p.canonical_job_id = spc.canonical_job_id
           AND p.opportunity_version = spc.opportunity_version
           AND p.evaluation_context_fingerprint = ?
           AND p.presentation_version = '${RICH_DOSSIER_FAILURE_VERSION}'
       ) THEN 1 ELSE 0 END AS has_failure_presentation
     FROM canonical_opportunities co
     JOIN search_plan_candidates spc ON spc.canonical_job_id = co.id
     JOIN opportunity_versions ov ON ov.id = spc.opportunity_version AND ov.canonical_job_id = co.id
     LEFT JOIN staged_evaluations se ON se.tenant_id = spc.tenant_id
       AND se.person_id = spc.person_id
       AND se.canonical_job_id = spc.canonical_job_id
       AND se.opportunity_version = spc.opportunity_version
       AND se.evaluation_context_fingerprint = ?
     LEFT JOIN materialized_evaluations me ON me.tenant_id = spc.tenant_id
       AND me.person_id = spc.person_id
       AND me.canonical_job_id = spc.canonical_job_id
       AND me.opportunity_version = spc.opportunity_version
       AND me.evaluation_context_fingerprint = ?
     LEFT JOIN evaluation_requirements er ON er.tenant_id = spc.tenant_id
       AND er.person_id = spc.person_id
       AND er.search_plan_id = spc.search_plan_id
       AND er.canonical_job_id = spc.canonical_job_id
       AND er.opportunity_version = spc.opportunity_version
       AND er.evaluation_context_fingerprint = ?
     LEFT JOIN evaluation_jobs ej ON ej.tenant_id = spc.tenant_id
       AND ej.person_id = spc.person_id
       AND ej.search_plan_id = spc.search_plan_id
       AND ej.canonical_job_id = spc.canonical_job_id
       AND ej.opportunity_version = spc.opportunity_version
       AND ej.evaluation_context_fingerprint = ?
     LEFT JOIN recovery_queue rq ON rq.tenant_id = spc.tenant_id
       AND rq.canonical_job_id = spc.canonical_job_id
       AND rq.opportunity_version_id = spc.opportunity_version
       AND rq.reason = 'SOURCE_NOT_JOB_DESCRIPTION'
     WHERE co.source_job_id = ?
       AND spc.tenant_id = ?
       AND spc.person_id = ?
       AND spc.search_plan_id = ?
       AND ov.lifecycle_state = 'ACTIVE'
     LIMIT 1`,
    [
      activeContext.contextFingerprint,
      activeContext.contextFingerprint,
      activeContext.contextFingerprint,
      activeContext.contextFingerprint,
      activeContext.contextFingerprint,
      jobHash,
      scope.tenantId,
      scope.personId,
      activeContext.searchPlanId,
    ]
  );

  if (!row) {
    return null;
  }

  // Derive canonical pipeline state
  let state: AcquisitionFeedState = 'WAITING';
  if (row.rq_reason === 'SOURCE_NOT_JOB_DESCRIPTION') {
    state = 'NEEDS_ATTENTION';
  } else if (row.se_evaluation_state === 'COMPLETED' && row.se_decision === 'PASS') {
    state = 'NOT_PURSUED';
  } else if (
    row.me_evaluation_state === 'STAGED_EVALUATED' &&
    ['PURSUE', 'CONSIDER', 'PASS'].includes(row.me_decision || '') &&
    (row.me_evaluation_fingerprint?.trim().length ?? 0) > 0 &&
    row.me_quality_score === null
  ) {
    state = 'READY';
  } else if (
    row.er_status === 'FAILED' ||
    row.ej_status === 'staged_dead_letter' ||
    ['CAPTURE_FAILED', 'RECOVERY_FAILED'].includes(row.acquisition_status || '') ||
    row.has_failure_presentation === 1
  ) {
    state = 'NEEDS_ATTENTION';
  } else if (row.attention_decision === 'NOT_CANDIDATE') {
    state = 'OUTSIDE_SEARCH';
  } else if (row.ej_status === 'staged_processing') {
    state = 'PROCESSING';
  } else if (row.ej_status === 'staged_completed') {
    state = 'PREPARING';
  } else {
    state = 'WAITING';
  }

  const decision = row.me_decision || row.se_decision || null;

  // Parse attention gate reason codes
  let reasonCodes: string[] = [];
  try {
    if (row.eligibility_reason_codes_json) {
      const parsed = JSON.parse(row.eligibility_reason_codes_json);
      if (Array.isArray(parsed)) {
        reasonCodes = parsed.filter((c): c is string => typeof c === 'string');
      }
    }
  } catch {
    reasonCodes = [];
  }

  const explanations: AttentionGateExplanation[] = reasonCodes.map((code) => {
    const meta = REASON_EXPLANATIONS[code];
    return {
      code,
      title: meta ? meta.title : code.replace(/_/g, ' '),
      description:
        meta
          ? meta.description
          : `Determined by attention gate criterion ${code}.`,
      impact: meta ? meta.impact : 'review',
    };
  });

  // Parse staged evaluation drivers if available
  let screeningDrivers: ScreeningDriverDetail[] = [];
  let decisionHinges: Array<{ requirementIds: string[]; resolutionFields?: string[] }> | undefined;
  if (row.se_evaluation_json) {
    try {
      const evalData = JSON.parse(row.se_evaluation_json);
      const evalPayload =
        evalData && typeof evalData === 'object' && 'evaluation' in evalData && evalData.evaluation
          ? evalData.evaluation
          : evalData;
      const drivers =
        evalData.trace?.eligibleScreeningDrivers ||
        evalPayload.eligibleScreeningDrivers ||
        evalData.eligibleScreeningDrivers;
      if (Array.isArray(drivers)) {
        screeningDrivers = drivers.map((d: any) => ({
          id: String(d.id || ''),
          requirement: String(d.requirement || ''),
          strength: String(d.strength || 'REQUIRED'),
          status: String(d.status || 'UNKNOWN'),
          reasoning: d.reasoning ? String(d.reasoning) : undefined,
          screeningReasoning: d.screeningReasoning ? String(d.screeningReasoning) : undefined,
          mappingReasoning: d.mappingReasoning ? String(d.mappingReasoning) : undefined,
          gapNature: d.gapNature ? String(d.gapNature) : undefined,
          gapReasoning: d.gapReasoning ? String(d.gapReasoning) : undefined,
        }));
      }
      const decisionNode = evalData.decision || evalPayload.decision || evalData.trace?.decision;
      if (Array.isArray(decisionNode?.decisionHinges)) {
        decisionHinges = decisionNode.decisionHinges;
      }
    } catch {
      screeningDrivers = [];
    }
  }

  const evaluation =
    row.se_evaluation_state || row.me_evaluation_state
      ? {
          state: row.me_evaluation_state || row.se_evaluation_state,
          verdict: decision,
          screeningViability: row.se_screening_viability || null,
          blockedReason: row.se_blocked_reason || null,
          evaluatedAt: row.se_evaluated_at || row.me_materialized_at || null,
          modelId: row.se_model_id || null,
          qualityScore: row.me_quality_score,
          rationale: row.me_rationale || null,
          screeningDrivers,
          decisionHinges,
        }
      : null;

  // Diagnostics breakdown
  let diagStage = 'Intake';
  let diagStatus = 'Admitted to Search';
  let diagDetails = 'Job capture admitted and awaiting processing.';
  if (state === 'OUTSIDE_SEARCH') {
    diagStage = 'Attention Gate';
    diagStatus = 'Outside Target Search Criteria';
    diagDetails = reasonCodes.length
      ? `Excluded due to: ${reasonCodes.join(', ')}.`
      : 'Excluded from evaluation by search plan attention gate.';
  } else if (state === 'NOT_PURSUED') {
    diagStage = 'Staged Evaluation';
    diagStatus = 'Evaluated — PASS (Not Shortlisted)';
    diagDetails = row.se_blocked_reason
      ? `Evaluation concluded PASS: ${row.se_blocked_reason}`
      : 'Role was evaluated and determined PASS based on screening requirements and role fit.';
  } else if (state === 'READY') {
    diagStage = 'Dossier Delivery';
    diagStatus = `Executive Dossier Ready (${decision || 'Reviewed'})`;
    diagDetails = 'Evaluation and executive memo dossier are complete and ready for executive review.';
  } else if (state === 'PREPARING') {
    diagStage = 'Dossier Composition';
    diagStatus = 'Composing Executive Memo';
    diagDetails = 'Evaluation is complete; detailed memo presentation is being drafted and verified.';
  } else if (state === 'PROCESSING') {
    diagStage = 'Intelligence Worker';
    diagStatus = 'Analysis In Progress';
    diagDetails = 'Worker is actively analyzing role requirements, candidate evidence, and context.';
  } else if (state === 'NEEDS_ATTENTION') {
    diagStage = 'Recovery / Attention';
    diagStatus = 'Attention Required';
    diagDetails =
      row.rq_reason === 'SOURCE_NOT_JOB_DESCRIPTION'
        ? 'Captured payload was flagged as non-job-description content.'
        : row.ej_error
          ? `Worker error: ${row.ej_error}`
          : 'Processing encountered an unrecoverable state or validation failure.';
  }

  return {
    id: row.canonical_job_id,
    version: row.opportunity_version,
    jobHash: row.job_hash,
    role: row.role,
    company: row.company,
    location: row.location,
    source: row.source,
    canonicalUrl: row.canonical_url,
    applyUrl: row.canonical_url,
    postedAt: row.posted_at,
    capturedAt: row.captured_at,
    description: row.raw_content || '',
    state,
    decision,
    attentionGate: {
      decision: row.attention_decision,
      eligibility: row.eligibility,
      reasonCodes,
      explanations,
      locationPolicy: row.location_policy,
      locationEvidence: row.location_evidence,
      createdAt: row.attention_created_at,
    },
    evaluation,
    diagnostics: {
      stage: diagStage,
      status: diagStatus,
      details: diagDetails,
      recoveryReason: row.rq_reason,
      error: row.ej_error,
    },
  };
}
