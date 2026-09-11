/*
 * Read-only Phase 3 composition review. This script performs the already
 * approved Phase 1 presentation augmentation before handing a frozen v2
 * contract to the composer. The composer itself receives no raw source.
 */
import fs from "node:fs";
import path from "node:path";
import { getDatabaseAdapter } from "../src/data/database";
import { resolveExactCandidateProjectionForScope } from "../src/data/sqlite/repositories/profile-projection-version";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import type { EditorialIntelligenceContract } from "../src/lib/intelligence/editorial/EditorialIntelligenceContract";
import { buildEditorialIntelligenceContract } from "../src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder";
import { composeEditorialIntelligenceV2, type EditorialCompositionV2 } from "../src/lib/intelligence/editorial/EditorialPropositionComposer";

const runId = process.argv[2] ?? "run-1788945245759";
const output = path.join(process.cwd(), "audit-reports", `phase3-composition-${runId}.md`);

function parse(value: unknown): Record<string, any> {
  try { return value && typeof value === "object" ? value as Record<string, any> : JSON.parse(String(value)); }
  catch { return {}; }
}



function sectionText(section: { propositions: Array<{ text: string }> }): string {
  return section.propositions.map((item) => item.text).join(" ") || "—";
}

async function main() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(
    `WITH ingested AS (
       SELECT DISTINCT canonical_job_id, opportunity_version, tenant_id, person_id
       FROM acquisition_ingestion_lineage
       WHERE scrape_run_id=? AND canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL
     )
     SELECT i.canonical_job_id, i.tenant_id, i.person_id, me.evaluation_json, me.decision, me.quality_score,
       ov.id AS opportunity_version_id, ov.raw_content, ov.job_title, ov.company_name
     FROM ingested i
     LEFT JOIN materialized_evaluations me ON me.tenant_id=i.tenant_id AND me.person_id=i.person_id
       AND me.canonical_job_id=i.canonical_job_id AND me.opportunity_version=i.opportunity_version
     JOIN opportunity_versions ov ON ov.id=i.opportunity_version
     JOIN search_plan_candidates spc ON spc.tenant_id=i.tenant_id AND spc.person_id=i.person_id
       AND spc.canonical_job_id=i.canonical_job_id AND spc.opportunity_version=i.opportunity_version
     WHERE spc.attention_decision='CANDIDATE'
     GROUP BY i.canonical_job_id, i.opportunity_version
     ORDER BY lower(ov.company_name), lower(ov.job_title)`,
    [runId],
  );

  const candidateCache = new Map<string, any | null>();
  const records: Array<{ row: any; contract: EditorialIntelligenceContract; composed: EditorialCompositionV2; evaluationState: "TRACE_AVAILABLE" | "SCALAR_ONLY" | "NO_EVALUATION" }> = [];
  for (const row of rows) {
    const artifact = parse(row.evaluation_json);
    const projection = artifact.jobProjection;
    const evidence = JobProjectionBuilder.extractPresentationEvidenceForPresentation(
      String(row.raw_content ?? ""), row.opportunity_version_id, Array.isArray(projection?.capabilities) ? projection.capabilities : [],
    );
    let contract: EditorialIntelligenceContract;
    let evaluationState: "TRACE_AVAILABLE" | "SCALAR_ONLY" | "NO_EVALUATION" = "NO_EVALUATION";
    if (projection && artifact.profileVersion) {
      const key = `${row.tenant_id}:${row.person_id}:${artifact.profileVersion}`;
      let candidate = candidateCache.get(key);
      if (candidate === undefined) {
        candidate = await resolveExactCandidateProjectionForScope(db, { tenantId: row.tenant_id, personId: row.person_id }, artifact.profileVersion);
        candidateCache.set(key, candidate ?? null);
      }
      if (candidate) {
        contract = buildEditorialIntelligenceContract({
          state: "EVALUATED",
          artifact,
          candidateProjection: candidate,
          presentationEvidence: {
            roleWorkEvidence: evidence.evidence,
            presentationQualificationEvidence: evidence.qualifications,
          },
        });
        evaluationState = contract.decisionDrivers.availability === "PERSISTED_DRIVER_DETAIL" ? "TRACE_AVAILABLE" : "SCALAR_ONLY";
      } else {
        contract = buildEditorialIntelligenceContract({
          state: "UNAVAILABLE",
          reasonCode: "NOT_EVALUABLE",
          presentationEvidence: {
            roleWorkEvidence: evidence.evidence,
            presentationQualificationEvidence: evidence.qualifications,
          },
        });
      }
    } else {
      contract = buildEditorialIntelligenceContract({
        state: "UNAVAILABLE",
        reasonCode: "NOT_EVALUABLE",
        presentationEvidence: {
          roleWorkEvidence: evidence.evidence,
          presentationQualificationEvidence: evidence.qualifications,
        },
      });
    }
    records.push({ row, contract, composed: composeEditorialIntelligenceV2(contract), evaluationState });
  }

  const count = (predicate: (record: typeof records[number]) => boolean) => records.filter(predicate).length;
  const allPropositions = records.flatMap((record) => record.composed.propositions);
  const allSections = records.flatMap((record) => Object.values(record.composed.sections));
  const sectionPropositions = allSections.flatMap((section) => section.propositions);
  const unsupportedEmployerFacts = allPropositions.filter((item) => item.kind === "EMPLOYER_FACT" && item.roleEvidenceIds.length === 0).length;
  const candidateAsEmployer = allPropositions.filter((item) => item.kind === "EMPLOYER_FACT" && item.candidateEvidenceIds.length > 0).length;
  const untraceableInference = allPropositions.filter((item) => item.kind === "RADAR_INFERENCE" && item.roleEvidenceIds.length === 0 && item.candidateEvidenceIds.length === 0 && item.canonicalSignalIds.length === 0).length;
  const scoreExplanation = allPropositions.filter((item) => item.kind === "RADAR_INFERENCE" && /score is|awarded|because capability/i.test(item.text)).length;
  const genericTemplates = allPropositions.filter((item) => /strong match for your background|relevant leadership experience|good fit for this opportunity|lead with your portfolio story|aligns with your trajectory/i.test(item.text)).length;
  const duplicateSectionPropositions = records.reduce((total, record) => {
    const ids = Object.values(record.composed.sections).flatMap((section) => section.propositions.map((item) => item.id));
    return total + ids.length - new Set(ids).size;
  }, 0);
  const substantive = (item: { kind: string }) => item.kind !== "EVIDENCE_LIMITATION";
  const sectionCoverage = (name: keyof EditorialCompositionV2["sections"]) => {
    const sections = records.map((record) => record.composed.sections[name]);
    return {
      substantive: sections.filter((section) => section.propositions.some(substantive)).length,
      limitationOnly: sections.filter((section) => section.propositions.length > 0 && section.propositions.every((item) => item.kind === "EVIDENCE_LIMITATION")).length,
    };
  };
  const heroCoverage = sectionCoverage("hero");
  const bottomLineCoverage = sectionCoverage("bottomLine");
  const howToWinCoverage = {
    roleSpecific: records.filter((record) => record.composed.sections.howToWin.propositions.some((item) => item.kind === "RADAR_INFERENCE" && item.roleEvidenceIds.length > 0 && item.candidateEvidenceIds.length === 0)).length,
    editorialPositioning: records.filter((record) => record.composed.sections.howToWin.propositions.some((item) => item.kind === "RADAR_INFERENCE" && item.roleEvidenceIds.length > 0 && item.candidateEvidenceIds.length > 0)).length,
    verificationOnly: records.filter((record) => record.composed.sections.howToWin.propositions.some((item) => item.kind === "RADAR_INFERENCE" && item.roleEvidenceIds.length === 0 && item.candidateEvidenceIds.length === 0 && item.canonicalSignalIds.length > 0)).length,
    limitationOnly: records.filter((record) => record.composed.sections.howToWin.propositions.length > 0 && record.composed.sections.howToWin.propositions.every((item) => item.kind === "EVIDENCE_LIMITATION")).length,
  };
  const substantivePerBrief = records.map((record) => record.composed.propositions.filter(substantive).length).sort((left, right) => left - right);
  const medianSubstantive = substantivePerBrief.length === 0 ? 0 : substantivePerBrief[Math.floor(substantivePerBrief.length / 2)]!;
  const modes = ["COMMERCIAL_LEADERSHIP", "TRANSFORMATION", "PRODUCT_LEADERSHIP", "FUNCTIONAL_SPECIALIST", "OPERATING_LEADERSHIP", "ADVISORY_CONSULTING", "EXECUTION_HEAVY", "SPARSE_AMBIGUOUS"] as const;
  const selected: typeof records = [];
  const take = (predicate: (record: typeof records[number]) => boolean) => {
    const record = records.find((item) => !selected.includes(item) && predicate(item));
    if (record) selected.push(record);
  };
  take((record) => /schnell/i.test(`${record.row.company_name} ${record.row.job_title}`));
  for (const mode of modes) take((record) => record.composed.compositionMode === mode);
  take((record) => record.evaluationState === "TRACE_AVAILABLE"
    && record.contract.candidateFitEvidence.some((fit) => fit.jobEvidence.length > 0)
    && record.composed.positioningRelations.length > 0);
  take((record) => record.evaluationState === "TRACE_AVAILABLE"
    && record.contract.decisionDrivers.constraints.length > 0);
  take((record) => (record.evaluationState === "SCALAR_ONLY" || record.evaluationState === "TRACE_AVAILABLE") && record.contract.publishedRoleWork.length === 0);
  take((record) => record.evaluationState === "NO_EVALUATION" && record.contract.publishedRoleWork.length > 0);

  const lines = [
    `# Phase 3 read-only composition review — ${runId}`,
    "",
    "The composer consumes only `editorial-intelligence-v2`. Raw source is used solely by the pre-existing Phase 1 presentation-augmentation boundary while building the frozen contract; the composer imports neither source text, projection builders, evaluators, nor persistence.",
    "",
    "## Population distribution",
    "",
    `- Cohort: **${records.length}**`,
    `- Trace-available / SCALAR_ONLY evaluation contracts: **${count((record) => record.evaluationState === "TRACE_AVAILABLE")} / ${count((record) => record.evaluationState === "SCALAR_ONLY")}**`,
    `- Policy-unavailable / no-evaluation briefs: **${count((record) => record.evaluationState === "NO_EVALUATION")}**`,
    `- Commercial/P&L: **${count((record) => record.composed.compositionMode === "COMMERCIAL_LEADERSHIP")}**`,
    `- Transformation: **${count((record) => record.composed.compositionMode === "TRANSFORMATION")}**`,
    `- Product leadership: **${count((record) => record.composed.compositionMode === "PRODUCT_LEADERSHIP")}**`,
    `- Functional specialist: **${count((record) => record.composed.compositionMode === "FUNCTIONAL_SPECIALIST")}**`,
    `- Operating leadership: **${count((record) => record.composed.compositionMode === "OPERATING_LEADERSHIP")}**`,
    `- Advisory/consulting: **${count((record) => record.composed.compositionMode === "ADVISORY_CONSULTING")}**`,
    `- Execution-heavy: **${count((record) => record.composed.compositionMode === "EXECUTION_HEAVY")}**`,
    `- Sparse/ambiguous: **${count((record) => record.composed.compositionMode === "SPARSE_AMBIGUOUS")}**`,
    `- Primary composition mode assigned: **${records.length}/${records.length}**`,
    "",
    "## Truth and usefulness controls",
    "",
    `- Unsupported employer factual propositions: **${unsupportedEmployerFacts}**`,
    `- Candidate facts represented as employer facts: **${candidateAsEmployer}**`,
    `- Fabricated historical score explanations: **${scoreExplanation}**`,
    `- Untraceable RADAR inferences: **${untraceableInference}**`,
    `- Generic-template propositions: **${genericTemplates}**`,
    `- Hero substantive / limitation-only: **${heroCoverage.substantive} / ${heroCoverage.limitationOnly}**`,
    `- Role-mandate coverage: **${count((record) => record.composed.coverage.hasRoleMandate)}/${records.length}**`,
    `- Qualification coverage: **${count((record) => record.composed.coverage.hasQualifications)}/${records.length}**`,
    `- Candidate fact coverage: **${count((record) => record.composed.sections.candidatePositioning.propositions.some((item) => item.kind === "CANDIDATE_FACT"))}/${records.length}**`,
    `- Evaluator-linked candidate-positioning coverage: **${count((record) => record.composed.positioningRelations.length > 0)}/${records.length}**`,
    `- Canonical fit-explanation coverage: **${count((record) => record.composed.propositions.some((item) => item.kind === "CANONICAL_EVALUATION" && item.candidateEvidenceIds.length > 0))}/${records.length}**`,
    `- Bottom Line substantive / limitation-only: **${bottomLineCoverage.substantive} / ${bottomLineCoverage.limitationOnly}**`,
    `- How-to-Win role-specific / editorial-positioning / verification-only / limitation-only: **${howToWinCoverage.roleSpecific} / ${howToWinCoverage.editorialPositioning} / ${howToWinCoverage.verificationOnly} / ${howToWinCoverage.limitationOnly}**`,
    `- Mean / median substantive propositions per dossier: **${records.length ? (substantivePerBrief.reduce((total, value) => total + value, 0) / records.length).toFixed(1) : "0"} / ${medianSubstantive}**`,
    `- Semantic duplicate propositions across major sections: **${duplicateSectionPropositions}**`,
    `- Briefs reusing a proposition in both Hero and Bottom Line: **${count((record) => {
      const heroIds = new Set(record.composed.sections.hero.propositions.map((item) => item.id));
      return record.composed.sections.bottomLine.propositions.some((item) => heroIds.has(item.id));
    })}**`,
    "",
    "## Representative review cohort",
    "",
  ];

  for (const record of selected) {
    const { contract, composed, row } = record;
    lines.push(
      `### ${row.company_name || "Unknown company"} — ${row.job_title || "Unknown role"}`,
      "",
      `- Canonical job: \`${row.canonical_job_id}\``,
      `- Evaluation state: **${record.evaluationState}**; verdict / score: **${contract.verdict ?? "—"} / ${contract.qualityScore ?? "—"}**`,
      `- Composition mode: **${composed.compositionMode}**`,
      `- Source-grounded role work: **${contract.publishedRoleWork.length}**; qualifications: **${contract.qualificationRequirements.length}**; candidate precedents: **${contract.candidatePrecedents.length}**`,
      "",
      "**Hero**  ", sectionText(composed.sections.hero),
      "",
      "**Why this deserves attention**  ", sectionText(composed.sections.whyAttention),
      "",
      "**What success requires**  ", sectionText(composed.sections.mandate),
      "",
      "**Why this reached your desk**  ", sectionText(composed.sections.candidatePositioning),
      "",
      "**Bottom Line**  ", sectionText(composed.sections.bottomLine),
      "",
      "**How to Win**  ", sectionText(composed.sections.howToWin),
      "",
      "**What to verify**  ", sectionText(composed.sections.verify),
      "",
      "**Proposition ledger**",
      ...composed.propositions.map((item) => `- \`${item.kind}\` — ${item.text} _(role: ${item.roleEvidenceIds.join(", ") || "—"}; candidate: ${item.candidateEvidenceIds.join(", ") || "—"}; canonical: ${item.canonicalSignalIds.join(", ") || "—"})_`),
      "",
    );
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${lines.join("\n")}\n`);
  console.log(output);
}

void main();
