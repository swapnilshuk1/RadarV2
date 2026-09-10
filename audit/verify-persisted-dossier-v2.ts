/**
 * Read-only verifier for the persisted dossier-v2 table.  It deliberately
 * validates stored JSON only: it neither composes, evaluates, nor reads a JD.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDatabaseAdapter } from "../src/data/database";
import { isCanonicalDossierPresentationV2, type CanonicalDossierPresentationV2 } from "../src/lib/domain/dossier_presentation";

type Row = { presentation_json: string };

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
  const rows = await db.many<Row>("SELECT presentation_json FROM materialized_dossier_presentations WHERE presentation_version = 'dossier-v2'");
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
  const lines = [
    "# Persisted Dossier V2 Readback", "",
    `Generated: ${new Date().toISOString()}`, "",
    `- Total persisted rows: ${rows.length}`,
    `- Valid V2 presentations: ${valid.length}`,
    `- Invalid presentations: ${invalid}`,
    `- Evaluated: ${evaluated.length}`,
    `- Source-only: ${sourceOnly}`,
    `- Invalid evaluated scalar/fingerprint linkage: ${badEvaluation}`,
    `- Employer facts without role provenance: ${noLineage}`,
    `- Candidate evidence represented as employer fact: ${candidateAsEmployer}`,
    `- Untraceable RADAR inferences: ${untraceableInference}`,
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
  console.log(`Persisted dossier-v2 readback: ${reportPath}`);
  console.log(JSON.stringify({ total: rows.length, valid: valid.length, invalid, evaluated: evaluated.length, sourceOnly, badEvaluation, noLineage, candidateAsEmployer, untraceableInference }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
