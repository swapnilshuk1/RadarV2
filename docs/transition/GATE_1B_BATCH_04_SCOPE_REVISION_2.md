# Gate 1B — Batch 04 Scope Revision 2

**Status:** READY
**Scope revision:** 2
**No provider output generated before this amendment:** confirmed.

## Why revision 1 was not executable

`radar-certification/corpus/001.json` through `100.json` are metadata
certification fixtures with empty descriptions. They do not contain the
immutable role text required by either extraction provider. Batch 04 cannot
substitute or regenerate descriptions for those files.

The Batch 03 experiment intentionally supplied only the provider-neutral
`LlmStructuredExtractionClient` boundary. It did not include a real transport
adapter or credentials, so it could not execute a scientific LLM comparison.

## Corrected frozen role source

The authoritative frozen role source is the historical Git artifact:

```text
commit: e1f0a47575accedcd7fd3d681c7b084ca377b0fd
path: audit-reports/phase5-100-case-corpus/cases.jsonl
```

The Batch 04 manifest must pin the commit, blob SHA, whole-file byte length and
SHA-256, case count, and each case ID, canonical job ID where present, and raw
JD byte length/SHA-256. The harness must read the Git object or a mechanically
verified byte-identical materialization. The provenance chain is:

```text
historical frozen Git commit/blob
→ per-case immutable rawText identity/hash
→ Batch 04 comparison manifest
```

The metadata-only `radar-certification/corpus` collection may be recorded as
related certification metadata but is not an extraction source.

## Narrow transport authorization

One non-production, Batch-04-only real transport adapter may be implemented
under `scripts/extraction-comparison/`. It must implement the existing
`LlmStructuredExtractionClient` contract; use only environment/ADC credentials;
honor the existing strict structured-output request mapping; keep transport
retries distinct from semantic reruns; and retain attempt/telemetry data.

It must not change the Batch 03 provider, prompt, generation configuration,
proposal schema, assembler, verifier, normalizer, cache identity semantics,
deterministic extractor, or production wiring. Credentials must never be
committed or included in artifacts.

Provider/model/generation configuration and transport behavior must be pinned
before the first primary provider result. If the selected API cannot honor the
frozen structured-output semantics without changing Batch 03 contracts, Batch
04 must stop and report that incompatibility.

## Unchanged scientific controls

All scope-revision-1 population, label-freezing, repeatability, parity,
telemetry, raw-artifact retention, anti-tuning, and downstream prohibitions
remain binding. This amendment changes neither the comparison methodology nor
the open extraction-architecture decision.

Batch 05 remains **NOT AUTHORIZED**.
