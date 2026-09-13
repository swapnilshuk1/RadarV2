# Gate 1B — Batch 03 Scope Revision 2 Closure

## Status

**SUPERSEDED FOR SCIENTIFIC-VALIDITY PURPOSES**

Batch: `GATE_1B_BATCH_03` — Controlled LLM RoleIntelligence / CandidateProof extraction experiment
Scope revision: `2`
Corrective-scope start commit: `9f45103425ef4901bc7e570044fef2056122ae3f`
Implementation commit: `062afcb19771a563b80db0103e8d1d8265cf39ba`
Implementation acknowledgement: `d4f6934e7087e198fd72400d3cd383aa7a2bb5f3`

This closure recorded completion of Batch 03 scope revision 2 only. It is
superseded for scientific-validity purposes by the governed reopening of
`GATE_1B_BATCH_03` at scope revision 3. Batch 04 remains unauthorized.

## What closed

Scope revision 2 made the experimental extraction path scientifically ready for
future comparison without selecting an architecture or changing authority:

- strict runtime V1 structural-shape validation before experimental output is
  converted to TypeScript values;
- strict structured-output request translation with explicit `store: false`;
- shared mechanical verification for deterministic and LLM providers, including
  stable identifiers, exact source spans, source identity, containment,
  cross-object collections, claim provenance, grounded entities, normalization,
  and metadata accounting;
- observer isolation so telemetry failure cannot convert a finalized extraction
  result into a rejection;
- response telemetry for requested/actual model, response ID, latency, token
  usage, and supplied estimated cost, intentionally outside cache identity;
- adversarial tests proving malformed but TypeScript-castable output cannot be
  labelled `VERIFIED`.

The strict runtime schema validates structural shape, required fields, enums,
and primitive constraints. The shared `MechanicalExtractionVerifier` validates
source truth and relational invariants. They are complementary layers, not
competing extraction pipelines.

## Verification evidence

```text
npx vitest run \
  tests/intelligence/extraction/provider-boundary.test.ts \
  tests/intelligence/extraction/llm-experimental-provider.test.ts \
  tests/intelligence/role-intelligence-extractor-v1.test.ts \
  tests/intelligence/candidate-proof-extractor-v1.test.ts

PASS — 4 files, 52/52 tests

npx vitest run tests/intelligence/extraction
PASS — 2 files, 16/16 tests

npx tsc --noEmit
PASS

npx tsc -p tsconfig.verify.json --noEmit
PASS

git diff --check
PASS
```

No production module imports the experimental LLM path. No Batch 04 benchmark,
extraction architecture decision, production extraction switch, canonical
persistence, EvidenceGraph, evaluation, policy, dossier/editorial, serving,
UI, or source-immutability change was made.

## Governance closure

The governed implementation commit is acknowledged in
`docs/transition/IMPLEMENTATION_LEDGER.json` under
`GATE_1B / GATE_1B_BATCH_03 / scopeRevision 2`.

`docs/transition/CURRENT_BATCH.json` is set to `COMPLETE`. Gate 1B remains
active and `extractionArchitectureDecision.status` remains `OPEN`. Batch 04
requires separate explicit authorization before any implementation begins.
