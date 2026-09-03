/**
 * Read-only postflight for one G3 run. It reconciles durable run lineage,
 * canonical-version hashes, local snapshot bindings, active NCR candidates,
 * and any cross-scope projections caused by a prior ingestion path.
 */
import fs from "node:fs";
import path from "node:path";
import { getDatabaseAdapter } from "../../src/data/database";
import { getRepositories } from "../../src/data/sqlite/provider";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { SNAPSHOT_DIR } from "../scraper/config";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const ncrTokens = ["gurugram", "gurgaon", "new delhi", "delhi", "noida", "greater noida", "ghaziabad", "faridabad"];
const remoteTokens = ["remote", "work from home", "wfh", "anywhere"];
function locationKind(value: string | null): "NCR" | "REMOTE" | "UNKNOWN" | "OUTSIDE" {
  const normalized = (value || "").toLowerCase();
  if (!normalized || /^(unknown|unspecified|india)$/.test(normalized.trim())) return "UNKNOWN";
  if (ncrTokens.some((token) => normalized.includes(token))) return "NCR";
  if (remoteTokens.some((token) => normalized.includes(token))) return "REMOTE";
  return "OUTSIDE";
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  const runId = argument("--run-id");
  if (!userId || !runId) throw new Error("Usage requires --user-id <authenticated-user-id> --run-id <run-id>.");

  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const active = await getRepositories().evaluationContexts.getActiveSearchPlanWithSnapshot(scope);
  if (active.criteria.eligibilitySpec?.locationPolicy !== "NCR") {
    throw new Error("G3 audit requires the active context to declare NCR policy.");
  }

  const lineage = await db.many<{
    card_id: string; document_state: string; content_hash: string | null; canonical_job_id: string | null;
    opportunity_version: string | null; version_hash: string | null;
  }>(
    `SELECT ail.card_id, ail.document_state, ail.content_hash, ail.canonical_job_id, ail.opportunity_version,
            ov.content_hash AS version_hash
       FROM acquisition_ingestion_lineage ail
       LEFT JOIN opportunity_versions ov
         ON ov.canonical_job_id = ail.canonical_job_id AND ov.id = ail.opportunity_version
      WHERE ail.scrape_run_id = ? AND ail.tenant_id = ? AND ail.person_id = ?`,
    [runId, scope.tenantId, scope.personId],
  );
  const canonical = lineage.filter((row) => row.canonical_job_id && row.opportunity_version);
  const hashMismatch = canonical.filter((row) => row.content_hash !== row.version_hash);
  const substantive = lineage.filter((row) => row.document_state === "SUBSTANTIVE");
  const snapshots = substantive.map((row) => {
    const cardHash = row.card_id.slice(row.card_id.lastIndexOf("#") + 1);
    const snapshotPath = path.join(SNAPSHOT_DIR, `${cardHash}.json`);
    if (!fs.existsSync(snapshotPath)) return { state: "MISSING" as const };
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { evaluationEvidence?: Record<string, unknown> };
    const evidence = parsed.evaluationEvidence;
    const bound = evidence?.state === "BOUND"
      && evidence.canonicalJobId === row.canonical_job_id
      && evidence.opportunityVersion === row.opportunity_version
      && evidence.contentHash === row.content_hash;
    return { state: bound ? "BOUND" as const : "MISMATCH" as const };
  });
  const candidates = await db.many<{
    attention_decision: string; eligibility: string | null; location_evidence: string | null;
    location_policy: string | null; reason_codes: string | null; job_title: string | null;
    company_name: string | null; version_location: string | null; source_url: string;
  }>(
    `SELECT spc.attention_decision, spc.eligibility, spc.location_evidence,
            spc.location_policy, spc.eligibility_reason_codes_json AS reason_codes,
            ov.job_title, ov.company_name, ov.location AS version_location, ail.source_url
       FROM search_plan_candidates spc
       JOIN acquisition_ingestion_lineage ail
         ON ail.canonical_job_id = spc.canonical_job_id AND ail.opportunity_version = spc.opportunity_version
       JOIN opportunity_versions ov
         ON ov.canonical_job_id = spc.canonical_job_id AND ov.id = spc.opportunity_version
      WHERE ail.scrape_run_id = ? AND ail.tenant_id = ? AND ail.person_id = ?
        AND spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ?`,
    [runId, scope.tenantId, scope.personId, scope.tenantId, scope.personId, active.planId],
  );
  const outsideCandidates = candidates.filter((row) => locationKind(row.location_evidence) === "OUTSIDE" && row.attention_decision === "CANDIDATE");
  const crossScope = await db.many<{ tenant_id: string; person_id: string; search_plan_id: string; count: number }>(
    `SELECT spc.tenant_id, spc.person_id, spc.search_plan_id, COUNT(*) AS count
       FROM search_plan_candidates spc
       JOIN acquisition_ingestion_lineage ail
         ON ail.canonical_job_id = spc.canonical_job_id AND ail.opportunity_version = spc.opportunity_version
      WHERE ail.scrape_run_id = ?
      GROUP BY spc.tenant_id, spc.person_id, spc.search_plan_id
      ORDER BY spc.tenant_id, spc.person_id, spc.search_plan_id`,
    [runId],
  );

  console.log(JSON.stringify({
    status: hashMismatch.length === 0 && snapshots.every((item) => item.state === "BOUND") && outsideCandidates.length === 0 ? "passed" : "failed",
    mode: "read-only",
    runId,
    activeContext: { searchPlanId: active.planId, contextFingerprint: active.contextFingerprint, locationPolicy: "NCR" },
    lineage: {
      records: lineage.length,
      canonicalBound: canonical.length,
      missingCanonicalBinding: lineage.length - canonical.length,
      contentHashMismatches: hashMismatch.length,
    },
    snapshots: {
      substantiveDocuments: substantive.length,
      bound: snapshots.filter((item) => item.state === "BOUND").length,
      missing: snapshots.filter((item) => item.state === "MISSING").length,
      mismatched: snapshots.filter((item) => item.state === "MISMATCH").length,
    },
    ncrServing: {
      activePlanProjectionRows: candidates.length,
      activePlanCandidates: candidates.filter((row) => row.attention_decision === "CANDIDATE").length,
      outsideNcrCandidates: outsideCandidates.length,
      outsideNcrRejected: candidates.filter((row) => locationKind(row.location_evidence) === "OUTSIDE" && row.eligibility === "INELIGIBLE").length,
      remoteOrUnknownReview: candidates.filter((row) => ["REMOTE", "UNKNOWN"].includes(locationKind(row.location_evidence)) && row.eligibility === "REVIEW").length,
      outsideNcrCandidateRecords: outsideCandidates.map((row) => ({
        title: row.job_title,
        company: row.company_name,
        locationEvidence: row.location_evidence,
        versionLocation: row.version_location,
        locationPolicy: row.location_policy,
        reasonCodes: row.reason_codes ? JSON.parse(row.reason_codes) : [],
        sourceUrl: row.source_url,
      })),
    },
    projectionScopes: crossScope,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
