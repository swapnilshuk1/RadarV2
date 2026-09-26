/**
 * Registers one user-approved candidate source set and creates a provenance-bound
 * profile projection. It never activates a serving plan.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ProjectionPipeline } from "../src/lib/intelligence/pipeline/ProjectionPipeline";
import { loadUnifiedEnvironment } from '../src/lib/env';
import { loadMantleCredentials } from '../src/lib/model/bedrock-credentials';

function option(name: string): string {
  const value = process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const personId = option("--person-id");
const tenantId = option("--tenant-id");
const sourcePath = resolve(option("--source"));
loadUnifiedEnvironment();
if (!process.env.GROQ_API_KEY?.trim()) loadMantleCredentials();

const documentText = await readFile(sourcePath, "utf8");
const documentHash = createHash("sha256").update(documentText, "utf8").digest("hex");
const documentId = `doc-${randomUUID()}`;
const result = await new ProjectionPipeline().run({
  documentId,
  scope: { tenantId, personId },
  filename: basename(sourcePath),
  storageUri: `candidate-source-set://sha256/${documentHash}`,
  mimeType: "text/markdown",
  documentHash,
  documentText,
  activateServingPlan: false,
  requireModelBackedExtraction: true,
});

if (!result.success) throw new Error(result.error ?? "AUTHORITATIVE_SOURCE_BOOTSTRAP_FAILED");
console.log(JSON.stringify({ documentId, documentHash, stage: result.stage, servingPolicyActivated: false }));
