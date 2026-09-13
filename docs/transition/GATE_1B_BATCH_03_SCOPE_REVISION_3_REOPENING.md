# Gate 1B — Batch 03 Scope Revision 3 Reopening

## Status

**READY**

Batch: `GATE_1B_BATCH_03` — Controlled LLM RoleIntelligence / CandidateProof extraction experiment
Scope revision: `3`
Corrective-scope start commit: `a4d1b98258d91fdf28fde4991580484c64a28c54`

Scope revisions 1 and 2 remain historical implementation and verification
evidence. Their closures are superseded for scientific-validity purposes. This
is not a new batch and does not authorize Batch 04.

## Explicit experimental boundary decision

```text
immutable source snapshot
  -> LLM semantic proposals: exact quote, semantic classification, subject,
     and bounded semantic attributes
  -> deterministic source-bound assembly: exact span resolution, stable IDs,
     source identity, aggregate collections, and mechanical normalization
  -> shared MechanicalExtractionVerifier
  -> verified experimental V1 output only
```

The experiment measures semantic extraction quality. It does not measure an
LLM's ability to recreate V1 serialization, offsets, stable IDs, duplicate
collections, or accounting bookkeeping.

## Authorized correction

Scope revision 3 may change only:

1. prompt/provider contracts so the model receives proposal-relevant source
   text and no longer must invent or echo non-semantic identity/context;
2. schema-bound role and candidate semantic proposal types and deterministic
   source-bound V1 assembly;
3. exact `allClaims` bidirectional equality/uniqueness and exact proposal
   accounting;
4. complete runtime checks for all typed V1 fields retained at an LLM boundary;
5. adversarial tests for missing prompt identity/context, duplicate/omitted
   claims, accounting mismatch, malformed qualifiers/parsed years, and invalid
   semantic proposals;
6. transition documentation required for this correction.

## Explicit exclusions

No Batch 04 comparison/benchmark, extraction architecture decision, production
authority switch, canonical persistence, EvidenceGraph, evaluation, policy,
dossier/editorial, serving, UI, source-immutability change, or deterministic
V1 semantic change is authorized.
