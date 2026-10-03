import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import type { OpportunityVersion } from "../lib/domain/canonical_acquisition";
import type { SearchCriteriaPayload } from "../evaluation/context-contracts";
import type { StagedResearchInput } from "../dossier/staged-role";
import { computeDeterministicHash } from "../lib/ontology/compiler/OntologyCompiler";
import {
  validateSnapshot,
  contextInputFingerprint,
} from "../data/sqlite/repositories/SqliteStagedInputStore";
import { benchFixtures, BENCH_FIXTURE_VERSION } from "./bench-fixtures";
import { benchEnvironment, assertBenchEnvironment } from "./bench-environment";
import { activeRevision } from "./config-store";
import type { SearchTaxonomy } from "./taxonomy-contracts";
import {
  assertCanonicalJdContentHash,
  normalizeCanonicalJobText,
} from "../evaluation/staged-input";
export const INTELLIGENCE_SHADOW_VERSION = "intelligence-shadow/v1";
export type ShadowCase = {
  id: string;
  version: OpportunityVersion;
  criteria: SearchCriteriaPayload;
  frozen: StagedResearchInput;
};
export type IntelligenceRevision = { id: string; definition: SearchTaxonomy };
export async function intelligenceShadowCases(
  db: DatabaseAdapter,
  tenantId?: string,
  limit = 3,
): Promise<ShadowCase[]> {
  if (!tenantId)
    return benchFixtures().map((frozen) => {
      const jd = frozen.sources.find((s) => s.plane === "JD")!;
      const canonical = { ...frozen, fingerprint: contextInputFingerprint(frozen) };
      validateSnapshot(canonical);
      return {
        id: frozen.opportunity.id,
        frozen: canonical,
        criteria: {
          targetRoles: ["Head of Growth"],
          targetSeniority: ["Head"],
          targetLocations: ["India"],
          customParameters: { functions: ["Growth"] },
        },
        version: {
          id: frozen.opportunity.id,
          canonicalJobId: frozen.opportunity.id,
          contentHash: "fixture",
          jobTitle: frozen.opportunity.title,
          companyName: frozen.opportunity.company,
          location: "India",
          rawContent: jd.text,
          employmentType: null,
          acquisitionStatus: "ACQUIRED",
          acquisitionQuality: "COMPLETE",
          lifecycleState: "ACTIVE",
          evidenceState: "SUFFICIENT",
          createdAt: "2026-10-01",
        },
      };
    });
  const rows = await db.many<{
    tenant_id: string;
    person_id: string;
    canonical_job_id: string;
    opportunity_version: string;
    context_fingerprint: string;
    payload_json: string;
    input_json: string | null;
    job_title: string;
    company_name: string;
    location: string;
    raw_content: string;
    content_hash: string;
    acquisition_status: string;
    employment_type: string | null;
  }>(
    `SELECT a.tenant_id,a.person_id,c.canonical_job_id,c.opportunity_version,a.context_fingerprint,s.payload_json,f.input_json,v.job_title,v.company_name,v.location,v.raw_content,v.content_hash,v.acquisition_status,v.employment_type
 FROM active_evaluation_contexts a JOIN evaluation_contexts e ON e.context_fingerprint=a.context_fingerprint AND e.tenant_id=a.tenant_id AND e.person_id=a.person_id
 JOIN search_plan_snapshots s ON s.id=e.search_plan_snapshot_id AND s.tenant_id=a.tenant_id AND s.person_id=a.person_id
 JOIN search_plan_candidates c ON c.search_plan_id=a.search_plan_id AND c.tenant_id=a.tenant_id AND c.person_id=a.person_id
 JOIN opportunity_versions v ON v.id=c.opportunity_version AND v.canonical_job_id=c.canonical_job_id
 LEFT JOIN staged_frozen_inputs f ON f.tenant_id=a.tenant_id AND f.person_id=a.person_id AND f.canonical_job_id=c.canonical_job_id AND f.opportunity_version=c.opportunity_version AND f.evaluation_context_fingerprint=a.context_fingerprint
 WHERE a.tenant_id=? ORDER BY c.canonical_job_id,c.opportunity_version,f.model_configuration_fingerprint LIMIT ?`,
    [tenantId, limit + 1],
  );
  if (!rows.length) throw new Error("INTELLIGENCE_SHADOW_REAL_SCOPE_EMPTY");
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const key = [
        r.person_id,
        r.canonical_job_id,
        r.opportunity_version,
        r.context_fingerprint,
      ].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((r) => {
      if (!r.input_json) throw new Error("INTELLIGENCE_SHADOW_FROZEN_INPUT_REQUIRED");
      const frozen = validateSnapshot(JSON.parse(r.input_json));
      assertCanonicalJdContentHash(r);
      const jd = frozen.sources.filter((s) => s.plane === "JD");
      if (
        frozen.opportunity.id !== r.canonical_job_id ||
        jd.length !== 1 ||
        jd[0].locator !== `opportunity-version:${r.canonical_job_id}:${r.opportunity_version}` ||
        jd[0].text !== normalizeCanonicalJobText(r.raw_content)
      )
        throw new Error("INTELLIGENCE_SHADOW_SOURCE_IDENTITY_MISMATCH");
      return {
        id: [r.person_id, r.canonical_job_id, r.opportunity_version, r.context_fingerprint].join(
          ":",
        ),
        frozen,
        criteria: JSON.parse(r.payload_json),
        version: {
          id: r.opportunity_version,
          canonicalJobId: r.canonical_job_id,
          contentHash: r.content_hash,
          jobTitle: r.job_title,
          companyName: r.company_name,
          location: r.location,
          rawContent: r.raw_content,
          employmentType: r.employment_type,
          acquisitionStatus: r.acquisition_status,
          acquisitionQuality: "COMPLETE",
          lifecycleState: "ACTIVE",
          evidenceState: "SUFFICIENT",
          createdAt: "2026-10-01",
        } as OpportunityVersion,
      };
    });
}
export const intelligenceCohortHash = (cases: ShadowCase[]) =>
  computeDeterministicHash({
    version: INTELLIGENCE_SHADOW_VERSION,
    fixtureVersion: BENCH_FIXTURE_VERSION,
    cases,
  });
export async function queueIntelligenceShadow(
  db: DatabaseAdapter,
  actor: string,
  active: IntelligenceRevision,
  draft: IntelligenceRevision,
  request: { tokenCap: number; tenantId?: string; limit: number },
) {
  if (!(await db.one("SELECT name FROM sqlite_master WHERE name='intelligence_taxonomy_shadows'")))
    throw new Error("INTELLIGENCE_SHADOW_MIGRATION_REQUIRED");
  const scopeKind = request.tenantId ? "tenant_sample" : "golden",
    cases = await intelligenceShadowCases(db, request.tenantId, request.limit),
    config = await activeRevision(db, request.tenantId),
    id = randomUUID();
  if (
    await db.one(
      "SELECT id FROM intelligence_taxonomy_shadows WHERE revision_id=? AND active_revision_id=? AND scope_kind=? AND status IN ('queued','running')",
      [draft.id, active.id, scopeKind],
    )
  )
    throw new Error("INTELLIGENCE_SHADOW_ALREADY_QUEUED_OR_RUNNING");
  try {
    await db.execute(
      `INSERT INTO intelligence_taxonomy_shadows(id,revision_id,active_revision_id,config_revision_id,cohort_hash,scope_kind,scope_json,environment_json,created_by,created_at,status,token_cap) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?)`,
      [
        id,
        draft.id,
        active.id,
        config.id,
        intelligenceCohortHash(cases),
        scopeKind,
        JSON.stringify({ kind: scopeKind, tenantId: request.tenantId, limit: request.limit }),
        JSON.stringify(benchEnvironment()),
        actor,
        Date.now(),
        request.tokenCap,
      ],
    );
  } catch (error) {
    if (String(error).includes("intelligence_shadow_live_scope"))
      throw new Error("INTELLIGENCE_SHADOW_ALREADY_QUEUED_OR_RUNNING");
    throw error;
  }
  return id;
}
export async function assertIntelligenceShadow(
  db: DatabaseAdapter,
  active: IntelligenceRevision,
  draft: IntelligenceRevision,
) {
  const row = await db.one<{
    cohort_hash: string;
    scope_json: string;
    environment_json: string;
    worker_environment_json: string;
    config_revision_id: string;
    result_json: string;
  }>(
    "SELECT * FROM intelligence_taxonomy_shadows WHERE revision_id=? AND active_revision_id=? AND scope_kind='golden' ORDER BY created_at DESC LIMIT 1",
    [draft.id, active.id],
  );
  if (!row || !row.result_json) throw new Error("INTELLIGENCE_GOLDEN_SHADOW_REQUIRED");
  assertBenchEnvironment(row.environment_json, row.worker_environment_json);
  const scope = JSON.parse(row.scope_json),
    result = JSON.parse(row.result_json);
  if (
    scope.kind !== "golden" ||
    result.version !== INTELLIGENCE_SHADOW_VERSION ||
    !result.safeToPublish ||
    (await activeRevision(db)).id !== row.config_revision_id ||
    intelligenceCohortHash(await intelligenceShadowCases(db, undefined, scope.limit)) !==
      row.cohort_hash
  )
    throw new Error("INTELLIGENCE_GOLDEN_SHADOW_REQUIRED");
}
