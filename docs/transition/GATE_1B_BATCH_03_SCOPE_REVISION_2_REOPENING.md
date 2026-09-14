# Gate 1B — Batch 03 Scope Revision 2 Reopening

## Status

**READY**

Batch: `GATE_1B_BATCH_03` — Controlled LLM RoleIntelligence / CandidateProof extraction experiment
Scope revision: `2`
Corrective-scope start commit: `9f45103425ef4901bc7e570044fef2056122ae3f`

The Batch 03 scope revision 1 implementation and its ledger acknowledgement
remain historical evidence. Its former closure is superseded for
scientific-readiness purposes only. This is not a new batch and does not
authorize Batch 04.

## Authorized correction

Scope revision 2 may change only:

1. strict runtime structural schemas for `RoleIntelligenceOutputV1` and
   `CandidateProofOutputV1` at the experimental LLM response boundary;
2. the shared `MechanicalExtractionVerifier` used by deterministic and
   experimental providers;
3. cross-object mechanical invariants: derived IDs, parent/child and
   cross-list relations, source identity, provenance, containment, collection
   equality/accounting, and normalization;
4. observer isolation after outcome finalization;
5. experiment-only execution telemetry for requested/actual provider model,
   response ID, latency, token usage, and cost when the transport supplies it;
6. real transport contract and tests proving strict structured-output schema
   translation and non-retention intent;
7. tests and transition documentation needed to prove malformed but
   TypeScript-castable output cannot achieve `VERIFIED`.

## Validator ownership

```text
strict runtime schema
  -> shape, required fields, enums, primitive constraints

shared MechanicalExtractionVerifier
  -> exact source truth, IDs, containment, cross-list consistency,
     provenance, normalization, and relational invariants
```

These are complementary layers, not competing validation pipelines.

## Exit criterion

Any result labelled `VERIFIED` is proven at runtime to satisfy the complete
mechanically-verifiable V1 contract against the exact immutable source,
regardless of whether it came from the deterministic or experimental LLM
provider.

## Explicit exclusions

No Batch 04 comparison or benchmark, extraction architecture decision,
production authority switch, canonical source-fact persistence, EvidenceGraph,
evaluation, policy, dossier/editorial, serving, UI, or source-immutability
change is authorized by this reopening.
