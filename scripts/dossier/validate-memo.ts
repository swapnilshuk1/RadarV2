/** Bounded real memo proof on a private SQLite copy. Never opens a remote DB. */
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { ProductionStagedDossierService } from "../../src/lib/intelligence/staged/ProductionStagedDossierService";
import { StagedServingPublisher } from "../../src/lib/intelligence/staged/StagedServingPublisher";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import { createBedrockGlmResearchModel } from "../../src/lib/model/bedrock-glm-research-model";
import { createGeminiFactualReviewModel } from "../../src/lib/model/gemini-factual-review-model";
import { DOSSIER_COMPOSITION_RECIPE } from "../../src/dossier/factual-review-integrity";
import { checkpointHash } from "../../src/lib/intelligence/staged/DurableDossierModel";
import type { ReasoningModel } from "../../src/dossier/contracts";
import { ModelProviderUnavailableError } from "../../src/lib/model/provider-unavailable";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = arg("source-db"),
  output = arg("output"),
  jobs = arg("jobs")?.split(",");
if (!source || !output || !jobs?.length || jobs.length > 3 || !process.argv.includes("--execute"))
  throw new Error("Require --source-db, --output, --jobs (at most three) and --execute");
const root = path.resolve(output),
  allowed = path.resolve(".radar") + path.sep;
if (!root.startsWith(allowed) || root === path.resolve(source))
  throw new Error("Output must be a distinct directory inside .radar");
if (arg("env-file")) loadEnvFile(arg("env-file")!);
process.env.RADAR_ENV = "test";
process.env.RADAR_USE_TURSO = "false";
process.env.GCP_PROJECT_ID = arg("project") || process.env.GCP_PROJECT_ID;
if (arg("bedrock-key-file")) process.env.BEDROCK_API_KEY_FILE = arg("bedrock-key-file");
fs.mkdirSync(root, { recursive: true });
const local = path.join(root, "local.sqlite");
if (!fs.existsSync(local)) {
  const original = new Database(path.resolve(source), { readonly: true, fileMustExist: true });
  await original.backup(local);
  original.close();
}
const native = new Database(local),
  db = new SqliteAdapter(native);
native.exec(
  fs.readFileSync("src/data/sqlite/migrations/051_dossier_model_checkpoints.sql", "utf8"),
);
const digest = () =>
  checkpointHash(
    native
      .prepare(
        "SELECT * FROM staged_evaluations ORDER BY canonical_job_id,evaluation_context_fingerprint",
      )
      .all(),
  );
const baseline = digest();
const decisions = checkpointHash(
  native
    .prepare("SELECT * FROM canonical_decisions ORDER BY tenant_id,person_id,canonical_job_id")
    .all(),
);
const composer = createBedrockGlmResearchModel(),
  reviewer = createGeminiFactualReviewModel();
let serial = Date.now();
const record = (model: ReasoningModel) => {
  const generate = model.generate.bind(model);
  model.generate = async (instruction, input, schema) => {
    const id = ++serial,
      start = Date.now();
    let result: unknown;
    try {
      result = await generate(instruction, input, schema);
    } catch (error) {
      if (error instanceof ModelProviderUnavailableError) {
        const failure = {
          at: new Date().toISOString(),
          model: `${model.id}/${model.version}`,
          httpStatus: error.httpStatus,
          retryAfterMs: error.retryAfterMs,
          elapsedMs: Date.now() - start,
        };
        fs.writeFileSync(
          path.join(root, `provider-failure-${id}.json`),
          JSON.stringify(failure, null, 2),
          { flag: "wx" },
        );
        console.log(JSON.stringify(failure));
      }
      throw error;
    }
    fs.writeFileSync(
      path.join(root, `call-${id}.json`),
      JSON.stringify(
        {
          model: `${model.id}/${model.version}`,
          instruction,
          input,
          result,
          elapsedMs: Date.now() - start,
          usage: (model as any).lastUsage,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    console.log(JSON.stringify({ model: model.version, elapsedMs: Date.now() - start, call: id }));
    return result;
  };
};
record(composer);
record(reviewer);
try {
  const probeFile = path.join(root, "probe.json");
  if (!fs.existsSync(probeFile)) {
    const schema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    };
    for (const model of [composer, reviewer]) {
      const response = (await model.generate(
        'Capability probe. Return {"ok":true}.',
        {},
        schema,
      )) as { ok?: boolean };
      if (response.ok !== true) throw new Error("CAPABILITY_PROBE_FAILED");
    }
    fs.writeFileSync(
      probeFile,
      JSON.stringify({
        recipe: DOSSIER_COMPOSITION_RECIPE,
        at: new Date().toISOString(),
        passed: true,
      }),
      { flag: "wx" },
    );
  }
  for (const job of jobs) {
    const row = native
      .prepare(
        "SELECT * FROM staged_evaluations WHERE canonical_job_id=? AND evaluation_state='COMPLETED' ORDER BY evaluated_at DESC LIMIT 1",
      )
      .get(job) as any;
    if (!row || !["PURSUE", "CONSIDER"].includes(row.decision))
      throw new Error("REVIEW_JOB_MUST_BE_PURSUIT_OR_CONSIDER");
    const identity = {
      tenantId: row.tenant_id,
      personId: row.person_id,
      canonicalJobId: job,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: row.evaluation_context_fingerprint,
      profileVersion: row.profile_version,
    };
    const dossier = await new ProductionStagedDossierService(db, composer, reviewer).compose(
      identity,
      (stage) => console.log(JSON.stringify({ job, stage })),
    );
    await new StagedServingPublisher(db).publish(identity);
    // Only this disposable copy gets a serving pointer for DTO/render proof.
    native
      .prepare(
        "UPDATE active_evaluation_contexts SET context_fingerprint=? WHERE tenant_id=? AND person_id=?",
      )
      .run(row.evaluation_context_fingerprint, row.tenant_id, row.person_id);
    const { scope } = await resolveServingScope(row.person_id, row.tenant_id, db);
    const sourceJob = (
      native.prepare("SELECT source_job_id FROM canonical_opportunities WHERE id=?").get(job) as any
    ).source_job_id;
    const dto = await new SqliteOpportunityQueries(db).getDossier(scope, sourceJob);
    if (!dto || !("richDossier" in dto) || !dto.richDossier) throw new Error("MEMO_DTO_NOT_SERVED");
    fs.writeFileSync(path.join(root, `${job}-dossier.json`), JSON.stringify(dossier, null, 2));
    fs.writeFileSync(path.join(root, `${job}-dto.json`), JSON.stringify(dto, null, 2));
    console.log(
      JSON.stringify({ job, status: "memo_persisted_and_served", verdict: row.decision }),
    );
  }
  if (
    baseline !== digest() ||
    decisions !==
      checkpointHash(
        native
          .prepare(
            "SELECT * FROM canonical_decisions ORDER BY tenant_id,person_id,canonical_job_id",
          )
          .all(),
      )
  )
    throw new Error("IMMUTABLE_EVALUATION_OR_USER_DECISION_CHANGED");
  fs.writeFileSync(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        passed: true,
        localOnly: true,
        recipe: DOSSIER_COMPOSITION_RECIPE,
        jobs,
        evaluationsUnchanged: true,
        userDecisionsUnchanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  native.close();
}
