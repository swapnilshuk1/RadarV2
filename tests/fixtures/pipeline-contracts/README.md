# Phase 0 pipeline-contract fixtures

These fixtures are deterministic, offline diagnostic evidence for Checkpoint
C1. They are not production data, a scoring benchmark, or a certification
suite.

Each specimen preserves the source title, company, location, canonical source
URL, HTTP/content metadata, and captured text needed to exercise the existing
pipeline authorities. The Cvent specimen retains the complete substantive
10KB job description, including its leadership, AI, operating-model, and
requirements sections. The PDF specimen stores a sanitized magic-byte excerpt,
original byte length, and SHA-256 rather than embedding a large binary body.

Machine expectations are in `contract-matrix.json`. Human review labels and
rationales are deliberately separate in `human-audit-labels.json`; they must
never become persisted decisions or scores. File and captured-body hashes are
in `specimen-manifest.json`.

The matrix records both the current observed behavior and the intended
boundary contract:

```text
fixture
  -> acquisition/document state
  -> JobProjection state
  -> eligibility state
  -> evaluation state
  -> decision
  -> score
```

The current observed column was produced by invoking the existing
`ResponseValidator`, `JobProjectionBuilder`, `AttentionGate`, and
`runEngineSingleIntrinsic` in an offline diagnostic harness. The harness is
kept under the ignored `.radar/` directory and is not part of application
runtime or certification.

## Specimen set

| Fixture | Purpose |
| --- | --- |
| `cvent-rich-empty-capabilities` | Rich substantive JD that currently reaches `EMPTY_CAPABILITIES`. |
| `wpp-client-services-false-negative` | Relevant agency/client-services role currently rejected by lexical eligibility. |
| `weber-client-experience-false-negative` | Relevant digital agency role currently rejected by lexical eligibility. |
| `msm-compound-chief-title-false-negative` | Compound Chief Strategy and Transformation title. |
| `acumont-technical-hard-exclusion` | Genuine technical leadership hard-exclusion control. |
| `fillezy-pdf-byte-stream` | PDF bytes incorrectly treated as complete content. |
| `ats-temporary-redirect-notice` | Sanitized unresolved ATS redirect notice. |
| `chanakaya-unrelated-careers-page` | Wrong employer careers page rather than the advertised JD. |
| `genuine-sparse-board-advisor` | Genuine but insufficiently specified vacancy. |

Phase 0 does not change production code or tests. Phase 1 remains separately
unauthorized pending C1 review.
