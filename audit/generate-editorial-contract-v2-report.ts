/* Read-only Phase 2 contract coverage report. It consumes the current stored
 * evaluations and never invokes an evaluator or writes database state itself. */
import fs from "node:fs";
import path from "node:path";
import { getDatabaseAdapter } from "../src/data/database";
import { resolveExactCandidateProjectionForScope } from "../src/data/sqlite/repositories/profile-projection-version";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { buildEditorialIntelligenceContract } from "../src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder";

const runId = process.argv[2] ?? "run-1788945245759";
const output = path.join(process.cwd(), "audit-reports", `editorial-contract-v2-${runId}.md`);

const parse = (value: unknown): Record<string, any> => {
  try { return value && typeof value === "object" ? value as Record<string, any> : JSON.parse(String(value)); }
  catch { return {}; }
};

async function main() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(
    `WITH ingested AS (
       SELECT DISTINCT canonical_job_id, opportunity_version, tenant_id, person_id
       FROM acquisition_ingestion_lineage
       WHERE scrape_run_id=? AND canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL
     )
     SELECT i.tenant_id, i.person_id, me.evaluation_json, me.decision, me.quality_score,
       ov.id AS opportunity_version_id, ov.raw_content, ov.job_title, ov.company_name
     FROM ingested i
     JOIN search_plan_candidates spc ON spc.tenant_id=i.tenant_id AND spc.person_id=i.person_id
       AND spc.canonical_job_id=i.canonical_job_id AND spc.opportunity_version=i.opportunity_version
     JOIN materialized_evaluations me ON me.tenant_id=i.tenant_id AND me.person_id=i.person_id
       AND me.canonical_job_id=i.canonical_job_id AND me.opportunity_version=i.opportunity_version
     JOIN opportunity_versions ov ON ov.id=i.opportunity_version
     WHERE spc.attention_decision='CANDIDATE'
     GROUP BY i.canonical_job_id, i.opportunity_version
     ORDER BY lower(ov.company_name), lower(ov.job_title)`,
    [runId],
  );

  const candidateCache = new Map<string, any | null>();
  const records = [] as any[];
  for (const row of rows) {
    const artifact = parse(row.evaluation_json);
    const projection = artifact.jobProjection;
    if (!projection || typeof row.raw_content !== "string" || !row.raw_content.trim()) {
      const sourceOnlyEvidence = typeof row.raw_content === "string" && row.raw_content.trim()
        ? JobProjectionBuilder.extractPresentationEvidenceForPresentation(
          row.raw_content,
          row.opportunity_version_id,
          [],
        )
        : { evidence: [], qualifications: [] };
      records.push({
        row,
        state: sourceOnlyEvidence.evidence.length > 0 ? "ROLE_ONLY_WITHOUT_EVALUATION" : "LIMITED_ROLE_AND_FIT",
        roleWork: sourceOnlyEvidence.evidence,
        qualificationEvidence: sourceOnlyEvidence.qualifications,
        contract: null,
      });
      continue;
    }
    const key = `${row.tenant_id}:${row.person_id}:${artifact.profileVersion || ""}`;
    let candidate = candidateCache.get(key);
    if (candidate === undefined) {
      candidate = artifact.profileVersion
        ? await resolveExactCandidateProjectionForScope(db, { tenantId: row.tenant_id, personId: row.person_id }, artifact.profileVersion)
        : null;
      candidateCache.set(key, candidate || null);
    }
    if (!candidate) {
      records.push({ row, state: "PINNED_CANDIDATE_PROJECTION_UNAVAILABLE", roleWork: [], contract: null });
      continue;
    }
    const presentationEvidence = JobProjectionBuilder.extractPresentationEvidenceForPresentation(
      row.raw_content,
      row.opportunity_version_id,
      Array.isArray(projection.capabilities) ? projection.capabilities : [],
    );
    const roleWork = presentationEvidence.evidence;
    const contract = buildEditorialIntelligenceContract(artifact, candidate, {
      roleWorkEvidence: roleWork,
      presentationQualificationEvidence: presentationEvidence.qualifications,
    });
    const roleRich = contract.publishedRoleWork.length > 0;
    const fitRich = contract.candidateFitEvidence.length > 0;
    const coverage = roleRich
      ? fitRich ? "RICH_ROLE_AND_FIT" : "RICH_ROLE_LIMITED_FIT"
      : fitRich ? "LIMITED_ROLE_RICH_FIT" : "LIMITED_ROLE_AND_FIT";
    const sourceResolved = contract.publishedRoleWork.every((item) => roleWork.some((atom) => atom.id === item.sourceEvidenceId))
      && contract.roleContext.every((item) => roleWork.some((atom) => atom.id === item.sourceEvidenceId));
    const qualificationSourceResolved = contract.qualificationRequirements.every((item) =>
      item.sourceEvidenceIds.every((id) => presentationEvidence.qualifications.some((atom) => atom.id === id)),
    );
    const contamination = contract.publishedRoleWork.some((work) => contract.candidatePrecedents.some((candidateFact) => candidateFact.statement === work.statement))
      || contract.candidatePrecedents.some((candidateFact) => candidateFact.provenance !== "CANDIDATE_FACT");
    records.push({
      row,
      state: coverage,
      roleWork,
      qualificationEvidence: presentationEvidence.qualifications,
      contract,
      sourceResolved,
      qualificationSourceResolved,
      contamination,
      persistedTrace: (artifact as any).decisionTrace ?? null,
    });
  }

  const withContract = records.filter((record) => record.contract);
  const count = (predicate: (record: any) => boolean) => records.filter(predicate).length;
  const workCount = (kind: string) => withContract.reduce((total: number, record: any) =>
    total + record.contract.publishedRoleWork.filter((work: any) => work.kind === kind).length, 0);
  const sourceOnlyRecords = records.filter((record) => !record.contract);
  const sourceOnlyWork = sourceOnlyRecords.reduce((total, record) => total + record.roleWork.length, 0);
  const coverageCount = (state: string) => count((record) => record.state === state);
  const structuredGenericPlaceholderCount = withContract.reduce((total: number, record: any) => {
    const structured = {
      candidateCapabilityLabels: record.contract.candidateCapabilities.map((item: any) => item.capability),
      candidateFitEvidence: record.contract.candidateFitEvidence,
      candidatePrecedents: record.contract.candidatePrecedents,
      canonicalSignalValues: record.contract.canonicalSignals.map((item: any) => item.value),
      decisionDrivers: record.contract.decisionDrivers,
      synthesisInputs: record.contract.synthesisInputs,
    };
    return total + (JSON.stringify(structured).match(/strong match for your background|relevant experience|good leadership fit|lead with your portfolio story/gi)?.length ?? 0);
  }, 0);
  const legacyCompatibilityProseOccurrences = withContract.reduce((total: number, record: any) =>
    total + (JSON.stringify({
      careerCase: record.contract.careerCase,
      positioningAngles: record.contract.positioningAngles,
      provenance: record.contract.provenance,
    }).match(/strong match for your background|relevant experience|good leadership fit|lead with your portfolio story/gi)?.length ?? 0), 0);
  const candidateCapabilityIds = withContract.flatMap((record: any) =>
    record.contract.candidateCapabilities.flatMap((capability: any) => capability.evidenceIds));
  const publishedRoleWorkItems = withContract.flatMap((record: any) => record.contract.publishedRoleWork);
  const resolvedPublishedRoleWorkItems = withContract.reduce((total: number, record: any) => total + record.contract.publishedRoleWork.filter((item: any) =>
    record.roleWork.some((atom: any) => atom.id === item.sourceEvidenceId),
  ).length, 0);
  const qualificationRequirementItems = withContract.flatMap((record: any) => record.contract.qualificationRequirements);
  const resolvedQualificationRequirementItems = withContract.reduce((total: number, record: any) => total + record.contract.qualificationRequirements.filter((item: any) =>
    item.sourceEvidenceIds.every((id: string) => record.qualificationEvidence.some((atom: any) => atom.id === id)),
  ).length, 0);
  const persistedTraceRelationships = withContract.flatMap((record: any) => record.persistedTrace?.relationships ?? []);
  const contractTraceRelationships = withContract.flatMap((record: any) => record.contract.candidateFitEvidence);
  const traceIdentityPreserved = withContract.every((record: any) => {
    const trace = record.persistedTrace?.relationships ?? [];
    const contractRelations = record.contract.candidateFitEvidence;
    return trace.length === contractRelations.length && trace.every((relationship: any, index: number) => {
      const item = contractRelations[index];
      return item
        && item.relationship === relationship.relationship
        && item.candidateCapabilityKey === relationship.candidateCapabilityKey
        && item.jobCapabilityKey === relationship.jobCapabilityKey
        && JSON.stringify(item.candidateEvidenceIds) === JSON.stringify([...new Set(relationship.candidateEvidenceIds)].sort())
        && JSON.stringify(item.jobEvidenceIds) === JSON.stringify([...new Set(relationship.jobEvidenceIds)].sort());
    });
  });
  const traceCandidateEvidenceIds = contractTraceRelationships.flatMap((relationship: any) => relationship.candidateEvidenceIds);
  const traceJobEvidenceIds = contractTraceRelationships.flatMap((relationship: any) => relationship.jobEvidenceIds);
  const resolvedTraceCandidateEvidenceIds = withContract.reduce((total: number, record: any) => total + record.contract.candidateFitEvidence
    .flatMap((relationship: any) => relationship.candidateEvidenceIds)
    .filter((id: string) => record.contract.candidateCapabilities.some((capability: any) => capability.evidenceIds.includes(id))).length, 0);
  const resolvedTraceJobEvidenceIds = contractTraceRelationships.reduce((total: number, relationship: any) =>
    total + relationship.jobEvidence.length, 0);
  // Contract fields are capped for display. Certify every atom emitted by the
  // shared extractor, including source-only rows without an evaluation.
  const qualificationItems = records.flatMap((record: any) =>
    (record.qualificationEvidence ?? []).map((atom: any) => ({ id: atom.id, statement: atom.statement })),
  );
  const sourceOnlyQualificationItems = records
    .filter((record: any) => !record.contract)
    .flatMap((record: any) => (record.qualificationEvidence ?? []).map((atom: any) => atom.statement));
  const isSourceOnlyCompanyDescription = (statement: string) =>
    /^(?:our\s+(?:teams?|company|business)|(?:[A-Z][A-Za-z0-9&.\-]*\s+){2,5}(?:is|are|has|have|operates|delivers|provides|serves|partners))\b/.test(statement)
    || /\b(?:fortune\s+500|learn\s+more\s+at)\b/i.test(statement);
  const standaloneHeading = /^(?:what you bring|who you are|what we(?:'re| are) looking for|what you can expect|what are we looking for|job overview)\s*[:?]?\s*$/i;
  const fusedHeadingMarkers = /\b(?:what you bring|who you are|what we(?:'re| are) looking for|what you can expect|what are we looking for|job overview|educational qualification)\b/gi;
  const hasFusedHeadingBoundary = (statement: string) => {
    const markers = statement.match(fusedHeadingMarkers) ?? [];
    return markers.length > 1
      || /\b(?:what are we looking for|job overview)\s*[:?]?\s*$/i.test(statement);
  };
  const qualificationControlCounts = {
    dutyAsQualification: qualificationItems.filter(({ statement }) =>
      /^(?:the\s+)?(?:ideal\s+)?candidate\s+will\s+(?:be\s+)?(?:responsible|accountable)\b|^(?:you|this role|the role)\s+will\s+(?:be\s+)?(?:responsible|accountable|own|lead|manage|coordinate)\b/i.test(statement),
    ).length,
    corporateCopy: qualificationItems.filter(({ statement }) =>
      /^(?:we\s+prioriti[sz]e\b[\s\S]*\b(?:well[- ]being|benefits?|personal journey)|(?:\w+\s+)?pay\s+(?:empowers|allows|gives)\b[\s\S]*\b(?:employees?|tax benefits?|salary components?))/i.test(statement),
    ).length,
    applicationOrWorkplace: qualificationItems.filter(({ statement }) =>
      /^(?:your\s+recruit(?:ing)?\s+contact|if\s+you\s+are\s+primarily\s+looking|(?:q|a)\s*:)|\b(?:by applying|apply(?:ing)?\s+to (?:this )?(?:position|role)|work location|salary|working hours|shift:|\d+Q\s*:)\b/i.test(statement),
    ).length,
    malformedMeta: qualificationItems.filter(({ statement }) =>
      /^(?:what you bring|who you are|what we(?:'re| are) looking for|what you can expect)\s*$|\b(?:required skills?|preferred qualifications?|management level|job location|education|job overview|what are we looking for)\s*:?\s*$/i.test(statement),
    ).length,
    candidateBenefit: qualificationItems.filter(({ statement }) =>
      /^(?:real portfolio projects|work[- ]life integration|work on your terms|be a part of something|make a difference)\s*:|\b(?:strengthen your portfolio|career acceleration|opportunity to (?:gain|learn|work))\b/i.test(statement),
    ).length,
    standaloneHeading: qualificationItems.filter(({ statement }) => standaloneHeading.test(statement)).length,
    fusedHeadingBoundary: qualificationItems.filter(({ statement }) => hasFusedHeadingBoundary(statement)).length,
  };
  // These source-only controls intentionally inspect emitted evidence itself,
  // rather than relying on extraction rejection counters or contract caps.
  const sourceOnlyQualificationControlCounts = {
    companyDescription: sourceOnlyQualificationItems.filter((statement: string) =>
      isSourceOnlyCompanyDescription(statement),
    ).length,
    assignedWork: sourceOnlyQualificationItems.filter((statement: string) =>
      /^(?:(?:to\s+)?(?:liaise|add|review|work|anchor)|(?:anchoring|supporting|liaising|adding|reviewing|working))\b/i.test(statement),
    ).length,
    recruitmentCta: sourceOnlyQualificationItems.filter((statement: string) =>
      /^(?:if\s+you\s+have\b[\s\S]*\b(?:come|join|be a part)\b|learn\s+more\s+at\b|come\s+and\s+be\b|apply\b)/i.test(statement),
    ).length,
    candidateValue: sourceOnlyQualificationItems.filter((statement: string) =>
      /^(?:you(?:'ll| will)\s+(?:have|receive|get)|we\s+prioriti[sz]e\b[\s\S]*\b(?:well[- ]being|benefits?|personal journey)\b)/i.test(statement),
    ).length,
    employmentMetadata: sourceOnlyQualificationItems.filter((statement: string) =>
      /\b(?:day[- ]?1\b[\s\S]*\b(?:office|onboarding)|confidentiality\s+(?:notice|statement|agreement|disclaimer|information)|salary range|work location|working hours)\b/i.test(statement),
    ).length,
  };
  const sourceOnlyCompanyDescriptionExamples = sourceOnlyQualificationItems.filter((statement: string) =>
    isSourceOnlyCompanyDescription(statement),
  );
  const roleWorkItems = records.flatMap((record: any) =>
    (record.roleWork ?? [])
      .filter((atom: any) => atom.kind === "RESPONSIBILITY" || atom.kind === "OUTCOME")
      .map((atom: any) => atom.statement),
  );
  const roleWorkControlCounts = {
    benefitOrPromotional: roleWorkItems.filter((statement: string) =>
      /^(?:work\s*[/\-]?\s*life balance|work[- ]life integration|work on your terms|be a part of something|make a difference|availability)\b|\bwe value work[- ]life harmony\b|^direct,?\s+(?:regular\s+)?access to\b|^availability\b[\s\S]*\b(?:saturdays?|sundays?|working days?|office[- ]based)\b|^work on\b[\s\S]*\b(?:groundbreaking|cutting-edge|transformative)\b[\s\S]*\b(?:transforming|shaping|future)\b/i.test(statement),
    ).length,
    qualificationHeading: roleWorkItems.filter((statement: string) =>
      /^(?:work experience|education|required skills?|preferred qualifications?|what you bring|who you are|what we(?:'re| are) looking for|what you can expect)\b/i.test(statement),
    ).length,
    fusedBoundary: roleWorkItems.filter((statement: string) =>
      /\b(?:required skills?(?:\s*(?:&|and)\s*experience)?|problem solving|interaction|job overview|what are we looking for)\s*:?\s*$|:\s*[^:]{0,280}\b(?:[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|&)){1,5})\s*:\s*(?:Work|Own|Lead|Manage|Drive|Build|Develop|Execute|Deliver|Monitor|Track|Coordinate|Collaborate)\b/i.test(statement),
    ).length,
    candidateEnvironment: roleWorkItems.filter((statement: string) =>
      /^you\s+will\s+work\s+with\s+(?:an?\s+)?(?:high[- ]density|talented|world-class|exceptional)\b/i.test(statement),
    ).length,
    workingCondition: roleWorkItems.filter((statement: string) =>
      /^working conditions?\s*:/i.test(statement),
    ).length,
    embeddedKraKpi: roleWorkItems.filter((statement: string) =>
      /(?:KRA|KPI)\s*\d+\b/i.test(statement),
    ).length,
    fusedHeadingBoundary: roleWorkItems.filter((statement: string) => hasFusedHeadingBoundary(statement)).length,
    valueOrEnvironmentSlogan: roleWorkItems.filter((statement: string) =>
      /^(?:build\s+for\s+(?:the\s+)?future|work\s+with\s+(?:passion|persistence|purpose|integrity|pride)|deliver\s+results\s+(?:you|we)\S*\s+(?:proud|believe)|partner\s+across\s+(?:geograph\w*|generations?|teams?|cultures?))\b/i.test(statement),
    ).length,
  };
  const lines = [
    `# Phase 2 editorial-intelligence-v2 coverage — ${runId}`,
    "",
    "Read-only contract report. It consumes the current stored evaluation baseline; role work is the exact-source additive presentation augmentation. This reporting run invokes no evaluator and writes no database row.",
    "",
    "## Aggregate",
    "",
    `- Cohort rows: **${records.length}**`,
    `- Contracts built from stored evaluation + pinned candidate projection: **${withContract.length}**`,
    `- No stored evaluation artifact: **${count((record) => !record.contract && record.state !== "PINNED_CANDIDATE_PROJECTION_UNAVAILABLE")}**`,
    `- Source-only records without a stored evaluation artifact: **${count((record) => record.state === "ROLE_ONLY_WITHOUT_EVALUATION")}**`,
    `- Source-only role-work atoms (not used to make fit claims): **${sourceOnlyWork}**`,
    `- Pinned candidate projection unavailable: **${count((record) => record.state === "PINNED_CANDIDATE_PROJECTION_UNAVAILABLE")}**`,
    `- Published role work: **${withContract.reduce((total, record) => total + record.contract.publishedRoleWork.length, 0)}**`,
    `- Responsibilities / outcomes: **${workCount("RESPONSIBILITY")} / ${workCount("OUTCOME")}**`,
    `- Role context atoms: **${withContract.reduce((total, record) => total + record.contract.roleContext.length, 0)}**`,
    `- Qualification requirements: **${withContract.reduce((total, record) => total + record.contract.qualificationRequirements.length, 0)}**`,
    `- Candidate capability signals: **${withContract.reduce((total, record) => total + record.contract.candidateCapabilities.length, 0)}**`,
    `- Role-specific candidate-fit relationships: **${withContract.reduce((total, record) => total + record.contract.candidateFitEvidence.length, 0)}**`,
    `- Persisted trace relationships / contract relationships / exact identity preservation: **${persistedTraceRelationships.length} / ${contractTraceRelationships.length} / ${traceIdentityPreserved ? "YES" : "NO"}**`,
    `- Trace candidate-evidence resolution: **${resolvedTraceCandidateEvidenceIds}/${traceCandidateEvidenceIds.length}**`,
    `- Trace job-evidence resolution: **${resolvedTraceJobEvidenceIds}/${traceJobEvidenceIds.length}**`,
    `- Candidate precedents: **${withContract.reduce((total, record) => total + record.contract.candidatePrecedents.length, 0)}**`,
    `- Canonical strength signals available: **${count((record) => record.contract?.canonicalSignals.some((signal: any) => signal.kind === "CAPABILITY" || signal.kind === "DIMENSION"))}**`,
    `- Persisted decision-driver detail available: **${count((record) => record.contract?.decisionDrivers.availability === "PERSISTED_DRIVER_DETAIL")}**`,
    `- Evidence-limited role records: **${count((record) => record.contract && record.contract.publishedRoleWork.length === 0)}**`,
    `- Role mandate ingredients: **${count((record) => record.contract && (record.contract.publishedRoleWork.length > 0 || record.contract.qualificationRequirements.length > 0 || record.contract.roleContext.length > 0))}**`,
    `- Role-specific fit-explanation ingredients: **${count((record) => record.contract && record.contract.candidateFitEvidence.length > 0)}**`,
    `- Risk/gap/hinge ingredients: **${count((record) => record.contract?.decisionDrivers.availability === "PERSISTED_DRIVER_DETAIL")}**`,
    `- Grounded How-to-Win synthesis ingredients: **${count((record) => record.contract && (
      record.contract.publishedRoleWork.length > 0
      || record.contract.qualificationRequirements.length > 0
      || record.contract.roleContext.length > 0
      || record.contract.decisionDrivers.availability === "PERSISTED_DRIVER_DETAIL"
    ))}**`,
    `- Employer source provenance resolution: **${count((record) => record.contract && record.sourceResolved)}/${withContract.length}**`,
    `- Published role-work source-evidence resolution: **${resolvedPublishedRoleWorkItems}/${publishedRoleWorkItems.length}**`,
    `- Qualification source-evidence resolution: **${resolvedQualificationRequirementItems}/${qualificationRequirementItems.length}**`,
    `- Qualification semantic controls — duty-as-qualification / corporate-copy / application-or-workplace / standalone-or-fused-heading / candidate-benefit: **${qualificationControlCounts.dutyAsQualification} / ${qualificationControlCounts.corporateCopy} / ${qualificationControlCounts.applicationOrWorkplace} / ${qualificationControlCounts.malformedMeta} / ${qualificationControlCounts.candidateBenefit}**`,
    `- Source-only qualification controls — company-description / assigned-work / recruitment-CTA / candidate-value / employment-metadata: **${sourceOnlyQualificationControlCounts.companyDescription} / ${sourceOnlyQualificationControlCounts.assignedWork} / ${sourceOnlyQualificationControlCounts.recruitmentCta} / ${sourceOnlyQualificationControlCounts.candidateValue} / ${sourceOnlyQualificationControlCounts.employmentMetadata}**`,
    `- Role-work semantic controls — benefit-or-promotional / qualification-heading / fused-boundary / candidate-environment: **${roleWorkControlCounts.benefitOrPromotional} / ${roleWorkControlCounts.qualificationHeading} / ${roleWorkControlCounts.fusedBoundary} / ${roleWorkControlCounts.candidateEnvironment}**`,
    `- Phase 2 closure controls — working-condition-as-role-work / embedded-KRA-KPI-fused-role-work: **${roleWorkControlCounts.workingCondition} / ${roleWorkControlCounts.embeddedKraKpi}**`,
    `- Full-population source-only guard — value-or-environment-slogan in role work: **${roleWorkControlCounts.valueOrEnvironmentSlogan}**`,
    `- Final independent controls — standalone-heading-as-qualification / fused-heading-boundary / candidate-benefit-as-qualification / candidate-environment-as-role-work: **${qualificationControlCounts.standaloneHeading} / ${qualificationControlCounts.fusedHeadingBoundary + roleWorkControlCounts.fusedHeadingBoundary} / ${qualificationControlCounts.candidateBenefit} / ${roleWorkControlCounts.candidateEnvironment}**`,
    `- Candidate/employer provenance contamination: **${count((record) => record.contamination)}**`,
    `- Structured v2 generic placeholder occurrences: **${structuredGenericPlaceholderCount}**`,
    `- Legacy compatibility-prose placeholder occurrences (not Phase 2 composition input): **${legacyCompatibilityProseOccurrences}**`,
    `- Candidate evidence-id resolution: **${candidateCapabilityIds.filter(Boolean).length}/${candidateCapabilityIds.length}**`,
    ...(sourceOnlyCompanyDescriptionExamples.length > 0
      ? ["", "## Source-only qualification control exceptions", "", ...sourceOnlyCompanyDescriptionExamples.map((statement: string) => `- ${statement}`)]
      : []),
    "",
    "## Coverage classification",
    "",
    `- RICH_ROLE_AND_FIT: **${coverageCount("RICH_ROLE_AND_FIT")}**`,
    `- RICH_ROLE_LIMITED_FIT: **${coverageCount("RICH_ROLE_LIMITED_FIT")}**`,
    `- LIMITED_ROLE_RICH_FIT: **${coverageCount("LIMITED_ROLE_RICH_FIT")}**`,
    `- LIMITED_ROLE_AND_FIT: **${coverageCount("LIMITED_ROLE_AND_FIT")}**`,
    `- ROLE_ONLY_WITHOUT_EVALUATION: **${coverageCount("ROLE_ONLY_WITHOUT_EVALUATION")}**`,
    "",
    "## Per opportunity",
  ];
  for (const record of records) {
    if (!record.contract) {
      lines.push(
        "", `### ${record.row.company_name} — ${record.row.job_title}`, "",
        `- Coverage: **${record.state}**`,
        `- Stored evaluation interpretation: **UNAVAILABLE — no fit claim reconstructed**`,
        `- Exact-source role work available: **${record.roleWork.length}**`,
        ...record.roleWork.map((item: any) => `  - ${item.kind} [${item.id}]: ${item.statement}`),
        `- Exact-source qualifications available: **${(record.qualificationEvidence ?? []).length}**`,
        ...(record.qualificationEvidence ?? []).map((item: any) => `  - REQUIREMENT [${item.id}]: ${item.statement}`),
      );
      continue;
    }
    const contract = record.contract;
    lines.push(
      "", `### ${record.row.company_name} — ${record.row.job_title}`, "",
      `- Coverage: **${record.state}**`,
      `- Published role work: **${contract.publishedRoleWork.length}** (${contract.publishedRoleWork.filter((item: any) => item.kind === "RESPONSIBILITY").length} responsibilities, ${contract.publishedRoleWork.filter((item: any) => item.kind === "OUTCOME").length} outcomes)`,
      `- Qualifications / role context / candidate capability signals / candidate-fit relationships / candidate precedents: **${contract.qualificationRequirements.length} / ${contract.roleContext.length} / ${contract.candidateCapabilities.length} / ${contract.candidateFitEvidence.length} / ${contract.candidatePrecedents.length}**`,
      `- Canonical signals: **${contract.canonicalSignals.length}**; decision-driver detail: **${contract.decisionDrivers.availability}**; hinges: **${contract.decisionHinges.length}**`,
      `- Persisted trace relationship identity / count: **${(record.persistedTrace?.relationships ?? []).length ? "PRESERVED" : "—"} / ${(record.persistedTrace?.relationships ?? []).length}**`,
      `- Employer / qualification provenance resolved: **${record.sourceResolved ? "YES" : "NO"} / ${record.qualificationSourceResolved ? "YES" : "NO"}**; contamination: **${record.contamination ? "YES" : "NO"}**`,
      ...contract.publishedRoleWork.map((item: any) => `  - ${item.kind} [${item.sourceEvidenceId}]: ${item.statement}`),
      ...contract.qualificationRequirements.flatMap((item: any) => item.sourceEvidenceIds.map((id: string) => `  - REQUIREMENT [${id}]: ${item.statement}`)),
      ...contract.candidateFitEvidence.map((relationship: any) => `  - TRACE [${relationship.id}] ${relationship.relationship}: ${relationship.candidateCapabilityKey} → ${relationship.jobCapabilityKey}; candidate IDs: ${relationship.candidateEvidenceIds.join(", ") || "—"}; job evidence: ${relationship.jobEvidence.map((item: any) => `[${item.id}] ${item.statement}`).join(" | ") || "—"}`),
    );
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ output, rows: records.length, contracts: withContract.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
