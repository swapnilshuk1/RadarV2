import { getDatabaseAdapter } from "../../src/data/database/index";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import { getRepositories } from "../../src/data/sqlite/provider";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface GoldenOpportunityRecord {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  scrapedFrom: string;
  postedAt?: string | null;
  applyUrl?: string | null;
  evaluationState: string;
  engineVerdict?: string | null;
  qualityScore?: number | null;
  vetoed: boolean;
  userAction?: string | null;
  effectiveDecision: string;
  populationTier: number;
  categoryIds: string[];
  rankingPosition: number;
}

export interface GoldenDatasetManifest {
  contextFingerprint: string;
  searchPlanId: string;
  userId: string;
  tenantId: string;
  datasetTimestamp: string;
  sourceImplementationVersion: string;
  totalCount: number;
  sha256OrderFingerprint: string;
  distributions: {
    engineVerdicts: Record<string, number>;
    effectiveDecisions: Record<string, number>;
    populationTiers: Record<number, number>;
    categories: Record<string, number>;
  };
  records: GoldenOpportunityRecord[];
}

export async function generateGoldenDataset(
  targetUserId = process.env.RADAR_USER_ID,
  requestedTenantId = process.env.RADAR_TENANT_ID,
): Promise<GoldenDatasetManifest> {
  const db = getDatabaseAdapter();
  const repos = getRepositories();

  if (!targetUserId) {
    throw new Error("RADAR_USER_ID (or an explicit targetUserId) is required to establish the authorized serving scope.");
  }

  console.log(`[GoldenDataset] Resolving authorized scope for user: ${targetUserId}`);
  const resolved = await resolveServingScope(targetUserId, requestedTenantId, db);
  const { scope, activeContext } = resolved;

  if (!activeContext) {
    throw new Error(`No active context found for scope: tenant=${scope.tenantId}, person=${scope.personId}`);
  }

  console.log(`[GoldenDataset] Active Search Plan: ${activeContext.searchPlanId}`);
  console.log(`[GoldenDataset] Context Fingerprint: ${activeContext.contextFingerprint}`);
  console.log(`[GoldenDataset] Materializing authoritative oracle via the canonical serving query model...`);

  const t0 = Date.now();
  type FeedItem = Awaited<ReturnType<typeof repos.canonicalServing.getFeed>>["items"][number];
  const opportunities: FeedItem[] = [];
  let cursor: string | null = null;
  do {
    const page = await repos.canonicalServing.getFeed(scope, cursor, undefined, 100);
    opportunities.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[GoldenDataset] Materialized ${opportunities.length} opportunities in ${elapsedSec}s`);

  const records: GoldenOpportunityRecord[] = [];
  const engineVerdicts: Record<string, number> = {};
  const effectiveDecisions: Record<string, number> = {};
  const populationTiers: Record<number, number> = {};
  const categories: Record<string, number> = {};

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const eff = opp.effectiveDecision;
    const tier = opp.populationTier;
    const verdict = opp.engineVerdict;
    const score = opp.qualityScore;
    const isVetoed = opp.vetoed;
    const uAction = opp.userAction;
    const cats = opp.categoryIds;

    engineVerdicts[verdict || "UNMATERIALIZED"] = (engineVerdicts[verdict || "UNMATERIALIZED"] || 0) + 1;
    effectiveDecisions[eff] = (effectiveDecisions[eff] || 0) + 1;
    populationTiers[tier] = (populationTiers[tier] || 0) + 1;
    for (const c of cats) {
      categories[c] = (categories[c] || 0) + 1;
    }

    records.push({
      jobHash: opp.jobHash,
      role: opp.role,
      company: opp.company,
      location: opp.location,
      scrapedFrom: opp.scrapedFrom,
      postedAt: opp.postedAt,
      applyUrl: opp.applyUrl,
      evaluationState: opp.evaluationState,
      engineVerdict: verdict,
      qualityScore: score,
      vetoed: isVetoed,
      userAction: uAction,
      effectiveDecision: eff,
      populationTier: tier,
      categoryIds: cats,
      rankingPosition: i,
    });
  }

  const orderHash = crypto
    .createHash("sha256")
    .update(records.map((r) => r.jobHash).join(","))
    .digest("hex");

  const manifest: GoldenDatasetManifest = {
    contextFingerprint: activeContext.contextFingerprint,
    searchPlanId: activeContext.searchPlanId,
    userId: scope.personId,
    tenantId: scope.tenantId,
    datasetTimestamp: new Date().toISOString(),
    sourceImplementationVersion: "v4.3-canonical-serving-oracle",
    totalCount: records.length,
    sha256OrderFingerprint: orderHash,
    distributions: {
      engineVerdicts,
      effectiveDecisions,
      populationTiers,
      categories,
    },
    records,
  };

  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  const outputPath = path.join(fixturesDir, "serving_golden_dataset.json");
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[GoldenDataset] Successfully written to ${outputPath}`);
  console.log(`[GoldenDataset] Order SHA-256: ${orderHash}`);
  console.log(`[GoldenDataset] Distributions:`, manifest.distributions);

  return manifest;
}

if (process.argv[1]?.includes("generate-golden-dataset")) {
  generateGoldenDataset(process.argv[2], process.argv[3]).catch(console.error);
}
