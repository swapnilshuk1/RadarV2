import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";
import { computeEvaluationContextFingerprint } from "../../src/lib/domain/evaluation_fingerprint";

const currentContext = computeEvaluationContextFingerprint({
  tenantId: "tenant_A",
  personId: "person_A",
  searchPlanSnapshotId: "sps_A",
  ontologyVersion: "v1",
  ontologyFingerprint: "hash_ontology",
  policyVersion: "staged-v8",
  profileVersion: "profile",
});

describe("current staged-v8 navigation and shortlist contracts", () => {
  let db: SqliteAdapter;
  let queries: SqliteOpportunityQueries;
  let scope: AuthorizedPersonScope;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    await db.execute(`INSERT OR IGNORE INTO users (id,email) VALUES ('person_A','a@a.com'),('person_B','b@b.com')`);
    await db.execute(
      `INSERT OR IGNORE INTO memberships (user_id,tenant_id,role,permissions,status)
       VALUES ('person_A','tenant_A','admin','["*"]','active')`,
    );
    await db.execute(
      `INSERT OR IGNORE INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version)
       VALUES(?,?,?,?,?,?,?,?)`,
      [currentContext,"tenant_A","person_A","sps_A","v1","hash_ontology","staged-v8","profile"],
    );
    await db.execute(
      `INSERT OR IGNORE INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id)
       VALUES(?,?,?,?)`,
      [currentContext,"tenant_A","person_A","plan_A"],
    );
    await db.execute(
      `INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by)
       VALUES('tenant_A','person_A','plan_A',?,'test')
       ON CONFLICT(tenant_id,person_id,search_plan_id) DO UPDATE SET context_fingerprint=excluded.context_fingerprint`,
      [currentContext],
    );
    queries = new SqliteOpportunityQueries(db);
    scope = (await resolveServingScope("person_A","tenant_A",db)).scope;
  });

  async function seedEvaluated(input: {
    id: string;
    title: string;
    verdict: "PURSUE" | "CONSIDER" | "PASS";
    action?: "PURSUE" | "CONSIDER" | "PASS";
    categoryIds?: string[];
  }) {
    const canonicalJobId = `opp_${input.id}`;
    const version = `ver_${input.id}`;
    const fp = `fp_${input.id}`;
    await db.execute(
      `INSERT INTO canonical_opportunities(id,source_job_id,company_name,source,canonical_url)
       VALUES(?,?,?, 'LinkedIn', ?)`,
      [canonicalJobId,input.id,`Company ${input.id}`,`https://example.com/${input.id}`],
    );
    await db.execute(
      `INSERT INTO opportunity_versions(id,canonical_job_id,job_title,location,content_hash,raw_content,lifecycle_state,category_ids)
       VALUES(?,?,?,'Remote',?,'Current staged-v8 opportunity','ACTIVE',?)`,
      [version,canonicalJobId,input.title,`hash_${input.id}`,JSON.stringify(input.categoryIds ?? [])],
    );
    await db.execute(
      `INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision)
       VALUES('tenant_A','person_A','plan_A',?,?,'CANDIDATE')`,
      [canonicalJobId,version],
    );
    await db.execute(
      `INSERT INTO materialized_evaluations(
         id,tenant_id,person_id,canonical_job_id,opportunity_version,
         evaluation_context_fingerprint,evaluation_fingerprint,decision,quality_score,
         evaluation_state,vetoed,evaluation_json
       ) VALUES(?,?,?,?,?,?,?,?,NULL,'STAGED_EVALUATED',0,?)`,
      [
        `eval_${input.id}`,'tenant_A','person_A',canonicalJobId,version,currentContext,fp,input.verdict,
        JSON.stringify({
          schemaVersion: 'staged-serving-v1',
          evaluationFingerprint: fp,
          verdict: input.verdict,
          screeningViability: 'PLAUSIBLE',
        }),
      ],
    );
    if (input.action) {
      await db.execute(
        `INSERT INTO canonical_decisions(tenant_id,person_id,canonical_job_id,action,reviewed_fingerprint)
         VALUES('tenant_A','person_A',?,?,?)`,
        [canonicalJobId,input.action,fp],
      );
    }
  }

  it("computes deterministic prev/next within the current staged-v8 sequence", async () => {
    await seedEvaluated({ id:"alpha", title:"VP Growth", verdict:"PURSUE" });
    await seedEvaluated({ id:"beta", title:"Head of Growth", verdict:"CONSIDER" });
    const alpha = await queries.getNavigation(scope,"alpha");
    const beta = await queries.getNavigation(scope,"beta");
    expect(alpha).toMatchObject({ prevJobHash: undefined, nextJobHash: "beta" });
    expect(beta).toMatchObject({ prevJobHash: "alpha", nextJobHash: undefined });
  });

  it("respects decided and unreviewed filters without changing engine verdicts", async () => {
    await seedEvaluated({ id:"open", title:"VP Marketing", verdict:"PURSUE" });
    await seedEvaluated({ id:"decided", title:"VP Revenue", verdict:"CONSIDER", action:"PURSUE" });
    expect(await queries.getNavigation(scope,"open",{decisionFilter:"unreviewed"})).not.toBeNull();
    expect(await queries.getNavigation(scope,"decided",{decisionFilter:"unreviewed"})).toBeNull();
    expect(await queries.getNavigation(scope,"decided",{decisionFilter:"decided"})).not.toBeNull();
  });

  it("respects category filters on the same canonical sequence", async () => {
    await seedEvaluated({ id:"growth", title:"VP Growth", verdict:"PURSUE", categoryIds:["growth"] });
    await seedEvaluated({ id:"transform", title:"VP Transformation", verdict:"CONSIDER", categoryIds:["transformation"] });
    expect(await queries.getNavigation(scope,"growth",{categoryId:"growth"})).not.toBeNull();
    expect(await queries.getNavigation(scope,"transform",{categoryId:"growth"})).toBeNull();
  });

  it("returns null for non-existent and cross-tenant targets", async () => {
    await seedEvaluated({ id:"private", title:"VP Growth", verdict:"PURSUE" });
    expect(await queries.getNavigation(scope,"missing")).toBeNull();
    const otherScope = { ...scope, tenantId:"tenant_B" };
    expect(await queries.getNavigation(otherScope,"private")).toBeNull();
  });

  it("does not recompute advisory facts in shortlist presentation paths", () => {
    const routeSource = fs.readFileSync(path.resolve(process.cwd(),"src/routes/index.tsx"),"utf8");
    const inlineBriefSource = fs.readFileSync(path.resolve(process.cwd(),"src/components/radar/InlineBrief.tsx"),"utf8");
    for (const forbidden of ["BriefCompositionEngine","JobProjectionBuilder","PreviewCompositionEngine","inferExecutiveMandateArchetype","dossierPresentation"]) {
      expect(`${routeSource}\n${inlineBriefSource}`).not.toContain(forbidden);
    }
    expect(inlineBriefSource).toContain("dossier?.richDossier?.executiveThesis.text");
  });

  it("routes reviewed dossiers through DossierView and never through retired presentation surfaces", () => {
    const route = fs.readFileSync(path.resolve(process.cwd(),"src/routes/opportunity.$jobHash.tsx"),"utf8");
    expect(route).toContain("<DossierView");
    expect(route).not.toContain("<ReadingSurface");
    expect(route).not.toContain("<ExecutiveBriefingSurface");
    expect(route).not.toContain("dossierPresentation");
    expect(route).not.toContain("Fit index:");
  });
});
