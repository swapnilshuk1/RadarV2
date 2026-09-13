# Gate 1B — Batch 03 Scope Revision 3 Closure

## Status

**COMPLETE**

Batch: `GATE_1B_BATCH_03` — Controlled LLM RoleIntelligence / CandidateProof extraction experiment  
Scope revision: `3`  
Corrective-scope start commit: `a4d1b98258d91fdf28fde4991580484c64a28c54`

This closure preserves, rather than replaces, the earlier Batch 03 closure and
scope-revision reopening records. Those documents remain the forensic history
of the scientific-validity corrections completed here.

## Final implementation and acknowledgement chain

| Implementation | Acknowledgement | Result |
| --- | --- | --- |
| `713870b5b4c47d14e044d70664dd79a133bea62f` | `c0c4f1c07b8f9f66711316db53fdb3aa5a549cc1` | Exact V1 verifier/runtime invariant hardening and adversarial test evidence. |
| `2a7c59db9686806e3b269b5ce10cfa5ea7517296` | `43da28aeba031b19714a62e648cf8005a94ed883` | Proposal-only LLM contract and deterministic immutable-source V1 assembly. |
| `0f0ba91f257099576e5451b7b963dcb07fa3ea37` | `6ab5ed343919a2c6051d4662bd7febcdb93cc4eb` | Canonical proof-type identity, proposal-level rejection accounting, and deterministic metric/entity normalization. |
| `2e51d1dd8936db75a0596c9d95c7f4b903ef6f55` | `65cd3fdb092922e8f9787a8df379ef4a805d2895` | Typed rejection causes, whole-run failure for unexpected assembler faults, and role span-plus-semantic-type identity. |
| `a51f742b8e1d647d0e9b60f9c10abc1906c93232` | `ebf1d3a3d9cdddc72ff6d90ef14aa2144dbb86be` | Typed rejection causality exposed through the governed executor and observer API. |

All implementation commits are acknowledged in
`docs/transition/IMPLEMENTATION_LEDGER.json` under `GATE_1B`, Batch 03,
scope revision 3.

## What closed

Batch 03 now establishes the experiment-only path:

```text
immutable source snapshot
  -> schema-bound LLM semantic proposals only
  -> deterministic exact quote/span resolution
  -> deterministic V1 identity, containment, collections, accounting,
     metric normalization, and source-grounded entity enrichment
  -> shared Batch 02 MechanicalExtractionVerifier
  -> VERIFIED or REJECTED experimental outcome
```

The model does not provide authoritative source/request identity, offsets,
stable IDs, parent IDs, aggregate collections, accounting totals, normalized
metrics, or source-grounded entities. Exact source failures retain typed
experiment-only rejection causes through the resolver-bound executor. A
malformed envelope/schema or unexpected assembler/normalizer failure rejects
the entire experimental run; an independently invalid semantic proposal is
locally rejected with exact accounting while valid proposals remain measurable.

Role duplicate identity follows existing V1 identity: exact span plus semantic
type. Candidate proof-type ordering is canonicalized before stable-ID
derivation. The experimental candidate structural parser remains explicitly
limited to reliable Markdown heading/pipe/bullet structures; future comparison
must report structural and enrichment coverage separately from semantic quality.

## Verification evidence

```text
npx vitest run \
  tests/intelligence/extraction/provider-boundary.test.ts \
  tests/intelligence/extraction/llm-experimental-provider.test.ts \
  tests/intelligence/role-intelligence-extractor-v1.test.ts \
  tests/intelligence/candidate-proof-extractor-v1.test.ts

PASS — 4 files, 64/64 tests

npx tsc --noEmit
PASS

npx tsc -p tsconfig.verify.json --noEmit
PASS

Production import scan for experimental extraction modules
PASS — no imports outside src/lib/intelligence/extraction/

git diff --check
PASS

npm run transition:check
PASS after each governed acknowledgement
```

## Governance closure

Gate 1B remains active. `extractionArchitectureDecision.status` remains
`OPEN`; no architecture was selected. Gate 1 certification remains `null`.
No deterministic production extraction authority, canonical persistence,
EvidenceGraph, evaluation, policy, dossier/editorial, serving, UI, or Batch 04
comparison code was changed or authorized by this closure.

Batch 04 requires separate explicit authorization before its methodology or
implementation begins.
