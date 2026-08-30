import { getDatabaseAdapter } from "../../src/data/database/index";
import { resolveScope } from "../../src/lib/intelligence/opportunity-service";
import { getRepositories } from "../../src/data/sqlite/provider";
import { classifyOpportunityCategories } from "../../src/lib/domain/category_taxonomy";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface GoldenOpportunityRecord {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  scrapedFrom: string;
  postedAt: string | null;
  applyUrl: string | null;
  evaluationState: string;
  engineVerdict: string | null;
  qualityScore: number | null;
  vetoed: boolean;
  userAction: string;
  effectiveDecision: string;
  populationTier: number;
  categoryAssignments: string[];
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

export async function generateGoldenDataset(targetUserId?: string): Promise<GoldenDatasetManifest> {
  const db = getDatabaseAdapter();
  const repos = getRepositories();

  // Dynamic discovery of canonical user if not explicitly passed
  let userId = targetUserId || process.env.RADAR_USER_ID;
  if (!userId) {
    const defaultUser = await db.one<{ id: string }>(
      `SELECT id FROM people WHERE email_verified = 1 ORDER BY created_at ASC LIMIT 1`
    );
    if (!defaultUser) {
      throw new Error("No verified user found in database to establish canonical scope.");
    }
    userId = defaultUser.id;
  }

  console.log(`[GoldenDataset] Resolving scope for canonical user: ${userId}`);
  const scope = await resolveScope(userId);
  const activeContext = await repos.canonicalServing.getActiveContext(scope);

  if (!activeContext) {
    throw new Error(`No active context found for scope: tenant=${scope.tenantId}, person=${scope.personId}`);
  }

  console.log(`[GoldenDataset] Active Search Plan: ${activeContext.searchPlanId}`);
  console.log(`[GoldenDataset] Context Fingerprint: ${activeContext.contextFingerprint}`);
  console.log(`[GoldenDataset] Materializing authoritative oracle via OpportunityService / CanonicalServingStore...`);

  const t0 = Date.now();
  const opportunities = await repos.canonicalServing.listOpportunities(scope);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[GoldenDataset] Materialized ${opportunities.length} opportunities in ${elapsedSec}s`);

  const records: GoldenOpportunityRecord[] = [];
  const engineVerdicts: Record<string, number> = {};
  const effectiveDecisions: Record<string, number> = {};
  const populationTiers: Record<number, number> = {};
  const categories: Record<string, number> = {};

  const POPULATION_TIER_MAP: Record<string, number> = {
    ENGINE_PURSUIT: 0,
    USER_CONFIRMED: 0,
    PREFERENCE_OVERRIDE: 1,
    VETO_OVERRIDE: 2,
    ENGINE_CONSIDER: 3,
    NOT_EVALUABLE: 4,
    USER_PASSED: 5,
    ENGINE_PASS: 5,
  };

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i] as any;
    const eff = opp.effectiveDecision || "NONE";
    const tier = opp.populationTier ?? POPULATION_TIER_MAP[eff] ?? 5;
    const verdict = opp.engineRecommendation?.engineVerdict || null;
    const score = opp.engineRecommendation?.qualityScore ?? opp.recommendationResult?.score ?? null;
    const isVetoed = Boolean(opp.engineRecommendation?.vetoed);
    const uAction = opp.userDecision?.userAction || "NONE";
    const cats = classifyOpportunityCategories(opp);

    engineVerdicts[verdict || "UNMATERIALIZED"] = (engineVerdicts[verdict || "UNMATERIALIZED"] || 0) + 1;
    effectiveDecisions[eff] = (effectiveDecisions[eff] || 0) + 1;
    populationTiers[tier] = (populationTiers[tier] || 0) + 1;
    for (const c of cats) {
      categories[c] = (categories[c] || 0) + 1;
    }

    records.push({
      jobHash: opp.jobHash,
      role: opp.role || "Executive Opportunity",
      company: opp.company || "Company not available",
      location: opp.location || "Unknown",
      scrapedFrom: opp.scrapedFrom || "LinkedIn",
      postedAt: opp.postedAt || null,
      applyUrl: opp.applyUrl || null,
      evaluationState: opp.evaluationState || "UNKNOWN",
      engineVerdict: verdict,
      qualityScore: score,
      vetoed: isVetoed,
      userAction: uAction,
      effectiveDecision: eff,
      populationTier: tier,
      categoryAssignments: cats,
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
    sourceImplementationVersion: "v4.1-canonical-serving-oracle",
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
  generateGoldenDataset().catch(console.error);
}
