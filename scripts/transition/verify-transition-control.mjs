#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const statePath = resolve(root, "docs/transition/RADAR_TRANSITION_STATE.json");

function die(message) {
  console.error(`TRANSITION CONTROL FAIL: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`Cannot read/parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    die(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function pathMatchesPrefix(file, prefix) {
  return file === prefix || file.startsWith(prefix);
}

function addLines(set, value) {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) set.add(trimmed.replaceAll("\\", "/"));
  }
}

function lines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

if (!existsSync(statePath)) {
  die("Missing docs/transition/RADAR_TRANSITION_STATE.json");
}

const state = readJson(statePath);
if (state.schemaVersion !== "radar-transition-state/v1") {
  die(`Unsupported transition state schema: ${String(state.schemaVersion)}`);
}

const controlPath = resolve(root, state.controlDocument);
const batchPath = resolve(root, state.currentBatchManifest);
if (!existsSync(controlPath)) die(`Missing control document: ${state.controlDocument}`);
if (!existsSync(batchPath)) die(`Missing current batch manifest: ${state.currentBatchManifest}`);

const batch = readJson(batchPath);
const control = readFileSync(controlPath, "utf8");

if (batch.schemaVersion !== "radar-transition-batch/v1") {
  die(`Unsupported current-batch schema: ${String(batch.schemaVersion)}`);
}
if (batch.id !== state.activeBatchId) {
  die(`Active batch mismatch: state=${state.activeBatchId}, manifest=${batch.id}`);
}
if (batch.gate !== state.activeGate) {
  die(`Active gate mismatch: state=${state.activeGate}, manifest=${batch.gate}`);
}
if (batch.scopeRevision !== state.currentBatchScopeRevision) {
  die(
    `Batch scope revision mismatch: state=${state.currentBatchScopeRevision}, manifest=${batch.scopeRevision}`,
  );
}
if (batch.controlRevision !== state.controlRevision) {
  die(
    `Control revision mismatch: state=${state.controlRevision}, manifest=${batch.controlRevision}`,
  );
}
if (typeof batch.batchStartCommit !== "string" || !/^[0-9a-f]{40}$/i.test(batch.batchStartCommit)) {
  die(`Invalid batchStartCommit: ${String(batch.batchStartCommit)}`);
}

git(["merge-base", "--is-ancestor", batch.batchStartCommit, "HEAD"]);

const requiredControlText = [
  `Working branch: \`${state.workingBranch}\``,
  "Gate 1A architecture reconnaissance: **COMPLETE**",
];

if (state.activeGate === "GATE_1B") {
  requiredControlText.push("Current execution gate: **Gate 1 of 3 — Gate 1B");
  requiredControlText.push("**Gate 1B — Batch 01: Source/provenance immutability.**");
}
if (state.extractionArchitectureDecision?.status === "OPEN") {
  requiredControlText.push("**Still open:** the production extraction architecture.");
  requiredControlText.push("**EvidenceGraph is not the next step after source immutability.**");
}

for (const snippet of requiredControlText) {
  if (!control.includes(snippet)) {
    die(`Control document is out of sync; missing required text: ${snippet}`);
  }
}

const extractionDecision = state.extractionArchitectureDecision ?? {};
const gateExit = state.gateExitCertifications ?? {};

function requireExistingRecord(label, path) {
  if (typeof path !== "string" || path.trim() === "") {
    die(`${label} is required before entering ${state.activeGate}`);
  }
  if (!existsSync(resolve(root, path))) {
    die(`${label} points to a missing file: ${path}`);
  }
}

if (state.activeGate === "GATE_2" || state.activeGate === "GATE_3") {
  if (extractionDecision.status !== "DECIDED") {
    die("Gate 2+ is forbidden while extraction architecture decision is still OPEN");
  }
  if (!extractionDecision.roleExtraction || !extractionDecision.candidateExtraction) {
    die("Gate 2+ requires explicit role and candidate extraction decisions");
  }
  requireExistingRecord("Extraction architecture decision record", extractionDecision.decisionRecord);
  requireExistingRecord("Gate 1 exit certification", gateExit.gate1);
}

if (state.activeGate === "GATE_3") {
  requireExistingRecord("Gate 2 exit certification", gateExit.gate2);
}

const gateHardForbidden = {
  GATE_1B: [
    "src/lib/intelligence/engines/",
    "src/lib/intelligence/policy/",
    "src/lib/intelligence/editorial/",
    "src/lib/intelligence/dossier/",
    "src/lib/intelligence/evaluation/",
    "src/lib/intelligence/rematerialization/",
    "src/lib/intelligence/EvaluationWorker.ts",
    "src/lib/intelligence/engine.ts",
    "src/lib/intelligence/serving/",
    "src/lib/opportunity",
    "src/routes/",
    "src/data/sqlite/repositories/SqliteDossierPresentationStore.ts",
    "src/data/sqlite/repositories/SqliteEvaluationStore.ts",
    "src/data/sqlite/repositories/SqliteMaterializedEvaluationStore.ts",
    "src/data/sqlite/repositories/SqliteOpportunityQueries.ts"
  ],
  GATE_2: [
    "src/lib/intelligence/editorial/",
    "src/lib/intelligence/dossier/",
    "src/lib/intelligence/serving/",
    "src/routes/",
    "src/data/sqlite/repositories/SqliteDossierPresentationStore.ts"
  ],
  GATE_3: []
};

const hardForbidden = gateHardForbidden[state.activeGate];
if (!hardForbidden) {
  die(`No hard gate-path policy exists for active gate ${state.activeGate}`);
}

if (typeof state.gateEntryCommit !== "string" || !/^[0-9a-f]{40}$/i.test(state.gateEntryCommit)) {
  die(`Invalid gateEntryCommit: ${String(state.gateEntryCommit)}`);
}

git(["merge-base", "--is-ancestor", state.gateEntryCommit, "HEAD"]);

const changed = new Set();
addLines(changed, git(["diff", "--name-only", `${state.gateEntryCommit}...HEAD`]));
addLines(changed, git(["diff", "--name-only"], { allowFailure: true }));
addLines(changed, git(["diff", "--cached", "--name-only"], { allowFailure: true }));

const allowedPrefixes = Array.isArray(batch.allowedPathPrefixes) ? batch.allowedPathPrefixes : [];
if (allowedPrefixes.length === 0) die("Current batch has no allowedPathPrefixes");

const violations = [];
for (const file of [...changed].sort()) {
  const blockedBy = hardForbidden.find((prefix) => pathMatchesPrefix(file, prefix));
  if (blockedBy) {
    violations.push(`${file} — hard-blocked by ${state.activeGate} boundary (${blockedBy})`);
    continue;
  }

  const allowed = allowedPrefixes.some((prefix) => pathMatchesPrefix(file, prefix));
  if (!allowed) {
    violations.push(`${file} — outside current batch allowlist`);
  }
}

if (violations.length > 0) {
  console.error("TRANSITION CONTROL FAIL: changed files exceed the authorized gate/batch scope:");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error("\nStop before coding further. Amend the governing control/state/batch scope explicitly rather than bypassing this check.");
  process.exit(1);
}

if (state.requirePerCommitAcknowledgement !== true) {
  die("Transition state must require per-commit acknowledgement before implementation begins");
}

if (typeof state.implementationLedger !== "string" || state.implementationLedger.trim() === "") {
  die("Transition state is missing implementationLedger");
}
if (typeof state.agentChangeProtocol !== "string" || state.agentChangeProtocol.trim() === "") {
  die("Transition state is missing agentChangeProtocol");
}

const ledgerPath = resolve(root, state.implementationLedger);
const agentProtocolPath = resolve(root, state.agentChangeProtocol);
if (!existsSync(ledgerPath)) die(`Missing implementation ledger: ${state.implementationLedger}`);
if (!existsSync(agentProtocolPath)) die(`Missing agent change protocol: ${state.agentChangeProtocol}`);

const ledger = readJson(ledgerPath);
if (ledger.schemaVersion !== "radar-transition-implementation-ledger/v1") {
  die(`Unsupported implementation-ledger schema: ${String(ledger.schemaVersion)}`);
}
if (
  typeof ledger.enforcementStartCommit !== "string" ||
  !/^[0-9a-f]{40}$/i.test(ledger.enforcementStartCommit)
) {
  die(`Invalid ledger enforcementStartCommit: ${String(ledger.enforcementStartCommit)}`);
}

git(["merge-base", "--is-ancestor", ledger.enforcementStartCommit, "HEAD"]);

const governanceOnlyPrefixes = Array.isArray(ledger.governanceOnlyPathPrefixes)
  ? ledger.governanceOnlyPathPrefixes
  : [];
if (governanceOnlyPrefixes.length === 0) {
  die("Implementation ledger has no governanceOnlyPathPrefixes");
}

const acknowledgements = Array.isArray(ledger.acknowledgements) ? ledger.acknowledgements : [];
const ackByCommit = new Map();
for (const ack of acknowledgements) {
  if (!ack || typeof ack !== "object") die("Implementation ledger contains a non-object acknowledgement");
  if (typeof ack.commit !== "string" || !/^[0-9a-f]{40}$/i.test(ack.commit)) {
    die(`Implementation ledger contains invalid commit SHA: ${String(ack.commit)}`);
  }
  if (ackByCommit.has(ack.commit)) {
    die(`Implementation ledger contains duplicate acknowledgement for ${ack.commit}`);
  }
  git(["merge-base", "--is-ancestor", ack.commit, "HEAD"]);
  if (typeof ack.gate !== "string" || typeof ack.batchId !== "string") {
    die(`Acknowledgement ${ack.commit} must record gate and batchId`);
  }
  if (!Number.isInteger(ack.scopeRevision) || ack.scopeRevision < 1) {
    die(`Acknowledgement ${ack.commit} must record a positive integer scopeRevision`);
  }
  if (typeof ack.summary !== "string" || ack.summary.trim() === "") {
    die(`Acknowledgement ${ack.commit} must include a summary`);
  }
  if (!Array.isArray(ack.invariantsChecked) || ack.invariantsChecked.length === 0) {
    die(`Acknowledgement ${ack.commit} must list invariantsChecked`);
  }
  if (!Array.isArray(ack.verification) || ack.verification.length === 0) {
    die(`Acknowledgement ${ack.commit} must list verification actually performed`);
  }
  ackByCommit.set(ack.commit, ack);
}

const currentBatchCommits = new Set(
  lines(git(["rev-list", "--reverse", `${batch.batchStartCommit}..HEAD`], { allowFailure: true })),
);
const commitShas = lines(
  git(["rev-list", "--reverse", `${ledger.enforcementStartCommit}..HEAD`], { allowFailure: true }),
);
const unacknowledged = [];
for (const commitSha of commitShas) {
  const files = lines(git(["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha]));
  const governedFiles = files.filter(
    (file) => !governanceOnlyPrefixes.some((prefix) => pathMatchesPrefix(file, prefix)),
  );
  if (governedFiles.length === 0) continue;

  const ack = ackByCommit.get(commitSha);
  if (!ack) {
    unacknowledged.push({ commitSha, governedFiles });
    continue;
  }

  if (
    currentBatchCommits.has(commitSha) &&
    (ack.gate !== state.activeGate ||
      ack.batchId !== state.activeBatchId ||
      ack.scopeRevision !== state.currentBatchScopeRevision)
  ) {
    die(
      `Acknowledgement ${commitSha} does not match active-batch authorization: ` +
        `recorded ${ack.gate}/${ack.batchId}/scope-${ack.scopeRevision}, ` +
        `current ${state.activeGate}/${state.activeBatchId}/scope-${state.currentBatchScopeRevision}`,
    );
  }
}

if (unacknowledged.length > 0) {
  console.error(
    "TRANSITION CONTROL FAIL: governed commits exist without implementation-ledger acknowledgement:",
  );
  for (const item of unacknowledged) {
    console.error(`  - ${item.commitSha}`);
    for (const file of item.governedFiles) console.error(`      ${file}`);
  }
  console.error(
    `\nAdd an acknowledgement for every listed commit to ${state.implementationLedger}, ` +
      "then rerun npm run transition:check before declaring agent completion.",
  );
  process.exit(1);
}

const worktreeChanged = new Set();
addLines(worktreeChanged, git(["diff", "--name-only"], { allowFailure: true }));
addLines(worktreeChanged, git(["diff", "--cached", "--name-only"], { allowFailure: true }));
const governedWorktree = [...worktreeChanged].filter(
  (file) => !governanceOnlyPrefixes.some((prefix) => pathMatchesPrefix(file, prefix)),
);
if (governedWorktree.length > 0) {
  console.error(
    "TRANSITION CONTROL FAIL: uncommitted governed changes exist and cannot be ledger-acknowledged:",
  );
  for (const file of governedWorktree.sort()) console.error(`  - ${file}`);
  console.error(
    "\nCommit the authorized governed change, acknowledge that exact commit SHA in the implementation ledger, then rerun transition control before agent completion.",
  );
  process.exit(1);
}

const branch =
  process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  git(["branch", "--show-current"], { allowFailure: true });

if (branch && branch !== "HEAD" && branch !== "main" && branch !== state.workingBranch) {
  console.warn(
    `TRANSITION CONTROL WARNING: running on ${branch}; governing working branch is ${state.workingBranch}`,
  );
}

console.log("TRANSITION CONTROL PASS");
console.log(`  gate: ${state.activeGate}`);
console.log(`  batch: ${batch.id} — ${batch.title}`);
console.log(`  extraction decision: ${extractionDecision.status}`);
console.log(`  governed commits acknowledged: ${acknowledgements.length}`);
console.log(`  changed files since gate entry: ${changed.size}`);
