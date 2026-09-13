/**
 * run-batch04b-validation.ts
 *
 * Authoritative runner for GATE_1B_BATCH_04B_SOURCE_ID_GENERALIZATION.
 * Executes exactly 1 locked provider call per document across 11 documents
 * (8 scored role JDs, 2 scored candidate documents, 1 development control).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  buildRolePromptWithSourceUnits,
  buildCandidatePromptWithSourceUnits,
  getRoleJsonSchemaForVertex,
  getCandidateJsonSchemaForVertex,
  resolveRoleResponseBySourceId,
  resolveCandidateResponseBySourceId,
  SOURCE_ID_HARNESS_VERSION,
} from "../../src/lib/intelligence/extraction/SourceIdExtractionHarness";
import { SEGMENTATION_VERSION } from "../../src/lib/intelligence/extraction/MechanicalSourceSegmenter";

const root = process.cwd();
const runDir = path.resolve(root, "audit-reports/gate1b-batch04b/runs/RUN_01");
const rawDir = path.resolve(runDir, "raw");
const resolvedDir = path.resolve(runDir, "resolved");

fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(resolvedDir, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.resolve(root, "audit-reports/gate1b-batch04b/manifests/population-manifest.json"), "utf8"));
const populationRaw = JSON.parse(fs.readFileSync(path.resolve(root, "audit-reports/gate1b-batch04b/fixtures/population-raw.json"), "utf8"));
const segmentedPop = JSON.parse(fs.readFileSync(path.resolve(root, "audit-reports/gate1b-batch04b/manifests/segmented-population-v1.json"), "utf8"));
const referenceTruth = JSON.parse(fs.readFileSync(path.resolve(root, "audit-reports/gate1b-batch04b/fixtures/reference-truth.json"), "utf8"));

const sha = (x: string | Buffer) => crypto.createHash("sha256").update(x).digest("hex");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getAdcToken(): Promise<string> {
  const paths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.platform === "win32" ? path.join(process.env.APPDATA ?? "", "gcloud", "application_default_credentials.json") : path.join(process.env.HOME ?? "", ".config", "gcloud", "application_default_credentials.json"),
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "gcloud", "application_default_credentials.json") : "",
  ].filter((c): c is string => Boolean(c));

  for (const candidate of paths) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const cred = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (cred.client_id && cred.client_secret && cred.refresh_token) {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...cred, grant_type: "refresh_token" }),
        });
        const payload = (await res.json()) as { access_token?: string };
        if (res.ok && payload.access_token) return payload.access_token;
      }
    } catch {
      // Fall through to CLI
    }
  }

  const executable = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  return execFileSync(executable, ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function callVertexGemini(params: {
  readonly projectId: string;
  readonly location: string;
  readonly model: string;
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
  readonly token: string;
}): Promise<{
  readonly status: number;
  readonly rawText: string;
  readonly parsedResponse?: any;
  readonly usage?: any;
  readonly latencyMs: number;
}> {
  const endpoint = `https://${params.location}-aiplatform.googleapis.com/v1/projects/${params.projectId}/locations/${params.location}/publishers/google/models/${encodeURIComponent(params.model)}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: params.prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: params.schema,
      temperature: 0,
      topP: 1,
    },
  };

  const start = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Math.round(performance.now() - start);
  const rawText = await response.text();

  if (!response.ok) {
    return {
      status: response.status,
      rawText,
      latencyMs,
    };
  }

  const parsed = JSON.parse(rawText);
  return {
    status: response.status,
    rawText,
    parsedResponse: parsed,
    usage: parsed.usageMetadata,
    latencyMs,
  };
}

async function run() {
  console.log("=============================================================");
  console.log("Starting GATE_1B_BATCH_04B_SOURCE_ID_GENERALIZATION Run");
  console.log(`Model: gemini-2.5-flash | Default Dynamic Thinking | Temp: 0 | TopP: 1`);
  console.log(`Harness: ${SOURCE_ID_HARNESS_VERSION}`);
  console.log(`Segmentation: ${SEGMENTATION_VERSION}`);
  console.log("=============================================================");

  const token = await getAdcToken();
  const projectId = "project-423841fb-74e8-430a-84a";
  const location = "us-central1";
  const model = "gemini-2.5-flash";

  const runResults = [];

  for (let i = 0; i < populationRaw.length; i++) {
    const doc = populationRaw[i];
    const segDoc = segmentedPop.documents.find((d: any) => d.id === doc.id);
    if (!segDoc) throw new Error(`Missing segmented doc for ${doc.id}`);

    // Verify source integrity
    if (sha(doc.text) !== doc.sha256) {
      throw new Error(`Source hash mismatch for ${doc.id}`);
    }

    console.log(`\n[${i + 1}/${populationRaw.length}] Executing ${doc.id} (${doc.partition}, ${segDoc.units.length} units)...`);

    const manifestDoc = manifest.documents.find((m: any) => m.id === doc.id);
    let prompt: string;
    let schema: Record<string, unknown>;

    if (doc.partition === "CANDIDATE_DOCUMENT") {
      prompt = buildCandidatePromptWithSourceUnits({
        documentId: doc.id,
        units: segDoc.units,
      });
      schema = getCandidateJsonSchemaForVertex(segDoc.units);
    } else {
      prompt = buildRolePromptWithSourceUnits({
        title: manifestDoc?.title ?? "Executive Role",
        company: manifestDoc?.company ?? "Enterprise Company",
        units: segDoc.units,
      });
      schema = getRoleJsonSchemaForVertex(segDoc.units);
    }

    // Call Vertex Gemini
    const callResult = await callVertexGemini({
      projectId,
      location,
      model,
      prompt,
      schema,
      token,
    });

    console.log(`  -> HTTP ${callResult.status} in ${callResult.latencyMs}ms. Usage: ${JSON.stringify(callResult.usage ?? {})}`);

    // Save raw response
    fs.writeFileSync(
      path.resolve(rawDir, `${doc.id}.json`),
      JSON.stringify(callResult, null, 2),
      "utf8"
    );

    if (callResult.status !== 200) {
      console.error(`  ERROR: Vertex call failed for ${doc.id}: ${callResult.rawText}`);
      runResults.push({
        id: doc.id,
        partition: doc.partition,
        scored: doc.scored,
        status: "FAILED_TRANSPORT",
        httpStatus: callResult.status,
        error: callResult.rawText,
      });
      continue;
    }

    const outputText = callResult.parsedResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) {
      console.error(`  ERROR: No text candidate returned for ${doc.id}`);
      runResults.push({
        id: doc.id,
        partition: doc.partition,
        scored: doc.scored,
        status: "EMPTY_CANDIDATE",
      });
      continue;
    }

    // Resolve via harness
    let resolution: any;
    if (doc.partition === "CANDIDATE_DOCUMENT") {
      resolution = resolveCandidateResponseBySourceId({
        responseText: outputText,
        sourceText: doc.text,
        sourceDocumentId: doc.id,
        units: segDoc.units,
      });
    } else {
      resolution = resolveRoleResponseBySourceId({
        responseText: outputText,
        sourceText: doc.text,
        canonicalJobId: doc.id,
        caseId: doc.caseId ?? doc.id,
        units: segDoc.units,
      });
    }

    console.log(`  -> Envelope valid: ${resolution.envelopeValid}`);
    console.log(`  -> Proposals: ${resolution.parsedProposals}, Valid SpanIDs: ${resolution.validSpanIdCount}, Invalid: ${resolution.invalidSpanIds.length}`);
    console.log(`  -> Verification error: ${resolution.verificationError ?? "NONE (PASS)"}`);

    // Save resolved output
    fs.writeFileSync(
      path.resolve(resolvedDir, `${doc.id}.json`),
      JSON.stringify(resolution, null, 2),
      "utf8"
    );

    runResults.push({
      id: doc.id,
      partition: doc.partition,
      scored: doc.scored,
      status: resolution.envelopeValid && resolution.verificationError === null ? "SUCCESS" : "VERIFICATION_FAILURE",
      parsedProposals: resolution.parsedProposals,
      validSpanIdCount: resolution.validSpanIdCount,
      invalidSpanIds: resolution.invalidSpanIds,
      verificationError: resolution.verificationError,
      latencyMs: callResult.latencyMs,
      usage: callResult.usage,
    });

    // Polite delay between calls
    if (i < populationRaw.length - 1) {
      await sleep(2500);
    }
  }

  // Save overall run manifest
  const summaryManifest = {
    runId: "RUN_01",
    timestamp: new Date().toISOString(),
    harnessVersion: SOURCE_ID_HARNESS_VERSION,
    segmentationVersion: SEGMENTATION_VERSION,
    model,
    projectId,
    location,
    totalDocuments: runResults.length,
    successCount: runResults.filter(r => r.status === "SUCCESS").length,
    results: runResults,
  };

  fs.writeFileSync(
    path.resolve(runDir, "run-manifest.json"),
    JSON.stringify(summaryManifest, null, 2),
    "utf8"
  );

  console.log("\n=============================================================");
  console.log(`Run complete! ${summaryManifest.successCount}/${summaryManifest.totalDocuments} successful.`);
  console.log(`Artifacts saved in ${runDir}`);
  console.log("=============================================================");
}

run().catch(err => {
  console.error("Fatal run error:", err);
  process.exit(1);
});
