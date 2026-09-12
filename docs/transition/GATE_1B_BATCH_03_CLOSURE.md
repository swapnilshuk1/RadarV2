# Gate 1B — Batch 03 Closure

## Status

**COMPLETE**

Batch: `GATE_1B_BATCH_03` — Controlled LLM RoleIntelligence / CandidateProof extraction experiment  
Scope revision: `1`  
Batch start commit: `ccc86a7e1612e9cbf28c78eb4c565afc1024e880`  
Implementation commit: `770a218d5c518591005d23ee8c1536c80cfbf32c`  
Implementation acknowledgement: `3e2fea671a15475097d57ff6ff94236ee2ea26b4`

Batch 04 is not authorized by this closure.

## What closed

Batch 03 added an experiment-only LLM implementation to the Batch 02 provider
seam without selecting an extraction architecture or changing production
authority:

- injected structured-output transport contracts with no SDK, credential, or
  serving dependency;
- experimental RoleIntelligence and CandidateProof providers that implement the
  existing Batch 02 LLM provider interfaces;
- deterministic configuration fingerprinting over provider identity, model,
  prompt version, response-schema version, and material generation parameters;
- Batch 02 provider cache identity binding that also includes the exact immutable
  Batch 01 source identity;
- response-envelope validation, exact source binding, and explicit `store: false`
  transport intent;
- an experiment-only executor that returns `VERIFIED` only after the existing
  resolver-bound runner and common mechanical verifier accept the output, and
  otherwise returns a `REJECTED` outcome without repair, canonical persistence,
  or production authority.

The deterministic V1 extractors remain the production baseline. The LLM path
has no production consumer and no systematic architecture comparison was run.
The extraction architecture decision remains **OPEN**.

## Verification evidence

Targeted experiment and frozen-boundary verification:

```text
npx vitest run \
  tests/intelligence/extraction/provider-boundary.test.ts \
  tests/intelligence/extraction/llm-experimental-provider.test.ts \
  tests/intelligence/role-intelligence-extractor-v1.test.ts \
  tests/intelligence/candidate-proof-extractor-v1.test.ts

PASS — 4 files, 48/48 tests
```

The experiment tests cover RoleIntelligence and CandidateProof execution through
the existing resolver-bound runner, deterministic prompt/schema/model/parameter
identity, malformed JSON rejection, foreign-source rejection, and rejection by
the existing exact-span mechanical verifier.

TypeScript verification:

```text
npx tsc --noEmit
PASS

npx tsc -p tsconfig.verify.json --noEmit
PASS
```

Scope and whitespace verification:

```text
rg -n "ExperimentalLlm|LlmExperimental|ExperimentalLlmExtractionExecutor" src \
  --glob '!src/lib/intelligence/extraction/**'
PASS — no production imports

git diff --check
PASS
```

## Governance closure

The governed implementation commit is acknowledged in
`docs/transition/IMPLEMENTATION_LEDGER.json` under
`GATE_1B / GATE_1B_BATCH_03 / scopeRevision 1`.

`docs/transition/CURRENT_BATCH.json` is set to `COMPLETE`. Gate 1B remains
active. `extractionArchitectureDecision.status` remains `OPEN`. No Batch 04
comparison, architecture decision, EvidenceGraph, evaluation, policy, canonical
source-fact persistence, dossier/editorial, serving, UI, or production
extraction-authority work is authorized or implemented by this closure.
