import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { migratedFixtureDatabase } from "../persistence/migrated-fixture";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { resolveBedrockCredential } from "../../src/lib/model/bedrock-credential-resolver";
import { processNextDocumentJob } from "../../scripts/process-document-jobs";
import { resumeOperationalWork } from "../../src/evaluation/operational-recovery";
import { reconcileProviderIncidents } from "../../src/admin/operations-recovery";
import {
  acquireProviderCapacity,
  releaseProviderCapacity,
} from "../../src/admin/operations-runtime";
import Database from "better-sqlite3";
import { TursoAdapter } from "../../src/data/database/turso";
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import type { WorkIdentity } from "../../src/admin/operations-contracts";

const databases: DatabaseAdapter[] = [];
const directories: string[] = [];
const text = "Led a 40-member team at Example Corporation.";
const facts = [
  {
    type: "LEADERSHIP",
    value: "Led a 40-member team",
    sourceSpan: text,
    confidence: 0.95,
    justification: "Exact candidate source",
  },
];
const identity: WorkIdentity = {
  pipeline: "documents",
  jobId: "job",
  tenantId: "tenant_A",
  personId: "person_A",
  documentId: "doc",
};
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const db of databases.splice(0)) await db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
async function fixture() {
  const db = await migratedFixtureDatabase();
  databases.push(db);
  await setupLineageTestFixture(db);
  await db.execute(
    "INSERT INTO candidate_documents(id,tenant_id,person_id,filename,storage_uri,mime_type,document_hash) VALUES('doc','tenant_A','person_A','cv.txt','fixture://cv','text/plain','hash')",
  );
  await db.execute(
    "INSERT INTO candidate_document_jobs(id,tenant_id,person_id,document_id,job_hash,payload_json) VALUES('job','tenant_A','person_A','doc','job-hash',?)",
    [
      JSON.stringify({
        filename: "cv.txt",
        mimeType: "text/plain",
        documentHash: "hash",
        documentText: text,
      }),
    ],
  );
  vi.stubEnv("BEDROCK_MANTLE_API_KEY", "a".repeat(43));
  vi.stubEnv("GROQ_API_KEY", "fixture-groq");
  return db;
}
function response(provider: "bedrock" | "groq") {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ facts }) } }],
      usage:
        provider === "bedrock"
          ? { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 }
          : undefined,
    }),
  );
}

describe("document provider operations", () => {
  it.each(["sqlite", "libsql"])(
    "preserves populated 089 rows and enforces exclusive identities with %s",
    async (adapter) => {
      const directory = mkdtempSync(join(tmpdir(), "radar-document-migration-"));
      directories.push(directory);
      const migrationDirectory = join(directory, "migrations");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(migrationDirectory);
      const catalog = resolve("src/data/sqlite/migrations");
      for (const file of readdirSync(catalog).filter(
        (file) => file.endsWith(".sql") && file < "090",
      ))
        copyFileSync(join(catalog, file), join(migrationDirectory, file));
      const db =
        adapter === "sqlite"
          ? new SqliteAdapter(new Database(":memory:"))
          : new TursoAdapter("file::memory:", "fixture");
      databases.push(db);
      await runMigrations(db, migrationDirectory, { verifyRequiredSchema: false });
      await db.execute(
        "INSERT INTO admin_bench_runs(id,scope,revision_id,active_revision_id,status,token_cap,created_at,created_by) VALUES('bench','platform','engine-baseline-v1','engine-baseline-v1','queued',100,1,'fixture')",
      );
      await db.execute(`INSERT INTO model_invocations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,request_fingerprint,started_at,status,purpose,bench_run_id,pursuit_id,pursuit_preparation_job_id)
      VALUES('old','tenant','person','canonical','version','context','pursuit','stage',1,'bedrock','model','v1','config','request',1,'completed','BENCH','bench','pursuit','preparation')`);
      await db.execute(
        "INSERT INTO provider_incidents(id,correlation_key,provider,connection_id,generation,failure_class,severity,state,first_seen,last_seen,error_code) VALUES('incident','key','bedrock','bedrock:host',0,'credential','High','open',1,1,'MODEL_CREDENTIAL')",
      );
      await db.execute(
        "INSERT INTO provider_incident_jobs(incident_id,pipeline,job_id,tenant_id,person_id,canonical_job_id,opportunity_version,context_fingerprint,accounted_reason) VALUES('incident','pursuit','job','tenant','person','canonical','version','context','COMPLETED')",
      );
      const invocation = await db.one("SELECT * FROM model_invocations WHERE id='old'");
      const linked = await db.one(
        "SELECT * FROM provider_incident_jobs WHERE incident_id='incident'",
      );
      copyFileSync(
        join(catalog, "090_operations_document_identity.sql"),
        join(migrationDirectory, "090_operations_document_identity.sql"),
      );
      await runMigrations(db, migrationDirectory);
      expect(await db.one("SELECT * FROM model_invocations WHERE id='old'")).toMatchObject(
        invocation!,
      );
      expect(
        await db.one("SELECT * FROM provider_incident_jobs WHERE incident_id='incident'"),
      ).toMatchObject(linked!);
      await expect(
        db.execute(
          "INSERT INTO provider_incident_jobs(incident_id,pipeline,job_id,tenant_id,person_id,document_id,canonical_job_id) VALUES('incident','documents','invalid','tenant','person','doc','canonical')",
        ),
      ).rejects.toThrow(/CHECK/);
      await expect(
        db.execute(
          "INSERT INTO provider_incident_jobs(incident_id,pipeline,job_id,tenant_id,person_id) VALUES('incident','documents','missing','tenant','person')",
        ),
      ).rejects.toThrow(/CHECK/);
      await expect(
        db.execute(
          "UPDATE model_invocations SET pipeline='documents',document_id='doc',document_job_id='doc-job' WHERE id='old'",
        ),
      ).rejects.toThrow(/CHECK/);
      expect(await db.many("PRAGMA foreign_key_check")).toEqual([]);
      expect(await db.one("PRAGMA foreign_keys")).toMatchObject({ foreign_keys: 1 });
    },
  );

  it("resolves labelled files and clipped padding without mutating the environment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "radar-bedrock-resolver-"));
    directories.push(directory);
    const filename = join(directory, "credential.key");
    vi.stubEnv("BEDROCK_MANTLE_API_KEY", "");
    vi.stubEnv("BEDROCK_MANTLE_KEY_FILE", filename);
    writeFileSync(filename, `Long term API key\n${"a".repeat(43)}\n`);
    const before = { ...process.env };
    expect(await resolveBedrockCredential()).toMatchObject({
      key: "a".repeat(43) + "=",
      source: "host",
      generation: 0,
    });
    expect(process.env).toEqual(before);
    writeFileSync(filename, "b".repeat(43));
    expect((await resolveBedrockCredential()).key).toBe("b".repeat(43) + "=");
  });

  it("completes a Bedrock CV with document telemetry and exact source binding", async () => {
    const db = await fixture();
    const request = vi.fn(async () => response("bedrock"));
    vi.stubGlobal("fetch", request);
    expect(await processNextDocumentJob("worker", db)).toBe(true);
    expect(
      await db.one("SELECT status,lease_token FROM candidate_document_jobs WHERE id='job'"),
    ).toMatchObject({ status: "completed", lease_token: null });
    expect(
      await db.one(
        "SELECT pipeline,document_id,document_job_id,canonical_job_id,total_tokens FROM model_invocations",
      ),
    ).toMatchObject({
      pipeline: "documents",
      document_id: "doc",
      document_job_id: "job",
      canonical_job_id: null,
      total_tokens: 32,
    });
    expect(
      await db.one(
        "SELECT document_id,evidence_graph_id FROM profile_projection_source_bindings WHERE tenant_id='tenant_A' AND person_id='person_A'",
      ),
    ).toMatchObject({ document_id: "doc" });
    expect(await db.one("SELECT id FROM provider_incidents")).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429, 503, "timeout"])(
    "records %s, falls back to Groq and accounts completed work before recovery",
    async (failure) => {
      const db = await fixture();
      const request = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("groq")) return response("groq");
        if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
        return new Response("", { status: failure });
      });
      vi.stubGlobal("fetch", request);
      await processNextDocumentJob("worker", db);
      expect(
        await db.one("SELECT status FROM candidate_document_jobs WHERE id='job'"),
      ).toMatchObject({ status: "completed" });
      const incident = await db.one<{ id: string }>(
        "SELECT id FROM provider_incidents WHERE connection_id='bedrock:host'",
      );
      expect(incident).not.toBeNull();
      expect(
        await db.one("SELECT document_id,canonical_job_id FROM provider_incident_jobs"),
      ).toMatchObject({ document_id: "doc", canonical_job_id: null });
      expect(
        await db.one("SELECT model FROM evidence_graphs WHERE document_id='doc'"),
      ).toMatchObject({ model: "llama-3.3-70b-versatile" });
      await reconcileProviderIncidents(db);
      expect(await db.one("SELECT accounted_reason FROM provider_incident_jobs")).toMatchObject({
        accounted_reason: "COMPLETED",
      });
      expect(
        (await db.one<{ state: string }>("SELECT state FROM provider_incidents WHERE id=?", [
          incident!.id,
        ]))!.state,
      ).not.toBe("resolved");
    },
  );

  it("associates a cooldown without issuing another Bedrock request", async () => {
    const db = await fixture();
    const request = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("groq") ? response("groq") : new Response("", { status: 401 }),
    );
    vi.stubGlobal("fetch", request);
    await processNextDocumentJob("worker", db);
    await db.execute(
      "INSERT INTO candidate_documents(id,tenant_id,person_id,filename,storage_uri,mime_type,document_hash) VALUES('doc2','tenant_A','person_A','cv.txt','fixture://cv2','text/plain','hash2')",
    );
    await db.execute(
      "INSERT INTO candidate_document_jobs(id,tenant_id,person_id,document_id,job_hash,payload_json) VALUES('job2','tenant_A','person_A','doc2','hash2',?)",
      [
        JSON.stringify({
          filename: "cv.txt",
          mimeType: "text/plain",
          documentHash: "hash2",
          documentText: text + " Extra source.",
        }),
      ],
    );
    await processNextDocumentJob("worker", db);
    expect(request.mock.calls.filter(([url]) => !String(url).includes("groq"))).toHaveLength(1);
    expect(
      await db.one("SELECT document_id FROM provider_incident_jobs WHERE job_id='job2'"),
    ).toMatchObject({ document_id: "doc2" });
  });

  it("falls back under local capacity pressure without creating a provider incident", async () => {
    const db = await fixture();
    const leases: string[] = [];
    for (let i = 0; i < 4; i++)
      leases.push(await acquireProviderCapacity(db, "bedrock:host", "busy", 4));
    const request = vi.fn(async () => response("groq"));
    vi.stubGlobal("fetch", request);
    await processNextDocumentJob("worker", db);
    expect(await db.one("SELECT id FROM provider_incidents")).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain("groq");
    for (const lease of leases) await releaseProviderCapacity(db, lease, "busy");
  });

  it("respects configured retries when both providers fail", async () => {
    const db = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await db.execute("UPDATE candidate_document_jobs SET max_attempts=2 WHERE id='job'");
    await processNextDocumentJob("worker", db);
    expect(
      await db.one("SELECT status,attempts FROM candidate_document_jobs WHERE id='job'"),
    ).toMatchObject({ status: "pending", attempts: 1 });
    await db.execute(
      "UPDATE candidate_document_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE id='job'",
    );
    await processNextDocumentJob("worker", db);
    expect(
      await db.one("SELECT status,attempts FROM candidate_document_jobs WHERE id='job'"),
    ).toMatchObject({ status: "dead_letter", attempts: 2 });
  });

  it("uses grounded Groq output after Bedrock grounding rejection without an incident", async () => {
    const db = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes("groq")
          ? response("groq")
          : new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: JSON.stringify({
                        facts: [{ ...facts[0], sourceSpan: "Invented achievement" }],
                      }),
                    },
                  },
                ],
              }),
            ),
      ),
    );
    await processNextDocumentJob("worker", db);
    expect(await db.one("SELECT model FROM evidence_graphs WHERE document_id='doc'")).toMatchObject(
      { model: "llama-3.3-70b-versatile" },
    );
    expect(await db.one("SELECT id FROM provider_incidents")).toBeNull();
  });

  it("dead-letters at the configured limit when Groq is unavailable", async () => {
    const db = await fixture();
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await db.execute("UPDATE candidate_document_jobs SET max_attempts=1 WHERE id='job'");
    await processNextDocumentJob("worker", db);
    expect(
      await db.one("SELECT status,attempts FROM candidate_document_jobs WHERE id='job'"),
    ).toMatchObject({ status: "dead_letter", attempts: 1 });
    expect(await db.one("SELECT id FROM evidence_graphs WHERE document_id='doc'")).toBeNull();
  });

  it("does not publish evidence or a profile after losing the document lease", async () => {
    const db = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await db.execute(
          "UPDATE candidate_document_jobs SET lease_token='new-owner' WHERE id='job'",
        );
        return response("bedrock");
      }),
    );
    await expect(processNextDocumentJob("worker", db)).rejects.toThrow("DOCUMENT_JOB_LEASE_LOST");
    expect(await db.one("SELECT id FROM evidence_graphs WHERE document_id='doc'")).toBeNull();
    expect(await db.one("SELECT document_id FROM profile_projection_source_bindings")).toBeNull();
  });

  it("resumes only pending work with exact ownership and an absent or expired lease", async () => {
    const db = await fixture();
    expect(await resumeOperationalWork(db, { ...identity, personId: "person_B" })).toMatchObject({
      outcome: "blocked",
      reason: "IDENTITY_CHANGED",
    });
    await db.execute(
      "UPDATE candidate_document_jobs SET lease_token='lease',locked_at=CURRENT_TIMESTAMP WHERE id='job'",
    );
    expect(await resumeOperationalWork(db, identity)).toMatchObject({
      outcome: "blocked",
      reason: "CURRENTLY_LEASED",
    });
    await db.execute(
      "UPDATE candidate_document_jobs SET locked_at=datetime('now','-301 seconds'),next_attempt_at=datetime('now','+1 day') WHERE id='job'",
    );
    expect(await resumeOperationalWork(db, identity)).toMatchObject({ outcome: "resumed" });
    expect(
      await db.one(
        "SELECT lease_token,next_attempt_at<=CURRENT_TIMESTAMP due FROM candidate_document_jobs WHERE id='job'",
      ),
    ).toMatchObject({ lease_token: null, due: 1 });
    await db.execute("UPDATE candidate_document_jobs SET status='dead_letter' WHERE id='job'");
    expect(await resumeOperationalWork(db, identity)).toMatchObject({
      outcome: "blocked",
      reason: "DOMAIN_RETRY_REQUIRED",
    });
  });
});
