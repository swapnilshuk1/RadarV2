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

## Experimental structural and enrichment boundary

The Batch 03 candidate assembler uses only deterministic Markdown
heading/pipe position and bullet recognition where those forms are present.
That narrow structural recognizer is experimental assembly infrastructure,
not a replacement candidate-document normalization architecture and not a
production parser. A source that does not establish a reliable position/bullet
container cannot yield a `WORK_HISTORY` claim from this experiment.

After a semantic quote is accepted and structurally contained, the assembler
may invoke existing deterministic source-normalization helpers for metrics and
grounded entities. The model does not propose their values. Education and
other structural-only V1 collections are intentionally not a semantic-experiment
quality signal; a future comparison must report structural/enrichment coverage
separately from semantic proposal quality.

Malformed envelopes and proposal-schema violations reject the response.
Individually unresolvable, ambiguous, duplicate-anchor, or structurally
uncontained proposals are rejected locally and represented by exact proposal
accounting, so independently valid proposals remain measurable.
Those local rejections retain an experiment-only typed cause
(`ABSENT_QUOTE`, `AMBIGUOUS_QUOTE`, `DUPLICATE_SEMANTIC_ANCHOR`, or
`STRUCTURAL_CONTAINMENT`) for later comparison analysis. Unexpected assembler
or deterministic-normalizer faults are not downgraded to proposal rejection:
they reject the whole experimental run.
The governed experimental executor and observer contract expose that typed
sidecar on verified outcomes, so a future comparison does not need to cast a
provider result or bypass the resolver-bound runner to inspect causality.

Role duplicate identity follows the canonical V1 atom convention of exact
span plus semantic type. One source span may therefore support distinct role
semantic types, while repeated proposals with the same span and type are
locally rejected as duplicate semantic anchors.

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
