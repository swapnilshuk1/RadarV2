import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CandidateProofExtractorV1 } from "../../src/lib/intelligence/extraction/CandidateProofExtractorV1";
import { DeterministicCandidateProofProvider, DeterministicRoleIntelligenceProvider } from "../../src/lib/intelligence/extraction/DeterministicExtractionProviderAdapters";
import { ExperimentalLlmExtractionExecutor } from "../../src/lib/intelligence/extraction/ExperimentalLlmExtractionExecutor";
import { LLM_EXPERIMENT_PROMPT_VERSION, LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, ExperimentalLlmCandidateProofProvider, ExperimentalLlmRoleIntelligenceProvider, type LlmExperimentConfiguration } from "../../src/lib/intelligence/extraction/LlmExperimentalExtractionProvider";
import { LLM_SEMANTIC_ASSEMBLER_VERSION, LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION } from "../../src/lib/intelligence/extraction/ExperimentalSemanticProposal";
import { RoleIntelligenceExtractorV1, type RoleSemanticType, type RoleSubject } from "../../src/lib/intelligence/extraction/RoleIntelligenceExtractorV1";
import { VerifiedExtractionProviderRunner } from "../../src/lib/intelligence/extraction/VerifiedExtractionProviderRunner";
import type { CandidateDocumentSourceRef, OpportunityVersionSourceRef } from "../../src/lib/domain/source_provenance";
import type { ResolvedSourceSnapshot } from "../../src/lib/provenance/SourceSnapshotResolver";
import { GeminiAdcStructuredExtractionClient, GEMINI_ADC_TRANSPORT_VERSION } from "./GeminiAdcTransport";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = path.join(ROOT, "audit-reports/gate1b-batch04");
const PINNED_COMMIT = "e1f0a47575accedcd7fd3d681c7b084ca377b0fd";
const CORPUS_PATH = "audit-reports/phase5-100-case-corpus/cases.jsonl";
const FIXTURES_PATH = path.join(ROOT, "tests/fixtures/extraction-comparison/batch04-fixtures.json");
const MANIFEST_PATH = path.join(OUTPUT, "manifest/pre-provider-manifest.json");

type RoleFact = readonly [string, RoleSemanticType, RoleSubject];
type RoleFixture = { id: string; title?: string; company?: string; text: string; facts: RoleFact[]; highRiskNegatives: RoleSemanticType[]; expectedMechanicalValidity?: string };
type CandidateFixture = { id: string; documentId: string; text: string; claims: string[] };
type FixtureFile = { schemaVersion: string; labelSchemaVersion: string; authoringReviewStatus: string; unseenRoles: RoleFixture[]; unseenCandidates: CandidateFixture[]; adversarialRoles: RoleFixture[]; repeatability: { fixtureIds: string[]; repeatCount: number; generationConfiguration: Record<string, unknown>; seedSupport: string } };
type HistoricalCase = { caseId: string; company: string; role: string; identity: { canonicalJobId?: string; opportunityVersion?: string }; job: { rawText: string } };

const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const git = (spec: string) => execFileSync("git", ["show", spec], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const gitBlob = (spec: string) => execFileSync("git", ["rev-parse", spec], { cwd: ROOT, encoding: "utf8" }).trim();
const writeJson = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };

function frozenText(pathAtCommit: string): string { return git(`${PINNED_COMMIT}:${pathAtCommit}`); }
function sourceRole(caseId: string, canonicalJobId: string, opportunityVersion: string, text: string): OpportunityVersionSourceRef {
  return { kind: "OPPORTUNITY_VERSION", canonicalJobId, opportunityVersion, contentHash: sha256(text), sourcePayloadKey: null, sourcePayloadSha256: null };
}
function sourceCandidate(documentId: string, text: string): CandidateDocumentSourceRef {
  const hash = sha256(text); return { kind: "CANDIDATE_DOCUMENT_TEXT", personId: "batch04-candidate", documentId, documentHash: hash, textHash: hash };
}
function runnerFor(source: CandidateDocumentSourceRef | OpportunityVersionSourceRef, text: string): VerifiedExtractionProviderRunner {
  const snapshot: ResolvedSourceSnapshot = { ref: source, storage: "DATABASE_TEXT", mediaType: "text/plain; charset=utf-8", bytes: Buffer.from(text), text };
  return new VerifiedExtractionProviderRunner({ resolve: async (requested: unknown) => {
    if (JSON.stringify(requested) !== JSON.stringify(source)) throw new Error("Comparison runner source mismatch.");
    return snapshot;
  } } as never);
}
function loadFixtures(): FixtureFile { return JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8")) as FixtureFile; }
function loadFrozenCases(): HistoricalCase[] { return frozenText(CORPUS_PATH).trim().split("\n").map((line) => JSON.parse(line) as HistoricalCase); }
function candidateSources(): CandidateFixture[] {
  return [
    { id: "CANDIDATE_REGRESSION_M", documentId: "Swapnil_Shukla_Resume_M.md", text: frozenText("audit-reports/phase5-100-case-corpus/Swapnil_Shukla_Resume_M.md"), claims: [] },
    { id: "CANDIDATE_REGRESSION_V3", documentId: "Swapnil_Shukla_Executive_Resume_v3.md", text: frozenText("audit-reports/phase5-100-case-corpus/Swapnil_Shukla_Executive_Resume_v3.md"), claims: [] },
  ];
}

function preProviderManifest(): unknown {
  const corpusText = frozenText(CORPUS_PATH); const fixtures = loadFixtures(); const candidates = candidateSources(); const cases = loadFrozenCases();
  return {
    schemaVersion: "gate1b-batch04-manifest/v1", state: "PRE_PROVIDER_LOCKED", createdAt: new Date().toISOString(),
    historicalRoleCorpus: { gitCommit: PINNED_COMMIT, repositoryPath: CORPUS_PATH, gitBlobSha: gitBlob(`${PINNED_COMMIT}:${CORPUS_PATH}`), byteLength: Buffer.byteLength(corpusText), sha256: sha256(corpusText), caseCount: cases.length,
      cases: cases.map((item) => ({ caseId: item.caseId, canonicalJobId: item.identity.canonicalJobId ?? null, rawTextByteLength: Buffer.byteLength(item.job.rawText), rawTextSha256: sha256(item.job.rawText) })) },
    candidateRegression: candidates.map((item) => ({ id: item.id, gitCommit: PINNED_COMMIT, repositoryPath: `audit-reports/phase5-100-case-corpus/${item.documentId}`, gitBlobSha: gitBlob(`${PINNED_COMMIT}:audit-reports/phase5-100-case-corpus/${item.documentId}`), byteLength: Buffer.byteLength(item.text), sha256: sha256(item.text), BMAcceptanceFacts: "BM-01 through BM-13 are asserted by tests/intelligence/candidate-proof-extractor-v1.test.ts" })),
    fixtureFile: { repositoryPath: path.relative(ROOT, FIXTURES_PATH).replace(/\\/g, "/"), sha256: sha256(fs.readFileSync(FIXTURES_PATH)), labelSchemaVersion: fixtures.labelSchemaVersion, authoringReviewStatus: fixtures.authoringReviewStatus,
      unseenRoleIds: fixtures.unseenRoles.map((item) => item.id), unseenCandidateIds: fixtures.unseenCandidates.map((item) => item.id), adversarialRoleIds: fixtures.adversarialRoles.map((item) => item.id), repeatability: fixtures.repeatability },
    identity: { deterministicExtractor: "RoleIntelligenceExtractorV1/CandidateProofExtractorV1", deterministicAdapter: "adbfc37 providers", llmProviderImplementation: "ExperimentalLlm*Provider", transport: GEMINI_ADC_TRANSPORT_VERSION, provider: "Vertex AI Gemini ADC", model: process.env.BATCH04_GEMINI_MODEL ?? "gemini-2.5-flash", promptVersion: LLM_EXPERIMENT_PROMPT_VERSION, promptHash: sha256(LLM_EXPERIMENT_PROMPT_VERSION), responseSchemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, proposalSchemaVersion: LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION, assemblerVersion: LLM_SEMANTIC_ASSEMBLER_VERSION, verifier: "MechanicalExtractionVerifier", normalizer: "CandidateProofExtractorV1.extractMetrics/extractEntities", generationConfiguration: fixtures.repeatability.generationConfiguration, seedSupport: fixtures.repeatability.seedSupport, matchingRules: "exact source quote plus semantic type/subject for role; exact claim quote for candidate", aggregationRules: "per-population metrics only; no composite winner" },
  };
}

function scoreRole(output: ReturnType<RoleIntelligenceExtractorV1["extract"]>, fixture: RoleFixture) {
  const expected = new Set(fixture.facts.map(([quote, type, subject]) => `${quote}\u0000${type}\u0000${subject}`));
  const actual = new Set(output.atoms.filter((atom) => atom.semanticType).map((atom) => `${atom.exactText}\u0000${atom.semanticType}\u0000${atom.subject}`));
  const truePositive = [...actual].filter((item) => expected.has(item)).length;
  const falsePositive = [...actual].filter((item) => !expected.has(item)).length;
  const falseNegative = [...expected].filter((item) => !actual.has(item)).length;
  const highRiskFalsePositives = fixture.highRiskNegatives.filter((type) => output.atoms.some((atom) => atom.semanticType === type));
  return { truePositive, falsePositive, falseNegative, precision: actual.size ? truePositive / actual.size : null, recall: expected.size ? truePositive / expected.size : null, highRiskFalsePositives };
}
function scoreCandidate(output: ReturnType<CandidateProofExtractorV1["extract"]>, fixture: CandidateFixture) {
  const actual = new Set(output.allClaims.map((claim) => claim.exactText)); const expected = new Set(fixture.claims);
  const truePositive = [...actual].filter((claim) => expected.has(claim)).length;
  return { truePositive, falsePositive: [...actual].filter((claim) => !expected.has(claim)).length, falseNegative: [...expected].filter((claim) => !actual.has(claim)).length };
}

async function parity() {
  const roles = loadFrozenCases(); const candidates = candidateSources(); let roleParity = 0; let candidateParity = 0; const nonParity: string[] = [];
  for (const item of roles) {
    const source = sourceRole(item.caseId, item.identity.canonicalJobId ?? `batch04:${item.caseId}`, item.identity.opportunityVersion ?? `batch04:${item.caseId}`, item.job.rawText);
    const direct = new RoleIntelligenceExtractorV1().extract({ caseId: item.caseId, canonicalJobId: source.canonicalJobId, rawText: item.job.rawText, companyName: item.company, title: item.role });
    const adapted = await new DeterministicRoleIntelligenceProvider().extract({ source, sourceText: item.job.rawText, caseId: item.caseId, companyName: item.company, title: item.role });
    if (JSON.stringify(direct) === JSON.stringify(adapted.output)) roleParity += 1; else nonParity.push(`ROLE:${item.caseId}`);
  }
  for (const item of candidates) {
    const source = sourceCandidate(item.documentId, item.text); const direct = new CandidateProofExtractorV1().extract({ sourceDocumentId: item.documentId, rawText: item.text });
    const adapted = await new DeterministicCandidateProofProvider().extract({ source, sourceText: item.text });
    if (JSON.stringify(direct) === JSON.stringify(adapted.output)) candidateParity += 1; else nonParity.push(`CANDIDATE:${item.id}`);
  }
  return { role: { matching: roleParity, total: roles.length }, candidate: { matching: candidateParity, total: candidates.length }, nonParity };
}

async function executeLlmCase(kind: "ROLE" | "CANDIDATE", fixture: RoleFixture | CandidateFixture, configuration: LlmExperimentConfiguration, transport: GeminiAdcStructuredExtractionClient) {
  if (kind === "ROLE") {
    const role = fixture as RoleFixture; const source = sourceRole(role.id, `batch04:${role.id}`, `batch04:${role.id}`, role.text);
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(source, role.text)).runRole(new ExperimentalLlmRoleIntelligenceProvider(transport, configuration), { source, caseId: role.id, companyName: role.company, title: role.title });
    return { id: role.id, kind, outcome, score: outcome.state === "VERIFIED" ? scoreRole(outcome.result.output, role) : null };
  }
  const candidate = fixture as CandidateFixture; const source = sourceCandidate(candidate.documentId, candidate.text);
  const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(source, candidate.text)).runCandidate(new ExperimentalLlmCandidateProofProvider(transport, configuration), { source });
  return { id: candidate.id, kind, outcome, score: outcome.state === "VERIFIED" ? scoreCandidate(outcome.result.output, candidate) : null };
}

async function run(): Promise<void> {
  const fixtures = loadFixtures(); const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as { fixtureFile: { sha256: string } };
  if (manifest.fixtureFile.sha256 !== sha256(fs.readFileSync(FIXTURES_PATH))) throw new Error("Fixture file changed after the pre-provider manifest was locked.");
  const parityResult = await parity(); writeJson(path.join(OUTPUT, "deterministic/parity.json"), parityResult);
  if (parityResult.nonParity.length) throw new Error(`Deterministic parity failed: ${parityResult.nonParity.join(", ")}`);
  const configuration: LlmExperimentConfiguration = { providerId: "gemini-adc-batch04", model: process.env.BATCH04_GEMINI_MODEL ?? "gemini-2.5-flash", promptVersion: LLM_EXPERIMENT_PROMPT_VERSION, responseSchemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, proposalSchemaVersion: LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION, assemblerVersion: LLM_SEMANTIC_ASSEMBLER_VERSION, generationParameters: fixtures.repeatability.generationConfiguration as Record<string, string | number | boolean | null> };
  const transport = new GeminiAdcStructuredExtractionClient({ projectId: process.env.GCP_PROJECT_ID ?? "project-0e166cfc-e3f5-49d7-af6", location: "us-central1", timeoutMs: 90_000, maxTransportRetries: 2 });
  const primary = [] as unknown[];
  for (const fixture of [...fixtures.unseenRoles, ...fixtures.adversarialRoles]) primary.push(await executeLlmCase("ROLE", fixture, configuration, transport));
  for (const fixture of [...candidateSources(), ...fixtures.unseenCandidates]) primary.push(await executeLlmCase("CANDIDATE", fixture, configuration, transport));
  writeJson(path.join(OUTPUT, "llm/primary.json"), primary); writeJson(path.join(OUTPUT, "telemetry/attempts.json"), transport.attempts);
  const lookup = new Map([...fixtures.unseenRoles, ...fixtures.adversarialRoles, ...fixtures.unseenCandidates, ...candidateSources()].map((item) => [item.id, item]));
  const repeats = [] as unknown[];
  for (const id of fixtures.repeatability.fixtureIds) for (let index = 0; index < fixtures.repeatability.repeatCount; index += 1) {
    const fixture = lookup.get(id); if (!fixture) throw new Error(`Repeatability fixture missing: ${id}`);
    repeats.push(await executeLlmCase("text" in fixture ? ("facts" in fixture ? "ROLE" : "CANDIDATE") : "CANDIDATE", fixture as RoleFixture | CandidateFixture, configuration, transport));
  }
  writeJson(path.join(OUTPUT, "repeatability/runs.json"), repeats); writeJson(path.join(OUTPUT, "telemetry/all-attempts.json"), transport.attempts);
}

if (process.argv.includes("--freeze")) writeJson(MANIFEST_PATH, preProviderManifest());
else if (process.argv.includes("--parity")) parity().then((result) => { writeJson(path.join(OUTPUT, "deterministic/parity.json"), result); console.log(JSON.stringify(result)); });
else run().catch((error) => { console.error(error); process.exitCode = 1; });
