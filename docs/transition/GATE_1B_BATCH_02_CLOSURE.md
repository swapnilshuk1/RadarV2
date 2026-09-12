# Gate 1B — Batch 02 Closure

## Status

**COMPLETE**

Batch: `GATE_1B_BATCH_02` — Extraction provider boundary + common mechanical verifier
Scope revision: `1`
Batch start commit: `2e774e08193167fd3bb7a85ea5a4787c0f94bd4b`
Implementation commit: `29235fe9e454e78a9b2f1c97a2e80547727e8d68`
Implementation acknowledgement: `7970f3200a99cefefef159e3cc22117ee5766c41`

Batch 03 is not authorized by this closure.

## What closed

Batch 02 established an experimental extraction seam without selecting an
extraction architecture or changing production extraction authority:

- explicit `RoleIntelligence` and `CandidateProof` provider contracts;
- deterministic adapters that reproduce the frozen V1 extractor output without
  transforming it;
- equivalent, non-authoritative LLM provider contracts with no implementation,
  transport, cache, or serving authority;
- deterministic cache/input identity bound to immutable source identity and
  provider/schema configuration;
- one common mechanical verifier that rejects source-reference mismatch,
  unresolvable exact spans, invalid role ontology values, duplicate semantic
  anchors, and malformed deterministic metric normalization;
- a resolver-bound execution seam that resolves the Batch 01 immutable source
  before provider execution and verifies the returned output against that same
  snapshot.

The new provider seam has no production consumer. The frozen deterministic V1
extractors remain the production baseline and the extraction architecture
decision remains open.

## Verification evidence

Targeted provider-boundary and frozen deterministic baseline verification:

```text
npx vitest run \
  tests/intelligence/extraction/provider-boundary.test.ts \
  tests/intelligence/role-intelligence-extractor-v1.test.ts \
  tests/intelligence/candidate-proof-extractor-v1.test.ts

PASS — 3 files, 43/43 tests
```

TypeScript verification:

```text
npx tsc --noEmit
PASS

npx tsc -p tsconfig.verify.json --noEmit
PASS
```

Scope and whitespace verification:

```text
git diff --check
PASS

npm run transition:check
PASS after the implementation acknowledgement
```

The resolver-bound runner test proves a provider cannot execute after the
captured immutable opportunity source no longer resolves to its canonical
content identity. The parity tests prove the deterministic adapters preserve
the direct V1 output exactly.

## Governance closure

The governed implementation commit is acknowledged in
`docs/transition/IMPLEMENTATION_LEDGER.json` under
`GATE_1B / GATE_1B_BATCH_02 / scopeRevision 1`.

`docs/transition/CURRENT_BATCH.json` is set to `COMPLETE`. Gate 1B remains
active. `extractionArchitectureDecision.status` remains `OPEN`. No Batch 03
LLM experiment, EvidenceGraph, evaluation, policy, canonical source-fact
persistence, dossier/editorial, serving, UI, or production extraction
authority change is authorized or implemented by this closure.
