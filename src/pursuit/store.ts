/**
 * src/pursuit/store.ts
 *
 * All persistence for the Pursuit Cockpit. Deliberately a single narrow module
 * over the shared DatabaseAdapter so the whole feature can be lifted into the
 * upstream RADAR repository without dragging repository-layer changes with it.
 *
 * Every read and write is tenant+person scoped. Nothing here trusts a caller
 * supplied scope: the server functions resolve scope before calling in.
 */

import { randomUUID } from "node:crypto";
import { getDatabaseAdapter } from "../data/database";
import type { DatabaseAdapter } from "../data/database/adapter";
import type {
  ArchetypeInput,
  ArtifactContent,
  ArtifactStatus,
  ArtifactType,
  CandidateArchetype,
  CandidateClaim,
  ClaimProvenance,
  ClaimType,
  LearningSignal,
  PreparationState,
  Pursuit,
  PursuitActivity,
  PursuitArtifact,
  PursuitStatus,
  PursuitThesis,
  StyleProfile,
} from "./types";

export interface Scope {
  tenantId: string;
  personId: string;
}

const db = (): DatabaseAdapter => getDatabaseAdapter();
const now = () => new Date().toISOString();
const json = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Evidence Ledger
// ---------------------------------------------------------------------------

interface ClaimRow {
  id: string;
  statement: string;
  claim_type: string;
  employer: string | null;
  role_title: string | null;
  metric_baseline: string | null;
  metric_result: string | null;
  capabilities_json: string;
  source_document_id: string | null;
  source_evidence_graph_id: string | null;
  source_fact_id: string | null;
  source_locator: string | null;
  provenance: string;
  verification_state: string;
  confidence: number | null;
  metric_locked: number;
  source_ordinal: number | null;
}

const toClaim = (row: ClaimRow): CandidateClaim => ({
  id: row.id,
  statement: row.statement,
  claimType: row.claim_type as ClaimType,
  employer: row.employer,
  roleTitle: row.role_title,
  metricBaseline: row.metric_baseline,
  metricResult: row.metric_result,
  capabilities: json<string[]>(row.capabilities_json, []),
  sourceDocumentId: row.source_document_id,
  sourceEvidenceGraphId: row.source_evidence_graph_id,
  sourceFactId: row.source_fact_id,
  sourceLocator: row.source_locator,
  provenance: row.provenance as ClaimProvenance,
  verificationState: row.verification_state,
  confidence: row.confidence,
  metricLocked: row.metric_locked === 1,
  sourceOrdinal: row.source_ordinal ?? null,
});

const CLAIM_COLUMNS = `id, statement, claim_type, employer, role_title, metric_baseline,
  metric_result, capabilities_json, source_document_id, source_evidence_graph_id,
  source_fact_id, source_locator, provenance, verification_state, confidence, metric_locked,
  source_ordinal`;

export async function listClaims(scope: Scope): Promise<CandidateClaim[]> {
  const rows = await db().many<ClaimRow>(
    `SELECT ${CLAIM_COLUMNS} FROM candidate_claims
     WHERE tenant_id = ? AND person_id = ? AND current_projection = 1
     ORDER BY CASE claim_type WHEN 'ACHIEVEMENT' THEN 0 WHEN 'LEADERSHIP' THEN 1
       WHEN 'EMPLOYMENT' THEN 2 ELSE 3 END, created_at ASC`,
    [scope.tenantId, scope.personId],
  );
  return rows.map(toClaim);
}

/** Pursuit reads remain pinned even after the Profile vault moves to a newer CV. */
export async function listClaimsForProfile(scope: Scope, profileVersion: string): Promise<CandidateClaim[]> {
  if (!profileVersion) throw new Error("PURSUIT_PROFILE_LINEAGE_MISSING");
  const rows = await db().many<ClaimRow>(
    `SELECT c.${CLAIM_COLUMNS.replace(/,\s*/g, ", c.")} FROM candidate_claims c
     WHERE c.tenant_id = ? AND c.person_id = ? AND EXISTS (
       SELECT 1 FROM profile_projection_source_bindings b
       WHERE b.tenant_id = c.tenant_id AND b.person_id = c.person_id
         AND b.profile_version = ? AND b.evidence_graph_id = c.source_evidence_graph_id
     )
     ORDER BY CASE c.claim_type WHEN 'ACHIEVEMENT' THEN 0 WHEN 'LEADERSHIP' THEN 1
       WHEN 'EMPLOYMENT' THEN 2 ELSE 3 END, c.created_at ASC`,
    [scope.tenantId, scope.personId, profileVersion],
  );
  return rows.map(toClaim);
}

export interface ClaimUpsert {
  statement: string;
  claimType: ClaimType;
  employer?: string | null;
  roleTitle?: string | null;
  metricBaseline?: string | null;
  metricResult?: string | null;
  capabilities?: string[];
  sourceDocumentId?: string | null;
  sourceEvidenceGraphId: string;
  sourceFactId: string;
  sourceLocator?: string | null;
  provenance?: ClaimProvenance;
  verificationState?: string;
  confidence?: number | null;
  sourceOrdinal?: number | null;
  profileVersion?: string | null;
}

/**
 * Reprojection of one graph is idempotent; a later immutable graph creates a
 * distinct claim even when its extractor reuses the same fact ID.
 */
export async function upsertClaims(scope: Scope, claims: readonly ClaimUpsert[], currentProjection = true): Promise<number> {
  if (claims.length === 0) return 0;
  const timestamp = now();
  let written = 0;
  for (const claim of claims) {
    await db().execute(
      `INSERT INTO candidate_claims (
         id, tenant_id, person_id, statement, claim_type, employer, role_title,
         metric_baseline, metric_result, capabilities_json, source_document_id,
         source_evidence_graph_id, source_fact_id, source_locator, provenance,
         verification_state, confidence, metric_locked, created_at, updated_at,
         source_ordinal, profile_version, current_projection)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (tenant_id, person_id, source_evidence_graph_id, source_fact_id) DO UPDATE SET
         statement = excluded.statement,
         claim_type = excluded.claim_type,
         employer = excluded.employer,
         role_title = excluded.role_title,
         metric_baseline = excluded.metric_baseline,
         metric_result = excluded.metric_result,
         capabilities_json = excluded.capabilities_json,
         source_locator = excluded.source_locator,
         confidence = excluded.confidence,
         source_ordinal = excluded.source_ordinal,
         profile_version = excluded.profile_version,
         current_projection = CASE WHEN excluded.current_projection = 1 THEN 1 ELSE candidate_claims.current_projection END,
         updated_at = excluded.updated_at`,
      [
        `claim-${randomUUID()}`,
        scope.tenantId,
        scope.personId,
        claim.statement,
        claim.claimType,
        claim.employer ?? null,
        claim.roleTitle ?? null,
        claim.metricBaseline ?? null,
        claim.metricResult ?? null,
        JSON.stringify(claim.capabilities ?? []),
        claim.sourceDocumentId ?? null,
        claim.sourceEvidenceGraphId,
        claim.sourceFactId,
        claim.sourceLocator ?? null,
        claim.provenance ?? "SOURCE_BACKED",
        claim.verificationState ?? "EXTRACTED",
        claim.confidence ?? null,
        1,
        timestamp,
        timestamp,
        claim.sourceOrdinal ?? null,
        claim.profileVersion ?? null,
        currentProjection ? 1 : 0,
      ],
    );
    written += 1;
  }
  return written;
}

/** Only claims from the canonical binding are served; the rest stay for lineage. */
export async function markCurrentProjection(
  scope: Scope,
  graphIds: readonly string[],
): Promise<void> {
  if (graphIds.length === 0) {
    await db().execute(
      `UPDATE candidate_claims SET current_projection = 0 WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId],
    );
    return;
  }
  const marks = graphIds.map(() => "?").join(",");
  await db().execute(
    `UPDATE candidate_claims
     SET current_projection = CASE WHEN source_evidence_graph_id IN (${marks}) THEN 1 ELSE 0 END
     WHERE tenant_id = ? AND person_id = ? AND provenance = 'SOURCE_BACKED'`,
    [...graphIds, scope.tenantId, scope.personId],
  );
}

/** Documents in the canonical binding, for anchor-CV selection. */
export async function loadSourceDocumentTexts(
  scope: Scope,
  documentIds: readonly string[],
): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map();
  const marks = documentIds.map(() => "?").join(",");
  const rows = await db().many<{ document_id: string; raw_text: string }>(
    `SELECT document_id, raw_text FROM document_contents
     WHERE tenant_id = ? AND person_id = ? AND document_id IN (${marks})`,
    [scope.tenantId, scope.personId, ...documentIds],
  );
  return new Map(rows.map((row) => [row.document_id, row.raw_text]));
}

/** Documents in the canonical binding, for anchor-CV selection. */
export async function listSourceDocuments(
  scope: Scope,
  documentIds: readonly string[],
): Promise<Array<{ id: string; filename: string; createdAt: string; claimCount: number }>> {
  if (documentIds.length === 0) return [];
  const marks = documentIds.map(() => "?").join(",");
  const rows = await db().many<{
    id: string;
    filename: string;
    created_at: string;
    claim_count: number;
  }>(
    `SELECT d.id, d.filename, d.created_at,
            (SELECT COUNT(*) FROM candidate_claims c WHERE c.tenant_id = d.tenant_id
               AND c.person_id = d.person_id AND c.source_document_id = d.id
               AND c.current_projection = 1) AS claim_count
     FROM candidate_documents d
     WHERE d.tenant_id = ? AND d.person_id = ? AND d.id IN (${marks})
     ORDER BY d.created_at DESC`,
    [scope.tenantId, scope.personId, ...documentIds],
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    createdAt: r.created_at,
    claimCount: r.claim_count,
  }));
}

export async function ledgerCoverage(
  scope: Scope,
): Promise<{ total: number; sourceBacked: number; documents: number }> {
  const row = await db().one<{ total: number; source_backed: number; documents: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN provenance = 'SOURCE_BACKED' THEN 1 ELSE 0 END) AS source_backed,
            COUNT(DISTINCT source_document_id) AS documents
     FROM candidate_claims WHERE tenant_id = ? AND person_id = ? AND current_projection = 1`,
    [scope.tenantId, scope.personId],
  );
  return {
    total: row?.total ?? 0,
    sourceBacked: row?.source_backed ?? 0,
    documents: row?.documents ?? 0,
  };
}

export async function ledgerCoverageForProfile(
  scope: Scope,
  profileVersion: string,
): Promise<{ total: number; sourceBacked: number; documents: number }> {
  if (!profileVersion) throw new Error("PURSUIT_PROFILE_LINEAGE_MISSING");
  const row = await db().one<{ total: number; source_backed: number; documents: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN c.provenance = 'SOURCE_BACKED' THEN 1 ELSE 0 END) AS source_backed,
            COUNT(DISTINCT c.source_document_id) AS documents
     FROM candidate_claims c WHERE c.tenant_id = ? AND c.person_id = ? AND EXISTS (
       SELECT 1 FROM profile_projection_source_bindings b
       WHERE b.tenant_id = c.tenant_id AND b.person_id = c.person_id
         AND b.profile_version = ? AND b.evidence_graph_id = c.source_evidence_graph_id
     )`,
    [scope.tenantId, scope.personId, profileVersion],
  );
  return { total: row?.total ?? 0, sourceBacked: row?.source_backed ?? 0, documents: row?.documents ?? 0 };
}

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

interface ArchetypeRow {
  id: string;
  name: string;
  positioning_statement: string | null;
  emphasize_json: string;
  de_emphasize_json: string;
  target_roles_json: string;
  tone: string | null;
  pinned_claim_ids_json: string;
  anchor_document_ids_json: string;
  is_default: number;
  updated_at: string;
}

const toArchetype = (row: ArchetypeRow): CandidateArchetype => ({
  id: row.id,
  name: row.name,
  positioningStatement: row.positioning_statement,
  emphasize: json<string[]>(row.emphasize_json, []),
  deEmphasize: json<string[]>(row.de_emphasize_json, []),
  targetRoles: json<string[]>(row.target_roles_json, []),
  tone: row.tone,
  pinnedClaimIds: json<string[]>(row.pinned_claim_ids_json, []),
  anchorDocumentIds: json<string[]>(row.anchor_document_ids_json, []),
  isDefault: row.is_default === 1,
  updatedAt: row.updated_at,
});

export async function listArchetypes(scope: Scope): Promise<CandidateArchetype[]> {
  const rows = await db().many<ArchetypeRow>(
    `SELECT id, name, positioning_statement, emphasize_json, de_emphasize_json,
            target_roles_json, tone, pinned_claim_ids_json, anchor_document_ids_json,
            is_default, updated_at
     FROM candidate_archetypes WHERE tenant_id = ? AND person_id = ?
     ORDER BY is_default DESC, name ASC`,
    [scope.tenantId, scope.personId],
  );
  return rows.map(toArchetype);
}

export async function saveArchetype(
  scope: Scope,
  input: ArchetypeInput,
): Promise<CandidateArchetype> {
  const timestamp = now();
  const id = input.id ?? `arch-${randomUUID()}`;
  const params = [
    input.name,
    input.positioningStatement ?? null,
    JSON.stringify(input.emphasize),
    JSON.stringify(input.deEmphasize),
    JSON.stringify(input.targetRoles),
    input.tone ?? null,
    JSON.stringify(input.pinnedClaimIds),
    JSON.stringify(input.anchorDocumentIds),
    input.isDefault ? 1 : 0,
    timestamp,
  ];

  if (input.id) {
    await db().execute(
      `UPDATE candidate_archetypes SET name = ?, positioning_statement = ?, emphasize_json = ?,
         de_emphasize_json = ?, target_roles_json = ?, tone = ?, pinned_claim_ids_json = ?,
         anchor_document_ids_json = ?, is_default = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      [...params, id, scope.tenantId, scope.personId],
    );
  } else {
    await db().execute(
      `INSERT INTO candidate_archetypes (
         id, tenant_id, person_id, name, positioning_statement, emphasize_json,
         de_emphasize_json, target_roles_json, tone, pinned_claim_ids_json,
         anchor_document_ids_json, is_default, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, scope.tenantId, scope.personId, ...params.slice(0, 9), timestamp, timestamp],
    );
  }

  if (input.isDefault) {
    await db().execute(
      `UPDATE candidate_archetypes SET is_default = 0
       WHERE tenant_id = ? AND person_id = ? AND id <> ?`,
      [scope.tenantId, scope.personId, id],
    );
  }

  const row = await db().one<ArchetypeRow>(
    `SELECT id, name, positioning_statement, emphasize_json, de_emphasize_json,
            target_roles_json, tone, pinned_claim_ids_json, anchor_document_ids_json,
            is_default, updated_at
     FROM candidate_archetypes WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [id, scope.tenantId, scope.personId],
  );
  if (!row) throw new Error("ARCHETYPE_SAVE_FAILED");
  return toArchetype(row);
}

export async function deleteArchetype(scope: Scope, archetypeId: string): Promise<void> {
  await db().execute(
    `DELETE FROM candidate_archetypes WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [archetypeId, scope.tenantId, scope.personId],
  );
}

// ---------------------------------------------------------------------------
// Pursuits
// ---------------------------------------------------------------------------

interface PursuitRow {
  id: string;
  job_hash: string;
  company: string | null;
  role_title: string | null;
  active_archetype_id: string | null;
  active_thesis_id: string | null;
  status: string;
  preparation_state: string;
  preparation_error: string | null;
  next_action: string | null;
  next_action_due: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  canonical_job_id: string | null;
  opportunity_version: string | null;
  evaluation_context_fingerprint: string | null;
  evaluation_fingerprint: string | null;
  profile_version: string | null;
}

const PURSUIT_COLUMNS = `id, job_hash, company, role_title, active_archetype_id,
  active_thesis_id, status, preparation_state, preparation_error, next_action,
  next_action_due, notes, created_at, updated_at, canonical_job_id, opportunity_version,
  evaluation_context_fingerprint, evaluation_fingerprint, profile_version`;

const toPursuit = (row: PursuitRow): Pursuit => ({
  id: row.id,
  jobHash: row.job_hash,
  company: row.company,
  roleTitle: row.role_title,
  activeArchetypeId: row.active_archetype_id,
  activeThesisId: row.active_thesis_id,
  status: row.status as PursuitStatus,
  preparationState: row.preparation_state as PreparationState,
  preparationError: row.preparation_error,
  nextAction: row.next_action,
  nextActionDue: row.next_action_due,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lineage: {
    canonicalJobId: row.canonical_job_id,
    opportunityVersion: row.opportunity_version,
    evaluationContextFingerprint: row.evaluation_context_fingerprint,
    evaluationFingerprint: row.evaluation_fingerprint,
    profileVersion: row.profile_version,
  },
});

export async function getPursuit(scope: Scope, jobHash: string): Promise<Pursuit | null> {
  const row = await db().one<PursuitRow>(
    `SELECT ${PURSUIT_COLUMNS} FROM opportunity_pursuits
     WHERE tenant_id = ? AND person_id = ? AND job_hash = ?`,
    [scope.tenantId, scope.personId, jobHash],
  );
  return row ? toPursuit(row) : null;
}

export async function listPursuits(scope: Scope): Promise<Pursuit[]> {
  const rows = await db().many<PursuitRow>(
    `SELECT ${PURSUIT_COLUMNS} FROM opportunity_pursuits
     WHERE tenant_id = ? AND person_id = ?
     ORDER BY CASE status WHEN 'CLOSED_WON' THEN 2 WHEN 'CLOSED_LOST' THEN 2
       WHEN 'WITHDRAWN' THEN 2 ELSE 0 END, updated_at DESC`,
    [scope.tenantId, scope.personId],
  );
  return rows.map(toPursuit);
}

/**
 * Opens (or reuses) the pursuit inside a caller-owned transaction, writing the
 * lineage and the PURSUIT_OPENED activity in the same unit of work. Used by the
 * atomic PURSUE command so a decision can never persist without its pursuit.
 */
export async function openPursuitInTransaction(
  tx: DatabaseAdapter,
  scope: Scope,
  input: { jobHash: string; company?: string | null; roleTitle?: string | null },
  requestedBy: string,
  lineage: {
    canonicalJobId: string | null;
    opportunityVersion: string | null;
    evaluationContextFingerprint: string | null;
    evaluationFingerprint: string | null;
    profileVersion: string | null;
  },
): Promise<{ pursuitId: string; created: boolean }> {
  const found = await tx.one<{ id: string; preparation_state: string }>(
    `SELECT id, preparation_state FROM opportunity_pursuits WHERE tenant_id = ? AND person_id = ? AND job_hash = ?`,
    [scope.tenantId, scope.personId, input.jobHash],
  );
  if (found) {
    if (found.preparation_state === "QUEUED")
      await enqueueInitialPreparation(tx, scope, found.id, input.jobHash, requestedBy);
    return { pursuitId: found.id, created: false };
  }
  const timestamp = now();
  const id = `pursuit-${randomUUID()}`;
  await tx.execute(
    `INSERT INTO opportunity_pursuits (
       id, tenant_id, person_id, job_hash, company, role_title, status, preparation_state,
       canonical_job_id, opportunity_version, evaluation_context_fingerprint,
       evaluation_fingerprint, profile_version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'PREPARING','QUEUED',?,?,?,?,?,?,?)`,
    [
      id,
      scope.tenantId,
      scope.personId,
      input.jobHash,
      input.company ?? null,
      input.roleTitle ?? null,
      lineage.canonicalJobId,
      lineage.opportunityVersion,
      lineage.evaluationContextFingerprint,
      lineage.evaluationFingerprint,
      lineage.profileVersion,
      timestamp,
      timestamp,
    ],
  );
  await tx.execute(
    `INSERT INTO pursuit_activities (
       id, pursuit_id, activity_type, channel, counterparty, summary, occurred_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      `activity-${randomUUID()}`,
      id,
      "PURSUIT_OPENED",
      null,
      null,
      `Pursuit opened for ${input.roleTitle ?? "role"} at ${input.company ?? "company"}.`,
      timestamp,
      timestamp,
    ],
  );
  await enqueueInitialPreparation(tx, scope, id, input.jobHash, requestedBy);
  return { pursuitId: id, created: true };
}

async function enqueueInitialPreparation(
  tx: DatabaseAdapter,
  scope: Scope,
  pursuitId: string,
  jobHash: string,
  requestedBy: string,
): Promise<void> {
  const live = await tx.one<{ id: string }>(
    `SELECT id FROM pursuit_preparation_jobs WHERE pursuit_id = ? AND tenant_id = ?
     AND person_id = ? AND status IN ('queued','processing') LIMIT 1`,
    [pursuitId, scope.tenantId, scope.personId],
  );
  if (live) return;
  const timestamp = now();
  await tx.execute(
    `INSERT INTO pursuit_preparation_jobs
     (id,tenant_id,person_id,pursuit_id,job_hash,requested_by,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'queued',?,?)`,
    [
      `pprep-${randomUUID()}`,
      scope.tenantId,
      scope.personId,
      pursuitId,
      jobHash,
      requestedBy,
      timestamp,
      timestamp,
    ],
  );
}

export async function updatePursuit(
  scope: Scope,
  pursuitId: string,
  patch: Partial<{
    status: PursuitStatus;
    preparationState: PreparationState;
    preparationError: string | null;
    activeArchetypeId: string | null;
    activeThesisId: string | null;
    nextAction: string | null;
    nextActionDue: string | null;
    notes: string | null;
    company: string | null;
    roleTitle: string | null;
    canonicalJobId: string | null;
    opportunityVersion: string | null;
    evaluationContextFingerprint: string | null;
    evaluationFingerprint: string | null;
    profileVersion: string | null;
  }>,
): Promise<void> {
  const columns: Record<string, string> = {
    status: "status",
    preparationState: "preparation_state",
    preparationError: "preparation_error",
    activeArchetypeId: "active_archetype_id",
    activeThesisId: "active_thesis_id",
    nextAction: "next_action",
    nextActionDue: "next_action_due",
    notes: "notes",
    company: "company",
    roleTitle: "role_title",
    canonicalJobId: "canonical_job_id",
    opportunityVersion: "opportunity_version",
    evaluationContextFingerprint: "evaluation_context_fingerprint",
    evaluationFingerprint: "evaluation_fingerprint",
    profileVersion: "profile_version",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      params.push((patch as Record<string, unknown>)[key] ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  params.push(now(), pursuitId, scope.tenantId, scope.personId);
  await db().execute(
    `UPDATE opportunity_pursuits SET ${sets.join(", ")}
     WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    params,
  );
}

// ---------------------------------------------------------------------------
// Theses
// ---------------------------------------------------------------------------

interface ThesisRow {
  id: string;
  pursuit_id: string;
  version: number;
  archetype_id: string | null;
  target_mandate: string;
  win_theme: string;
  recommended_positioning: string;
  primary_proof_json: string;
  objections_json: string;
  narratives_to_avoid_json: string;
  target_audience_json: string;
  archetype_scores_json: string;
  archetype_match_reasoning: string | null;
  route_strategy_json: string;
  semantic_json: string | null;
  derivation: string;
  model_id: string | null;
  created_at: string;
  canonical_job_id: string | null;
  opportunity_version: string | null;
  evaluation_context_fingerprint: string | null;
  evaluation_fingerprint: string | null;
  profile_version: string | null;
  ledger_binding_fingerprint: string | null;
  anchor_document_id: string | null;
}

const THESIS_COLUMNS = `id, pursuit_id, version, archetype_id, target_mandate, win_theme,
  recommended_positioning, primary_proof_json, objections_json, narratives_to_avoid_json,
  target_audience_json, archetype_scores_json, archetype_match_reasoning,
  route_strategy_json, semantic_json, derivation, model_id, created_at, canonical_job_id,
  opportunity_version, evaluation_context_fingerprint, evaluation_fingerprint, profile_version,
  ledger_binding_fingerprint, anchor_document_id`;

const toThesis = (row: ThesisRow): PursuitThesis => ({
  id: row.id,
  pursuitId: row.pursuit_id,
  version: row.version,
  archetypeId: row.archetype_id,
  targetMandate: row.target_mandate,
  winTheme: row.win_theme,
  recommendedPositioning: row.recommended_positioning,
  primaryProof: json(row.primary_proof_json, []),
  objections: json(row.objections_json, []),
  narrativesToAvoid: json(row.narratives_to_avoid_json, []),
  targetAudience: json(row.target_audience_json, []),
  archetypeScores: json(row.archetype_scores_json, []),
  archetypeMatchReasoning: row.archetype_match_reasoning,
  routeStrategy: json(row.route_strategy_json, []),
  semantic: row.semantic_json ? json(row.semantic_json, null) : null,
  derivation: row.derivation as "MODEL" | "DETERMINISTIC",
  modelId: row.model_id,
  lineage: {
    canonicalJobId: row.canonical_job_id,
    opportunityVersion: row.opportunity_version,
    evaluationContextFingerprint: row.evaluation_context_fingerprint,
    evaluationFingerprint: row.evaluation_fingerprint,
    profileVersion: row.profile_version,
    ledgerBindingFingerprint: row.ledger_binding_fingerprint,
    anchorDocumentId: row.anchor_document_id,
  },
  createdAt: row.created_at,
});

export async function getThesis(thesisId: string): Promise<PursuitThesis | null> {
  const row = await db().one<ThesisRow>(
    `SELECT ${THESIS_COLUMNS} FROM pursuit_theses WHERE id = ?`,
    [thesisId],
  );
  return row ? toThesis(row) : null;
}

export async function listThesisHistory(
  pursuitId: string,
): Promise<Array<{ id: string; version: number; createdAt: string; winTheme: string }>> {
  const rows = await db().many<{
    id: string;
    version: number;
    created_at: string;
    win_theme: string;
  }>(
    `SELECT id, version, created_at, win_theme FROM pursuit_theses
     WHERE pursuit_id = ? ORDER BY version DESC`,
    [pursuitId],
  );
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    winTheme: row.win_theme,
  }));
}

/** A new thesis is always a new version. Earlier strategy stays auditable. */
export async function insertThesis(
  pursuitId: string,
  thesis: Omit<PursuitThesis, "id" | "pursuitId" | "version" | "createdAt">,
  checkpointJob?: PreparationJob,
): Promise<PursuitThesis> {
  return db().transaction(async (tx) => {
    if (checkpointJob) {
      const lease = await tx.one<{ id: string }>(
        "SELECT id FROM pursuit_preparation_jobs WHERE id = ? AND lease_token = ? AND status = 'processing' AND lease_expires_at > ?",
        [checkpointJob.id, checkpointJob.leaseToken, now()],
      );
      if (!lease) throw new Error("LEASE_LOST");
    }
    const next = await tx.one<{ v: number | null }>(
      `SELECT MAX(version) AS v FROM pursuit_theses WHERE pursuit_id = ?`,
      [pursuitId],
    );
    const version = (next?.v ?? 0) + 1;
    const id = `thesis-${randomUUID()}`;
    await tx.execute(
      `INSERT INTO pursuit_theses (
       id, pursuit_id, version, archetype_id, target_mandate, win_theme,
       recommended_positioning, primary_proof_json, objections_json,
       narratives_to_avoid_json, target_audience_json, archetype_scores_json,
       archetype_match_reasoning, route_strategy_json, semantic_json, derivation, model_id, created_at,
       canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_fingerprint,
       profile_version, ledger_binding_fingerprint, anchor_document_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        pursuitId,
        version,
        thesis.archetypeId,
        thesis.targetMandate,
        thesis.winTheme,
        thesis.recommendedPositioning,
        JSON.stringify(thesis.primaryProof),
        JSON.stringify(thesis.objections),
        JSON.stringify(thesis.narrativesToAvoid),
        JSON.stringify(thesis.targetAudience),
        JSON.stringify(thesis.archetypeScores),
        thesis.archetypeMatchReasoning,
        JSON.stringify(thesis.routeStrategy),
        thesis.semantic ? JSON.stringify(thesis.semantic) : null,
        thesis.derivation,
        thesis.modelId,
        now(),
        thesis.lineage?.canonicalJobId ?? null,
        thesis.lineage?.opportunityVersion ?? null,
        thesis.lineage?.evaluationContextFingerprint ?? null,
        thesis.lineage?.evaluationFingerprint ?? null,
        thesis.lineage?.profileVersion ?? null,
        thesis.lineage?.ledgerBindingFingerprint ?? null,
        thesis.lineage?.anchorDocumentId ?? null,
      ],
    );
    const row = await tx.one<ThesisRow>(
      `SELECT ${THESIS_COLUMNS} FROM pursuit_theses WHERE id = ?`,
      [id],
    );
    const created = row ? toThesis(row) : null;
    if (!created) throw new Error("THESIS_INSERT_FAILED");
    if (checkpointJob) {
      await tx.execute(
        `INSERT INTO pursuit_stage_checkpoints (job_id, stage, payload, created_at)
       VALUES (?, 'thesis_row', ?, ?)`,
        [checkpointJob.id, JSON.stringify(created), now()],
      );
    }
    return created;
  });
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

interface ArtifactRow {
  id: string;
  pursuit_id: string;
  thesis_id: string | null;
  artifact_type: string;
  version: number;
  content_json: string;
  rendered_text: string | null;
  status: string;
  provenance_flags_json: string;
  updated_at: string;
}

const ARTIFACT_COLUMNS = `id, pursuit_id, thesis_id, artifact_type, version, content_json,
  rendered_text, status, provenance_flags_json, updated_at`;

const toArtifact = (row: ArtifactRow): PursuitArtifact => ({
  id: row.id,
  pursuitId: row.pursuit_id,
  thesisId: row.thesis_id,
  artifactType: row.artifact_type as ArtifactType,
  version: row.version,
  content: json<ArtifactContent>(row.content_json, {
    kind: "MESSAGE",
    message: { subject: null, body: "", targetWords: null },
  }),
  renderedText: row.rendered_text,
  status: row.status as ArtifactStatus,
  provenanceFlags: json<string[]>(row.provenance_flags_json, []),
  updatedAt: row.updated_at,
});

/** Latest version of every artifact type for this pursuit. */
export async function listLatestArtifacts(pursuitId: string): Promise<PursuitArtifact[]> {
  const rows = await db().many<ArtifactRow>(
    `SELECT ${ARTIFACT_COLUMNS} FROM pursuit_artifacts a
     WHERE a.pursuit_id = ?
       AND a.version = (SELECT MAX(b.version) FROM pursuit_artifacts b
                        WHERE b.pursuit_id = a.pursuit_id AND b.artifact_type = a.artifact_type)
     ORDER BY a.artifact_type ASC`,
    [pursuitId],
  );
  return rows.map(toArtifact);
}

export async function getArtifact(
  pursuitId: string,
  artifactId: string,
): Promise<PursuitArtifact | null> {
  const row = await db().one<ArtifactRow>(
    `SELECT ${ARTIFACT_COLUMNS} FROM pursuit_artifacts WHERE id = ? AND pursuit_id = ?`,
    [artifactId, pursuitId],
  );
  return row ? toArtifact(row) : null;
}

export async function requireApprovedArtifact(
  pursuitId: string,
  artifactId: string,
): Promise<PursuitArtifact> {
  const artifact = await getArtifact(pursuitId, artifactId);
  if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  if (artifact.status !== "APPROVED") throw new Error("ARTIFACT_NOT_APPROVED");
  return artifact;
}

export async function recordApprovedOutreachSent(
  scope: Scope,
  jobHash: string,
  artifactId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const row = await tx.one<{ pursuit_id: string; artifact_type: string }>(
      `SELECT a.pursuit_id, a.artifact_type FROM pursuit_artifacts a
       JOIN opportunity_pursuits p ON p.id = a.pursuit_id
       WHERE p.tenant_id = ? AND p.person_id = ? AND p.job_hash = ?
         AND a.id = ? AND a.status = 'APPROVED' AND a.artifact_type IN
         ('EXEC_NOTE','WARM_INTRO','RECRUITER_BRIEF','APPLICATION_STATEMENT','FOLLOW_UP_1','FOLLOW_UP_2')`,
      [scope.tenantId, scope.personId, jobHash, artifactId],
    );
    if (!row) throw new Error("APPROVED_OUTREACH_REQUIRED");
    const timestamp = now();
    await tx.execute(
      "UPDATE opportunity_pursuits SET status = 'OUTREACH_SENT', updated_at = ? WHERE id = ?",
      [timestamp, row.pursuit_id],
    );
    await tx.execute(
      `INSERT INTO pursuit_activities
       (id,pursuit_id,activity_type,channel,counterparty,summary,occurred_at,created_at)
       VALUES (?,?,'OUTREACH_SENT',NULL,NULL,?,?,?)`,
      [
        `activity-${randomUUID()}`,
        row.pursuit_id,
        `Sent ${row.artifact_type.replace(/_/g, " ").toLowerCase()}.`,
        timestamp,
        timestamp,
      ],
    );
  });
}

export async function insertArtifact(
  pursuitId: string,
  input: {
    thesisId: string | null;
    artifactType: ArtifactType;
    content: ArtifactContent;
    renderedText?: string | null;
    status?: ArtifactStatus;
    provenanceFlags?: string[];
  },
): Promise<PursuitArtifact> {
  const next = await db().one<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM pursuit_artifacts WHERE pursuit_id = ? AND artifact_type = ?`,
    [pursuitId, input.artifactType],
  );
  const version = (next?.v ?? 0) + 1;
  const id = `artifact-${randomUUID()}`;
  const timestamp = now();
  await db().execute(
    `INSERT INTO pursuit_artifacts (
       id, pursuit_id, thesis_id, artifact_type, version, content_json, rendered_text,
       status, provenance_flags_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      pursuitId,
      input.thesisId,
      input.artifactType,
      version,
      JSON.stringify(input.content),
      input.renderedText ?? null,
      input.status ?? "DRAFT",
      JSON.stringify(input.provenanceFlags ?? []),
      timestamp,
      timestamp,
    ],
  );
  const created = await getArtifact(pursuitId, id);
  if (!created) throw new Error("ARTIFACT_INSERT_FAILED");
  return created;
}

/**
 * Candidate edits update the current version in place and mark it customized;
 * model regeneration always creates a new version instead, so an edited draft
 * is never silently replaced.
 */
export async function updateArtifactContent(
  pursuitId: string,
  artifactId: string,
  content: ArtifactContent,
  options: {
    status?: ArtifactStatus;
    renderedText?: string | null;
    provenanceFlags?: string[];
  } = {},
): Promise<PursuitArtifact> {
  await db().execute(
    `UPDATE pursuit_artifacts SET content_json = ?, rendered_text = ?, status = ?,
       provenance_flags_json = ?, updated_at = ?
     WHERE id = ? AND pursuit_id = ?`,
    [
      JSON.stringify(content),
      options.renderedText ?? null,
      options.status ?? "USER_CUSTOMIZED",
      JSON.stringify(options.provenanceFlags ?? []),
      now(),
      artifactId,
      pursuitId,
    ],
  );
  const updated = await getArtifact(pursuitId, artifactId);
  if (!updated) throw new Error("ARTIFACT_NOT_FOUND");
  return updated;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export async function listActivities(pursuitId: string): Promise<PursuitActivity[]> {
  const rows = await db().many<{
    id: string;
    activity_type: string;
    channel: string | null;
    counterparty: string | null;
    summary: string;
    occurred_at: string;
  }>(
    `SELECT id, activity_type, channel, counterparty, summary, occurred_at
     FROM pursuit_activities WHERE pursuit_id = ? ORDER BY occurred_at DESC LIMIT 50`,
    [pursuitId],
  );
  return rows.map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    channel: row.channel,
    counterparty: row.counterparty,
    summary: row.summary,
    occurredAt: row.occurred_at,
  }));
}

export async function recordActivity(
  pursuitId: string,
  input: {
    activityType: string;
    summary: string;
    channel?: string | null;
    counterparty?: string | null;
    occurredAt?: string;
  },
): Promise<void> {
  const timestamp = now();
  await db().execute(
    `INSERT INTO pursuit_activities (
       id, pursuit_id, activity_type, channel, counterparty, summary, occurred_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      `activity-${randomUUID()}`,
      pursuitId,
      input.activityType,
      input.channel ?? null,
      input.counterparty ?? null,
      input.summary,
      input.occurredAt ?? timestamp,
      timestamp,
    ],
  );
}

// ---------------------------------------------------------------------------
// Learning signals
// ---------------------------------------------------------------------------

export async function recordLearningSignals(
  scope: Scope,
  context: { pursuitId?: string | null; archetypeId?: string | null },
  signals: readonly LearningSignal[],
): Promise<void> {
  if (signals.length === 0) return;
  const timestamp = now();
  for (const signal of signals) {
    await db().execute(
      `INSERT INTO candidate_learning_signals (
         id, tenant_id, person_id, pursuit_id, archetype_id, signal_type, subject,
         original_value, new_value, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        `signal-${randomUUID()}`,
        scope.tenantId,
        scope.personId,
        context.pursuitId ?? null,
        context.archetypeId ?? null,
        signal.signalType,
        signal.subject ?? null,
        signal.originalValue ?? null,
        signal.newValue ?? null,
        timestamp,
      ],
    );
  }
}

/**
 * Bounded style profile. Capped deliberately: preference learning should nudge
 * tone and selection, never accumulate into an unbounded prompt that starts
 * dictating content.
 */
export async function loadStyleProfile(scope: Scope): Promise<StyleProfile> {
  const rows = await db().many<{
    signal_type: string;
    subject: string | null;
    original_value: string | null;
    new_value: string | null;
  }>(
    `SELECT signal_type, subject, original_value, new_value
     FROM candidate_learning_signals
     WHERE tenant_id = ? AND person_id = ?
     ORDER BY created_at DESC LIMIT 200`,
    [scope.tenantId, scope.personId],
  );

  const profile: StyleProfile = {
    preferredPhrasings: [],
    promotedClaimIds: [],
    rejectedClaimIds: [],
    archetypeOverrides: [],
    observedEditCount: rows.length,
  };
  for (const row of rows) {
    switch (row.signal_type) {
      case "PHRASE_REWRITTEN":
      case "SUMMARY_REWRITTEN":
      case "MESSAGE_REWRITTEN":
        if (row.original_value && row.new_value && profile.preferredPhrasings.length < 12) {
          profile.preferredPhrasings.push({ from: row.original_value, to: row.new_value });
        }
        break;
      case "BULLET_PROMOTED":
        if (row.subject && profile.promotedClaimIds.length < 20) {
          profile.promotedClaimIds.push(row.subject);
        }
        break;
      case "BULLET_REJECTED":
      case "BULLET_DEMOTED":
        if (row.subject && profile.rejectedClaimIds.length < 20) {
          profile.rejectedClaimIds.push(row.subject);
        }
        break;
      case "ARCHETYPE_OVERRIDDEN":
        if (row.original_value && row.new_value && profile.archetypeOverrides.length < 10) {
          profile.archetypeOverrides.push({ from: row.original_value, to: row.new_value });
        }
        break;
      default:
        break;
    }
  }
  return profile;
}

/**
 * One-time / incremental backfill of intrinsic claim classification. Uses the
 * deterministic classifier; claims already stamped with the current version are
 * left alone. Pursuit relevance is never cached here — it is mandate-relative.
 */
export async function backfillClaimClassifications(
  scope: Scope,
  classify: (claim: CandidateClaim) => {
    semanticType: string;
    renderState: string;
    version: string;
  },
): Promise<number> {
  const rows = await db().many<ClaimRow & { classification_version: string | null }>(
    `SELECT ${CLAIM_COLUMNS}, classification_version FROM candidate_claims
     WHERE tenant_id = ? AND person_id = ?`,
    [scope.tenantId, scope.personId],
  );
  let updated = 0;
  for (const row of rows) {
    const claim = toClaim(row);
    const c = classify(claim);
    if (row.classification_version === c.version) continue;
    await db().execute(
      `UPDATE candidate_claims SET semantic_claim_type = ?, render_state = ?,
         classification_version = ?, classified_at = ? WHERE id = ?`,
      [c.semanticType, c.renderState, c.version, now(), claim.id],
    );
    updated++;
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Durable preparation queue (lease + fencing token, same pattern as RADAR workers)
// ---------------------------------------------------------------------------

export interface PreparationJob {
  id: string;
  tenantId: string;
  personId: string;
  pursuitId: string;
  jobHash: string;
  requestedBy: string;
  preferredArchetypeId: string | null;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
}

/** Idempotent: an existing live job for the pursuit absorbs the request. */
export async function enqueuePreparation(
  scope: Scope,
  input: {
    pursuitId: string;
    jobHash: string;
    requestedBy: string;
    preferredArchetypeId: string | null;
  },
): Promise<{ jobId: string; coalesced: boolean }> {
  const live = await db().one<{ id: string; status: string }>(
    `SELECT id, status FROM pursuit_preparation_jobs
     WHERE pursuit_id = ? AND tenant_id = ? AND person_id = ? AND status IN ('queued','processing')`,
    [input.pursuitId, scope.tenantId, scope.personId],
  );
  if (live) {
    if (live.status === "queued")
      await db().execute(
        `UPDATE pursuit_preparation_jobs SET preferred_archetype_id = ?, updated_at = ? WHERE id = ?`,
        [input.preferredArchetypeId, now(), live.id],
      );
    return { jobId: live.id, coalesced: true };
  }
  const id = `pprep-${randomUUID()}`;
  const ts = now();
  const inserted = await db().execute(
    `INSERT INTO pursuit_preparation_jobs
       (id, tenant_id, person_id, pursuit_id, job_hash, requested_by, preferred_archetype_id,
        status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'queued',?,?)
     ON CONFLICT DO NOTHING`,
    [
      id,
      scope.tenantId,
      scope.personId,
      input.pursuitId,
      input.jobHash,
      input.requestedBy,
      input.preferredArchetypeId,
      ts,
      ts,
    ],
  );
  if (inserted.rowsAffected === 0) {
    // A concurrent enqueue won the race: return the actual persisted live job
    // rather than a phantom ID that was never inserted.
    const existing = await db().one<{ id: string }>(
      `SELECT id FROM pursuit_preparation_jobs
       WHERE pursuit_id = ? AND tenant_id = ? AND person_id = ? AND status IN ('queued','processing')
       ORDER BY created_at DESC LIMIT 1`,
      [input.pursuitId, scope.tenantId, scope.personId],
    );
    if (existing) return { jobId: existing.id, coalesced: true };
  }
  return { jobId: id, coalesced: false };
}

/** Renews the lease as long as this worker still owns the token. */
export async function heartbeatPreparation(job: PreparationJob, leaseMs: number): Promise<boolean> {
  const expires = new Date(Date.now() + leaseMs).toISOString();
  const result = await db().execute(
    `UPDATE pursuit_preparation_jobs SET lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND lease_token = ? AND status = 'processing'`,
    [expires, now(), job.id, job.leaseToken],
  );
  return result.rowsAffected > 0;
}

/** Reads a persisted stage checkpoint payload for this job/stage. */
export async function readCheckpoint(job: PreparationJob, stage: string): Promise<unknown | null> {
  const row = await db().one<{ payload: string }>(
    `SELECT payload FROM pursuit_stage_checkpoints WHERE job_id = ? AND stage = ?`,
    [job.id, stage],
  );
  return row ? JSON.parse(row.payload) : null;
}

/** Persists a stage checkpoint. Token-fenced by the caller before use. */
export async function writeCheckpoint(
  job: PreparationJob,
  stage: string,
  payload: unknown,
): Promise<void> {
  await db().transaction(async (tx) => {
    const held = await tx.one<{ id: string }>(
      `SELECT id FROM pursuit_preparation_jobs WHERE id = ? AND lease_token = ?
       AND status = 'processing' AND lease_expires_at > ?`,
      [job.id, job.leaseToken, now()],
    );
    if (!held) throw new Error("LEASE_LOST");
    await tx.execute(
      `INSERT INTO pursuit_stage_checkpoints (job_id, stage, payload, created_at)
       VALUES (?,?,?,?)
       ON CONFLICT (job_id, stage) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      [job.id, stage, JSON.stringify(payload), now()],
    );
  });
}

/** Publish a complete package only while this worker still owns the lease. */
export async function publishPreparation(
  job: PreparationJob,
  thesis: PursuitThesis,
  artifacts: Array<{ artifactType: ArtifactType; content: ArtifactContent; renderedText: string }>,
  summary: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const held = await tx.one<{ id: string }>(
      `SELECT id FROM pursuit_preparation_jobs WHERE id = ? AND lease_token = ?
       AND status = 'processing' AND lease_expires_at > ?`,
      [job.id, job.leaseToken, now()],
    );
    if (!held) throw new Error("LEASE_LOST");
    for (const artifact of artifacts) {
      const saved = await tx.one<{ id: string }>(
        "SELECT id FROM pursuit_artifacts WHERE pursuit_id = ? AND thesis_id = ? AND artifact_type = ?",
        [job.pursuitId, thesis.id, artifact.artifactType],
      );
      if (saved) continue;
      const max = await tx.one<{ v: number | null }>(
        "SELECT MAX(version) AS v FROM pursuit_artifacts WHERE pursuit_id = ? AND artifact_type = ?",
        [job.pursuitId, artifact.artifactType],
      );
      const timestamp = now();
      await tx.execute(
        `INSERT INTO pursuit_artifacts
         (id,pursuit_id,thesis_id,artifact_type,version,content_json,rendered_text,status,provenance_flags_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'DRAFT','[]',?,?)`,
        [
          `artifact-${randomUUID()}`,
          job.pursuitId,
          thesis.id,
          artifact.artifactType,
          (max?.v ?? 0) + 1,
          JSON.stringify(artifact.content),
          artifact.renderedText,
          timestamp,
          timestamp,
        ],
      );
    }
    const updated = await tx.execute(
      `UPDATE opportunity_pursuits SET active_thesis_id = ?, active_archetype_id = ?, preparation_state = 'READY',
       preparation_error = NULL, canonical_job_id = ?, opportunity_version = ?, evaluation_context_fingerprint = ?,
       evaluation_fingerprint = ?, profile_version = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      [
        thesis.id,
        thesis.archetypeId,
        thesis.lineage?.canonicalJobId ?? null,
        thesis.lineage?.opportunityVersion ?? null,
        thesis.lineage?.evaluationContextFingerprint ?? null,
        thesis.lineage?.evaluationFingerprint ?? null,
        thesis.lineage?.profileVersion ?? null,
        now(),
        job.pursuitId,
        job.tenantId,
        job.personId,
      ],
    );
    if (updated.rowsAffected !== 1) throw new Error("PURSUIT_SCOPE_MISMATCH");
    await tx.execute(
      `UPDATE pursuit_preparation_jobs SET status = 'completed', completed_at = ?, locked_by = NULL,
       lease_expires_at = NULL, updated_at = ? WHERE id = ? AND lease_token = ? AND status = 'processing'`,
      [now(), now(), job.id, job.leaseToken],
    );
    await tx.execute(
      `INSERT INTO pursuit_activities
       (id,pursuit_id,activity_type,channel,counterparty,summary,occurred_at,created_at)
       VALUES (?,?,'STRATEGY_DERIVED',NULL,NULL,?,?,?)`,
      [`activity-${randomUUID()}`, job.pursuitId, summary, now(), now()],
    );
  });
}

/** Claims one queued (or lease-expired) job. The lease token fences completion. */
export async function claimPreparation(
  workerId: string,
  leaseMs: number,
): Promise<PreparationJob | null> {
  const ts = now();
  const candidate = await db().one<{ id: string }>(
    `SELECT id FROM pursuit_preparation_jobs
     WHERE (status = 'queued' OR (status = 'processing' AND lease_expires_at < ?))
       AND attempts < max_attempts
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT 1`,
    [ts, ts],
  );
  if (!candidate) return null;
  const token = randomUUID();
  const expires = new Date(Date.now() + leaseMs).toISOString();
  const result = await db().execute(
    `UPDATE pursuit_preparation_jobs
     SET status = 'processing', locked_by = ?, lease_token = ?, lease_expires_at = ?,
         attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND (status = 'queued' OR (status = 'processing' AND lease_expires_at < ?))`,
    [workerId, token, expires, ts, candidate.id, ts],
  );
  if (result.rowsAffected === 0) return null;
  const row = await db().one<{
    id: string;
    tenant_id: string;
    person_id: string;
    pursuit_id: string;
    job_hash: string;
    requested_by: string;
    preferred_archetype_id: string | null;
    attempts: number;
    max_attempts: number;
    lease_token: string;
  }>(`SELECT * FROM pursuit_preparation_jobs WHERE id = ? AND lease_token = ?`, [
    candidate.id,
    token,
  ]);
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personId: row.person_id,
    pursuitId: row.pursuit_id,
    jobHash: row.job_hash,
    requestedBy: row.requested_by,
    preferredArchetypeId: row.preferred_archetype_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
  };
}

export async function finishPreparation(
  job: PreparationJob,
  outcome: { ok: true } | { ok: false; error: string; retry: boolean },
): Promise<boolean> {
  const ts = now();
  const status = outcome.ok ? "completed" : outcome.retry ? "queued" : "failed";
  // Exponential operational backoff so a retry never immediately re-burns
  // provider calls: 30s, 2m, 8m capped at 30m.
  const backoffMs = Math.min(30_000 * Math.pow(4, Math.max(0, job.attempts - 1)), 1_800_000);
  const nextAttemptAt =
    !outcome.ok && outcome.retry ? new Date(Date.now() + backoffMs).toISOString() : null;
  const result = await db().execute(
    `UPDATE pursuit_preparation_jobs
     SET status = ?, last_error = ?, completed_at = ?, locked_by = NULL, lease_expires_at = NULL,
         next_attempt_at = ?, updated_at = ?
     WHERE id = ? AND lease_token = ? AND status = 'processing'`,
    [
      status,
      outcome.ok ? null : outcome.error,
      outcome.ok || !outcome.retry ? ts : null,
      nextAttemptAt,
      ts,
      job.id,
      job.leaseToken,
    ],
  );
  return result.rowsAffected > 0;
}

export async function livePreparation(
  scope: Scope,
  pursuitId: string,
): Promise<{
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
} | null> {
  const row = await db().one<{
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
  }>(
    `SELECT status, attempts, last_error, created_at FROM pursuit_preparation_jobs
     WHERE pursuit_id = ? AND tenant_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1`,
    [pursuitId, scope.tenantId, scope.personId],
  );
  return row
    ? {
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: row.created_at,
      }
    : null;
}

/**
 * Single narrow row for cockpit polling: pursuit preparation state plus the
 * latest job's status. Deliberately does NOT read theses, artifacts, claims,
 * archetypes or activities — polling must not scale with package size.
 */
export async function preparationStatus(
  scope: Scope,
  jobHash: string,
): Promise<{
  preparationState: PreparationState;
  preparationError: string | null;
  activeThesisId: string | null;
  updatedAt: string;
  jobStatus: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
} | null> {
  const row = await db().one<{
    preparation_state: string;
    preparation_error: string | null;
    active_thesis_id: string | null;
    updated_at: string;
    job_status: string | null;
    attempts: number | null;
    next_attempt_at: string | null;
    last_error: string | null;
  }>(
    `SELECT p.preparation_state, p.preparation_error, p.active_thesis_id, p.updated_at,
            j.status AS job_status, j.attempts, j.next_attempt_at, j.last_error
     FROM opportunity_pursuits p
     LEFT JOIN pursuit_preparation_jobs j
       ON j.pursuit_id = p.id
      AND j.created_at = (SELECT MAX(created_at) FROM pursuit_preparation_jobs WHERE pursuit_id = p.id)
     WHERE p.tenant_id = ? AND p.person_id = ? AND p.job_hash = ?`,
    [scope.tenantId, scope.personId, jobHash],
  );
  if (!row) return null;
  return {
    preparationState: row.preparation_state as PreparationState,
    preparationError: row.preparation_error,
    activeThesisId: row.active_thesis_id,
    updatedAt: row.updated_at,
    jobStatus: row.job_status,
    attempts: row.attempts ?? 0,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}
