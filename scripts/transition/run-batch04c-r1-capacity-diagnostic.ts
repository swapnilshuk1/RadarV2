import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildRichPropositionPrompt,
  RICH_PROPOSITION_JSON_SCHEMA_VERTEX,
  projectPropositionsToCanonical,
  RichSemanticProposition
} from "../../src/lib/intelligence/extraction/RichSemanticPropositionContract.js";

const root = process.cwd();
const batchDir = path.resolve(root, "audit-reports/gate1b-batch04c");
const r1Dir = path.resolve(root, "audit-reports/gate1b-batch04c-r1");
const segPop = JSON.parse(fs.readFileSync(path.join(batchDir, "manifests/segmented-population.json"), "utf8"));
const popRaw = JSON.parse(fs.readFileSync(path.join(batchDir, "fixtures/population-raw.json"), "utf8"));

const TRUNCATED_FIXTURE_IDS = [
  "DEV_CONTROL_01",
  "DIVERSE_ROLE_02",
  "DIVERSE_ROLE_03",
  "DIVERSE_ROLE_04",
  "HOLDOUT_ROLE_01",
  "HOLDOUT_ROLE_02",
  "HOLDOUT_ROLE_03",
  "HOLDOUT_ROLE_04",
  "HOLDOUT_ROLE_05",
  "HOLDOUT_ROLE_06",
  "HOLDOUT_ROLE_07",
  "HOLDOUT_ROLE_08"
];

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

async function callVertexGemini65k(promptText: string, schema: any, accessToken: string): Promise<any> {
  const projectId = "project-423841fb-74e8-430a-84a";
  const location = "us-central1";
  const model = "gemini-2.5-flash";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 65536, // DIAGNOSTIC PARAMETER: 8192 -> 65536
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
    throw new Error(`Vertex API call failed (${res.status} ${res.statusText}): ${errText}`);
  }

  const json = await res.json() as any;
  const candidate = json.candidates?.[0];
  const textContent = candidate?.content?.parts?.[0]?.text ?? "";
  const finishReason = candidate?.finishReason;
  const usageMetadata = json.usageMetadata;

  return {
    rawResponse: json,
    textContent,
    finishReason,
    durationMs,
    usageMetadata
  };
}

async function main() {
  console.log("==================================================================");
  console.log("   RADAR GATE 1B BATCH 04C-R1: CAPACITY DIAGNOSTIC RUNNER (65k)   ");
  console.log("==================================================================");

  // Check freeze manifest
  const freezeManifestPath = path.join(r1Dir, "manifests/evaluator-v2-freeze.json");
  if (!fs.existsSync(freezeManifestPath)) {
    throw new Error(`FATAL: evaluator-v2 freeze manifest not found at ${freezeManifestPath}. Aborting.`);
  }
  const freezeData = JSON.parse(fs.readFileSync(freezeManifestPath, "utf8"));
  console.log(`Verified Evaluator-v2 Freeze Hash: ${freezeData.sha256}`);

  const rawDir = path.join(r1Dir, "runs/arch_c_capacity_65k/raw");
  const resolvedDir = path.join(r1Dir, "runs/arch_c_capacity_65k/resolved");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(resolvedDir, { recursive: true });

  const token = await getAdcToken();
  console.log("ADC token acquired successfully.\n");

  const originalCResolvedDir = path.join(batchDir, "runs/arch_c_rich_semantic/resolved");
  const originalCRawDir = path.join(batchDir, "runs/arch_c_rich_semantic/raw");

  const roleDocs = popRaw.filter((d: any) => d.partition !== "CANDIDATE_DOCUMENT");

  for (const doc of roleDocs) {
    const isTruncatedIn04c = TRUNCATED_FIXTURE_IDS.includes(doc.id);
    const resolvedPath = path.join(resolvedDir, `${doc.id}.json`);
    const rawPath = path.join(rawDir, `${doc.id}.json`);

    if (!isTruncatedIn04c) {
      console.log(`[Arch C R1] ${doc.id}: Untruncated in 04C -> Retaining original 04C output unchanged.`);
      const origRaw = path.join(originalCRawDir, `${doc.id}.json`);
      const origResolved = path.join(originalCResolvedDir, `${doc.id}.json`);
      fs.copyFileSync(origRaw, rawPath);
      fs.copyFileSync(origResolved, resolvedPath);
      continue;
    }

    if (fs.existsSync(resolvedPath)) {
      console.log(`[Arch C R1] ${doc.id}: Already resolved with 65k, skipping.`);
      continue;
    }

    const docSeg = segPop.find((s: any) => s.id === doc.id)!;
    console.log(`[Arch C R1] ${doc.id} (Truncated in 04C, ${docSeg.charLength} chars, ${docSeg.unitCount} units): Calling Vertex with maxOutputTokens=65536...`);

    const prompt = buildRichPropositionPrompt(docSeg.units);
    const schema = RICH_PROPOSITION_JSON_SCHEMA_VERTEX;

    let callRes: any;
    if (fs.existsSync(rawPath)) {
      console.log(`  -> Using existing raw output from ${rawPath}`);
      callRes = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    } else {
      callRes = await callVertexGemini65k(prompt, schema, token);
      fs.writeFileSync(rawPath, JSON.stringify(callRes, null, 2), "utf8");
      await sleep(1500); // polite spacing
    }

    let parsedPropositions: RichSemanticProposition[] = [];
    let parseError: string | null = null;
    let isTruncated = callRes.finishReason === "MAX_TOKENS";

    try {
      const parsed = JSON.parse(callRes.textContent);
      parsedPropositions = Array.isArray(parsed.propositions) ? parsed.propositions : [];
    } catch (e: any) {
      parseError = e.message;
      console.warn(`    [Warning] Failed to parse JSON cleanly (${e.message}). Attempting recovery...`);
      const match = callRes.textContent.match(/\"propositions\"\s*:\s*\[([\s\S]*)/);
      if (match) {
        const candidate = match[0].replace(/,\s*$/, "") + "]}";
        try {
          const recovered = JSON.parse("{" + candidate);
          parsedPropositions = recovered.propositions ?? [];
        } catch {}
      }
    }

    const unitMap = new Map<string, any>(docSeg.units.map((u: any) => [u.spanId, u]));
    const projection = projectPropositionsToCanonical(parsedPropositions, unitMap);

    const resolvedPayload = {
      documentId: doc.id,
      partition: doc.partition,
      diagnosticRun: "GATE_1B_BATCH_04C_R1_CAPACITY_65K",
      maxOutputTokensConfig: 65536,
      finishReason: callRes.finishReason,
      isTruncated,
      durationMs: callRes.durationMs,
      rawUsage: {
        promptTokenCount: callRes.usageMetadata?.promptTokenCount,
        candidatesTokenCount: callRes.usageMetadata?.candidatesTokenCount,
        thoughtsTokenCount: callRes.usageMetadata?.thoughtsTokenCount,
        totalTokenCount: callRes.usageMetadata?.totalTokenCount,
        finishReason: callRes.finishReason
      },
      propositionsCount: parsedPropositions.length,
      propositions: parsedPropositions,
      projectionSummary: {
        totalPropositions: parsedPropositions.length,
        projectedAtomsCount: projection.acceptedAtoms.length,
        unmappedConceptsCount: projection.unmappedMaterialCount,
        negativeBoundaryCount: projection.negativeBoundaryCount,
        rejectedPropositionsCount: projection.rejectedPropositions.length
      },
      parseError
    };

    fs.writeFileSync(resolvedPath, JSON.stringify(resolvedPayload, null, 2), "utf8");
    console.log(`    -> Done. Props: ${parsedPropositions.length}, ProjectedAtoms: ${projection.acceptedAtoms.length}, Unmapped: ${projection.unmappedMaterialCount}, NegBoundaries: ${projection.negativeBoundaryCount}, Finish: ${callRes.finishReason} (Candidates: ${callRes.usageMetadata?.candidatesTokenCount}, Thoughts: ${callRes.usageMetadata?.thoughtsTokenCount}, Duration: ${callRes.durationMs}ms)`);
  }

  console.log("\n==================================================================");
  console.log("   CAPACITY DIAGNOSTIC EXECUTION FINISHED SUCCESSFULLY             ");
  console.log("==================================================================");
}

main().catch(err => {
  console.error("FATAL ERROR in Capacity Diagnostic Runner:", err);
  process.exit(1);
});
