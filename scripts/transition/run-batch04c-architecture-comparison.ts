/**
 * run-batch04c-architecture-comparison.ts
 *
 * Authoritative runner for RADAR Gate 1B Batch 04C:
 * RICH SEMANTIC PROPOSITION GENERALIZATION & ARCHITECTURE COMPARISON
 *
 * Executes:
 * 1. Architecture A: Deterministic V1 on all 21 role documents.
 * 2. Architecture B: Frozen direct closed-ontology Gemini on Holdout (8) + Adversarial (4)
 *    (reusing retained Batch 04B outputs for Partition R and DEV_CONTROL_01).
 * 3. Architecture C: Rich Grounded Semantic Propositions on all 21 role documents.
 * 4. Candidate Side-by-Side: CandidateProofExtractorV1 vs. Batch 04B Candidate Source-ID (N=2).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { RoleIntelligenceExtractorV1 } from "../../src/lib/intelligence/extraction/RoleIntelligenceExtractorV1";
import { CandidateProofExtractorV1 } from "../../src/lib/intelligence/extraction/CandidateProofExtractorV1";
import {
  buildRolePromptWithSourceUnits,
  getRoleJsonSchemaForVertex,
  resolveRoleResponseBySourceId
} from "../../src/lib/intelligence/extraction/SourceIdExtractionHarness";
import {
  buildRichPropositionPrompt,
  RICH_PROPOSITION_JSON_SCHEMA_VERTEX,
  projectPropositionsToCanonical,
  type GroundedSemanticProposition,
  type RichPropositionExtractionResponse
} from "../../src/lib/intelligence/extraction/RichSemanticPropositionContract";
import type { SourceUnit } from "../../src/lib/intelligence/extraction/MechanicalSourceSegmenter";

const root = process.cwd();
const batchDir = path.resolve(root, "audit-reports/gate1b-batch04c");
const runsDir = path.join(batchDir, "runs");
const archADir = path.join(runsDir, "arch_a_deterministic");
const archBDir = path.join(runsDir, "arch_b_direct_ontology");
const archCDir = path.join(runsDir, "arch_c_rich_semantic");
const candidateDir = path.join(runsDir, "candidate_comparison");

fs.mkdirSync(archADir, { recursive: true });
fs.mkdirSync(path.join(archBDir, "raw"), { recursive: true });
fs.mkdirSync(path.join(archBDir, "resolved"), { recursive: true });
fs.mkdirSync(path.join(archCDir, "raw"), { recursive: true });
fs.mkdirSync(path.join(archCDir, "resolved"), { recursive: true });
fs.mkdirSync(candidateDir, { recursive: true });

const popRaw = JSON.parse(fs.readFileSync(path.join(batchDir, "fixtures/population-raw.json"), "utf8"));
const segPop = JSON.parse(fs.readFileSync(path.join(batchDir, "manifests/segmented-population.json"), "utf8"));
const b04bRun1Dir = path.resolve(root, "audit-reports/gate1b-batch04b/runs/RUN_01");

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
    } catch {}
  }

  const executable = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  return execFileSync(executable, ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function callVertexGemini(promptText: string, schema: any, accessToken: string): Promise<any> {
  const projectId = "project-423841fb-74e8-430a-84a";
  const location = "us-central1";
  const model = "gemini-2.5-flash";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseJsonSchema: schema
    }
  };

  const startTime = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const durationMs = Date.now() - startTime;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex API returned ${res.status}: ${errText}`);
  }

  const responseJson = await res.json();
  const candidate = responseJson.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const usage = responseJson.usageMetadata ?? {};
  const textContent = candidate?.content?.parts?.[0]?.text ?? "";

  return {
    durationMs,
    finishReason,
    usage,
    textContent,
    rawResponse: responseJson
  };
}

async function run() {
  console.log("=== STARTING GATE 1B BATCH 04C COMPARISON RUNNER ===");

  const roleDocs = popRaw.filter((d: any) => d.partition !== "CANDIDATE_DOCUMENT");
  const candDocs = popRaw.filter((d: any) => d.partition === "CANDIDATE_DOCUMENT");

  console.log(`Role documents to evaluate: ${roleDocs.length}`);
  console.log(`Candidate documents to evaluate: ${candDocs.length}`);

  // ----------------------------------------------------
  // STEP 1: ARCHITECTURE A (DETERMINISTIC V1) ON ALL 21 ROLES
  // ----------------------------------------------------
  console.log("\n--- STEP 1: Executing Architecture A (Deterministic V1) on 21 roles ---");
  const v1RoleExtractor = new RoleIntelligenceExtractorV1();
  for (const doc of roleDocs) {
    const text = doc.text ?? doc.rawText;
    const start = Date.now();
    const result = v1RoleExtractor.extract({
      caseId: doc.id,
      canonicalJobId: doc.id,
      rawText: text,
      companyName: doc.company,
      title: doc.title,
    });
    const durationMs = Date.now() - start;
    fs.writeFileSync(path.join(archADir, `${doc.id}.json`), JSON.stringify({
      documentId: doc.id,
      partition: doc.partition,
      durationMs,
      atomCount: result.atoms.length,
      atoms: result.atoms
    }, null, 2), "utf8");
    console.log(`  [Arch A] ${doc.id}: ${result.atoms.length} atoms (${durationMs}ms)`);
  }

  // ----------------------------------------------------
  // STEP 2: ARCHITECTURE B (DIRECT ONTOLOGY GEMINI)
  // Reusing R=8 + DEV=1 from Batch 04B, running fresh H=8 + A=4
  // ----------------------------------------------------
  console.log("\n--- STEP 2: Executing Architecture B (Frozen Direct Ontology) ---");
  const token = await getAdcToken();
  console.log("Acquired Vertex ADC token.");

  for (const doc of roleDocs) {
    const docSeg = segPop.find((s: any) => s.id === doc.id)!;
    const text = doc.text ?? doc.rawText;

    // Check if retained from Batch 04B
    const retainedResolvedPath = path.join(b04bRun1Dir, "resolved", `${doc.id}.json`);
    const retainedRawPath = path.join(b04bRun1Dir, "raw", `${doc.id}.json`);

    if (fs.existsSync(retainedResolvedPath) && fs.existsSync(retainedRawPath)) {
      console.log(`  [Arch B] ${doc.id}: Reusing retained Batch 04B output`);
      fs.copyFileSync(retainedRawPath, path.join(archBDir, "raw", `${doc.id}.json`));
      fs.copyFileSync(retainedResolvedPath, path.join(archBDir, "resolved", `${doc.id}.json`));
      continue;
    }

    const resolvedPath = path.join(archBDir, "resolved", `${doc.id}.json`);
    if (fs.existsSync(resolvedPath)) {
      console.log(`  [Arch B] ${doc.id}: Already resolved, skipping.`);
      continue;
    }

    // Check if raw already exists
    const rawPath = path.join(archBDir, "raw", `${doc.id}.json`);
    let callRes: any;
    if (fs.existsSync(rawPath)) {
      console.log(`  [Arch B] ${doc.id}: Using existing raw output`);
      callRes = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    } else {
      console.log(`  [Arch B] ${doc.id}: Executing fresh call via Vertex...`);
      const prompt = buildRolePromptWithSourceUnits({
        title: doc.title ?? "",
        company: doc.company ?? "",
        units: docSeg.units
      });
      const schema = getRoleJsonSchemaForVertex(docSeg.units);

      callRes = await callVertexGemini(prompt, schema, token);
      fs.writeFileSync(rawPath, JSON.stringify(callRes, null, 2), "utf8");
      await sleep(1500); // polite spacing
    }

    // Resolve with Batch 04B resolver
    const resolved = resolveRoleResponseBySourceId({
      responseText: callRes.textContent,
      sourceText: text,
      canonicalJobId: doc.id,
      caseId: doc.id,
      units: docSeg.units
    });
    fs.writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2), "utf8");

    const acceptedCount = resolved.assembly?.output?.atoms?.length ?? 0;
    const rejectedCount = resolved.assembly?.proposalRejections?.length ?? 0;
    console.log(`    -> Done. Accepted: ${acceptedCount}, Rejected: ${rejectedCount}, ValidSpanIds: ${resolved.validSpanIdCount} (${callRes.durationMs}ms)`);
  }

  // ----------------------------------------------------
  // STEP 3: ARCHITECTURE C (RICH GROUNDED PROPOSITIONS)
  // Executing on ALL 21 role documents (R=8, H=8, A=4, DEV=1)
  // ----------------------------------------------------
  console.log("\n--- STEP 3: Executing Architecture C (Rich Semantic Propositions) on all 21 roles ---");
  for (const doc of roleDocs) {
    const docSeg = segPop.find((s: any) => s.id === doc.id)!;
    const text = doc.text ?? doc.rawText;
    const unitMap = new Map<string, SourceUnit>(docSeg.units.map((u: SourceUnit) => [u.spanId, u]));

    const resolvedPath = path.join(archCDir, "resolved", `${doc.id}.json`);
    if (fs.existsSync(resolvedPath)) {
      console.log(`  [Arch C] ${doc.id}: Already resolved, skipping.`);
      continue;
    }

    const rawPath = path.join(archCDir, "raw", `${doc.id}.json`);
    let callRes: any;
    if (fs.existsSync(rawPath)) {
      console.log(`  [Arch C] ${doc.id}: Using existing raw output`);
      callRes = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    } else {
      console.log(`  [Arch C] ${doc.id} (${doc.partition}, ${docSeg.charLength} chars, ${docSeg.unitCount} units): Calling Vertex...`);
      const prompt = buildRichPropositionPrompt(docSeg.units);
      const schema = RICH_PROPOSITION_JSON_SCHEMA_VERTEX;

      callRes = await callVertexGemini(prompt, schema, token);
      fs.writeFileSync(rawPath, JSON.stringify(callRes, null, 2), "utf8");
      await sleep(1500); // polite spacing
    }

    let parsed: RichPropositionExtractionResponse | null = null;
    let isTruncated = callRes.finishReason === "MAX_TOKENS";
    let parseError: string | null = null;

    try {
      parsed = JSON.parse(callRes.textContent);
    } catch (err: any) {
      const respText = callRes.textContent ?? "";
      const lastObjEnd = respText.lastIndexOf("    },");
      if (lastObjEnd !== -1) {
        const recovered = respText.slice(0, lastObjEnd + 5) + "\n  ]\n}";
        try {
          parsed = JSON.parse(recovered);
          isTruncated = true;
          console.warn(`    [WARN] ${doc.id}: Response truncated at MAX_TOKENS; safely recovered ${parsed?.propositions?.length ?? 0} complete propositions.`);
        } catch (recErr: any) {
          parseError = `Recovery failed: ${recErr.message}; Original: ${err.message}`;
        }
      } else {
        parseError = String(err.message ?? err);
      }
    }

    const propositions = parsed?.propositions ?? [];
    const projection = projectPropositionsToCanonical(propositions, unitMap);

    fs.writeFileSync(resolvedPath, JSON.stringify({
      documentId: doc.id,
      partition: doc.partition,
      durationMs: callRes.durationMs,
      finishReason: callRes.finishReason,
      isTruncated,
      parseError,
      usage: callRes.usage,
      totalPropositions: propositions.length,
      propositions,
      projection
    }, null, 2), "utf8");

    console.log(`    -> Done: ${propositions.length} rich propositions -> ${projection.acceptedAtoms.length} canonical atoms, ${projection.unmappedMaterialCount} unmapped, ${projection.negativeBoundaryCount} negations (${callRes.durationMs}ms)${isTruncated ? " [TRUNCATED_MAX_TOKENS]" : ""}`);
  }

  // ----------------------------------------------------
  // STEP 4: CANDIDATE SIDE-BY-SIDE (N=2)
  // ----------------------------------------------------
  console.log("\n--- STEP 4: Executing Candidate Proof Side-by-Side (N=2) ---");
  const candExtractorV1 = new CandidateProofExtractorV1();
  for (const doc of candDocs) {
    const text = doc.text ?? doc.rawText;
    const start = Date.now();
    const v1Result = candExtractorV1.extract({
      sourceDocumentId: doc.id,
      rawText: text,
    });
    const v1DurationMs = Date.now() - start;

    // Load retained Batch 04B candidate output
    const b04bCandResolved = JSON.parse(fs.readFileSync(path.join(b04bRun1Dir, "resolved", `${doc.id}.json`), "utf8"));
    const b04bClaims = b04bCandResolved.assembly?.output?.allClaims ?? [];
    const b04bRejections = b04bCandResolved.assembly?.proposalRejections ?? [];

    fs.writeFileSync(path.join(candidateDir, `${doc.id}.json`), JSON.stringify({
      documentId: doc.id,
      deterministicV1: {
        durationMs: v1DurationMs,
        claimsCount: v1Result.allClaims.length,
        positionsCount: v1Result.positions.length,
        claims: v1Result.allClaims
      },
      batch04bSourceId: {
        claimsCount: b04bClaims.length,
        rejectedCount: b04bRejections.length,
        claims: b04bClaims
      }
    }, null, 2), "utf8");

    console.log(`  [Candidate] ${doc.id}: V1 claims=${v1Result.allClaims.length} vs Batch 04B claims=${b04bClaims.length}`);
  }

  console.log("\n=== ALL EXTRACTIONS COMPLETED SUCCESSFULLY ===");
}

run().catch(err => {
  console.error("FATAL ERROR in Batch 04C runner:", err);
  process.exit(1);
});
