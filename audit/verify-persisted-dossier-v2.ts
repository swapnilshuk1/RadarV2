/**
 * Read-only verifier for the persisted dossier-v2 table.  It deliberately
 * validates stored JSON only: it neither composes, evaluates, nor reads a JD.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getDatabaseAdapter } from "../src/data/database";
import { isCanonicalDossierPresentationV2, type CanonicalDossierPresentationV2 } from "../src/lib/domain/dossier_presentation";

type Row = {
  tenant_id: string;
  person_id: string;
  canonical_job_id: string;
  opportunity_version: string;
  evaluation_context_fingerprint: string;
  source_evaluation_fingerprint: string | null;
  current_evaluation_state: string | null;
  current_evaluation_fingerprint: string | null;
  current_decision: string | null;
  current_quality_score: number | null;
  presentation_json: string;
};

function parse(value: string): CanonicalDossierPresentationV2 | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isCanonicalDossierPresentationV2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  const db = getDatabaseAdapter();
  const rows = await db.many<Row>(`SELECT dp.tenant_id, dp.person_id, dp.canonical_job_id, dp.opportunity_version,
    dp.evaluation_context_fingerprint, dp.source_evaluation_fingerprint, dp.presentation_json,
    me.evaluation_state AS current_evaluation_state, me.evaluation_fingerprint AS current_evaluation_fingerprint,
    me.decision AS current_decision, me.quality_score AS current_quality_score
    FROM materialized_dossier_presentations dp
    LEFT JOIN materialized_evaluations me ON me.tenant_id = dp.tenant_id AND me.person_id = dp.person_id
      AND me.canonical_job_id = dp.canonical_job_id AND me.opportunity_version = dp.opportunity_version
      AND me.evaluation_context_fingerprint = dp.evaluation_context_fingerprint
    WHERE dp.presentation_version = 'dossier-v2'`);
  const presentations = rows.map((row) => parse(row.presentation_json));
  const valid = presentations.filter((item): item is CanonicalDossierPresentationV2 => item !== null);
  const invalid = presentations.length - valid.length;
  const evaluated = valid.filter((item) => item.evaluation.state === "EVALUATED");
  const sourceOnly = valid.length - evaluated.length;
  const propositions = valid.flatMap((item) => item.composition.propositions);
  const count = (predicate: (presentation: CanonicalDossierPresentationV2) => boolean) => valid.filter(predicate).length;
  const badEvaluation = count((item) => item.evaluation.state === "EVALUATED"
    && (!Number.isFinite(item.evaluation.score) || item.evaluation.score! < 0 || item.evaluation.score! > 100 || !item.evaluation.verdict || !item.evaluation.fingerprint));
  const noLineage = propositions.filter((item) => item.kind === "EMPLOYER_FACT" && item.roleEvidenceIds.length === 0).length;
  const candidateAsEmployer = propositions.filter((item) => item.kind === "EMPLOYER_FACT" && item.candidateEvidenceIds.length > 0).length;
  const untraceableInference = propositions.filter((item) => item.kind === "RADAR_INFERENCE"
    && item.roleEvidenceIds.length + item.candidateEvidenceIds.length + item.canonicalSignalIds.length === 0).length;
  const identityMismatches = rows.filter((row, index) => {
    const presentation = presentations[index];
    return presentation !== null && (presentation.identity.tenantId !== row.tenant_id
      || presentation.identity.personId !== row.person_id
      || presentation.identity.canonicalJobId !== row.canonical_job_id
      || presentation.identity.opportunityVersion !== row.opportunity_version
      || presentation.identity.evaluationContextFingerprint !== row.evaluation_context_fingerprint);
  }).length;
  const fingerprintMismatches = rows.filter((row, index) => presentations[index] !== null
    && presentations[index]!.evaluation.fingerprint !== row.source_evaluation_fingerprint).length;
  const staleStateMismatches = rows.filter((row, index) => {
    const presentation = presentations[index];
    if (!presentation) return false;
    return presentation.evaluation.state === "EVALUATED"
      ? row.current_evaluation_state !== "EVALUATED" || row.current_evaluation_fingerprint !== presentation.evaluation.fingerprint
      : row.current_evaluation_state !== presentation.evaluation.state || row.current_evaluation_fingerprint !== null;
  }).length;
  const currentScalarMismatches = rows.filter((row, index) => {
    const presentation = presentations[index];
    return presentation?.evaluation.state === "EVALUATED"
      && (presentation.evaluation.verdict !== row.current_decision || presentation.evaluation.score !== row.current_quality_score);
  }).length;
  const lines = [
    "# Persisted Dossier V2 Readback", "",
    `Generated: ${new Date().toISOString()}`, "",
    `- Total persisted rows: ${rows.length}`,
    `- Valid V2 presentations: ${valid.length}`,
    `- Schema/provenance-invalid presentations: ${invalid}`,
    `- Evaluated: ${evaluated.length}`,
    `- Source-only: ${sourceOnly}`,
    `- Invalid evaluated scalar/fingerprint linkage: ${badEvaluation}`,
    `- Employer facts without role provenance: ${noLineage}`,
    `- Candidate evidence represented as employer fact: ${candidateAsEmployer}`,
    `- Untraceable RADAR inferences: ${untraceableInference}`,
    `- Identity mismatches among structurally valid rows: ${identityMismatches}`,
    `- Evaluation-fingerprint mismatches among structurally valid rows: ${fingerprintMismatches}`,
    `- Current evaluation stale-state mismatches among structurally valid rows: ${staleStateMismatches}`,
    `- Current evaluation scalar mismatches among structurally valid rows: ${currentScalarMismatches}`,
    "", "## Representative persisted propositions", "",
    ...valid.slice(0, 8).flatMap((item) => [
      `### ${item.identity.canonicalJobId}`,
      ...item.composition.propositions.slice(0, 4).map((prop) => `- ${prop.kind}: ${prop.text}`),
      "",
    ]),
  ];
  const reportDir = join(process.cwd(), "audit-reports");
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `phase4-dossier-v2-readback-${Date.now()}.md`);
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  const invalidRows = rows.filter((_, index) => presentations[index] === null).map((row) => {
    let generatedAt: string | null = null;
    try {
      const parsed: unknown = JSON.parse(row.presentation_json);
      if (parsed && typeof parsed === "object" && "generatedAt" in parsed && typeof parsed.generatedAt === "string") generatedAt = parsed.generatedAt;
    } catch {
      // The snapshot must retain malformed source JSON verbatim for rollback.
    }
    return {
      tenantId: row.tenant_id,
      personId: row.person_id,
      canonicalJobId: row.canonical_job_id,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: row.evaluation_context_fingerprint,
      sourceEvaluationFingerprint: row.source_evaluation_fingerprint,
      generatedAt,
      presentationJsonSha256: createHash("sha256").update(row.presentation_json).digest("hex"),
      presentationJson: row.presentation_json,
    };
  });
  if (invalidRows.length > 0) {
    const snapshotPath = join(reportDir, `phase4-dossier-v2-invalid-rollback-${Date.now()}.json`);
    await writeFile(snapshotPath, `${JSON.stringify(invalidRows, null, 2)}\n`, "utf8");
    console.log(`Persisted dossier-v2 rollback snapshot: ${snapshotPath}`);
  }
  console.log(`Persisted dossier-v2 readback: ${reportPath}`);
  const summary = { total: rows.length, valid: valid.length, invalid, evaluated: evaluated.length, sourceOnly, badEvaluation, noLineage, candidateAsEmployer, untraceableInference, identityMismatches, fingerprintMismatches, staleStateMismatches, currentScalarMismatches };
  console.log(JSON.stringify(summary));
  if (invalid || badEvaluation || noLineage || candidateAsEmployer || untraceableInference || identityMismatches || fingerprintMismatches || staleStateMismatches || currentScalarMismatches) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
