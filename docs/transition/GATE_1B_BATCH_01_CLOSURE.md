# Gate 1B — Batch 01 Closure

## Status

**COMPLETE**

Batch: `GATE_1B_BATCH_01` — Source/provenance immutability  
Scope revision: `4`  
Implementation commit: `975520554a0e13e0f2433cb12e4f55e3d133a80a`  
Pre-implementation parent: `4fa926b6541c40421c16db79898142a837c18222`

Batch 02 is not authorized by this closure.

## What closed

The canonical source substrate now has exact immutable resolution primitives for candidate and opportunity sources without changing evaluation, policy, dossier, serving, UI, EvidenceGraph, or deterministic Extraction V1 semantics.

The implementation establishes:

- immutable candidate source-version content;
- immutable `opportunity_versions.source_ref` identity for an existing opportunity version;
- content-addressed object keys for new binary opportunity captures;
- explicit SHA-256 binding between a binary source reference and the exact stored blob;
- fail-closed candidate/opportunity source snapshot resolution with independent content-hash verification;
- legacy readable opportunity sources retained where an existing source reference predates the content-addressed contract.

## Verification evidence

Targeted source/provenance verification on the exact candidate:

```text
npx vitest run \
  tests/acquisition/source-payload-provenance.test.ts \
  tests/acquisition/ingestion-lineage.test.ts \
  tests/persistence/populated-migration.test.ts

PASS — 3 files, 14/14 tests
```

TypeScript verification:

```text
npx tsc -p tsconfig.verify.json --noEmit
PASS
```

Production build:

```text
npm run build
PASS
```

Certification-manifest comparison was run for both the exact implementation candidate and its exact pre-implementation parent under GitHub Actions Ubuntu runners:

| Revision | Result | Failures |
| --- | --- | --- |
| `4fa926b6541c40421c16db79898142a837c18222` | 504/506 passed | scraper-operability scenarios AB and AL |
| `975520554a0e13e0f2433cb12e4f55e3d133a80a` | 504/506 passed | scraper-operability scenarios AB and AL |

The two remaining certification-manifest failures are therefore regression-neutral to Batch 01. Both are platform/environment assumptions in `tests/scraper/scraper-operability.test.ts`: Scenario AB reports `FATAL` in the GitHub Actions environment, and Scenario AL uses a pathname intended to be invalid that is legal on Ubuntu. Batch 01 neither changes the scraper-operability implementation nor those tests.

The Batch 01 implementation itself introduced no new certification-manifest failures. Existing worker retry/dead-letter tests also remain green because source identity immutability is enforced at the durable source-reference boundary rather than by forbidding test-only mutation of `raw_content`.

## Governance closure

The exact governed implementation commit is acknowledged in `docs/transition/IMPLEMENTATION_LEDGER.json` under `GATE_1B / GATE_1B_BATCH_01 / scopeRevision 4`.

`docs/transition/CURRENT_BATCH.json` is set to `COMPLETE`. Gate 1B remains active because the extraction architecture decision and later Gate 1B batches remain open. No next production batch is authorized by this closure.
