# Batch 04 Vertex execution block

The first locked Batch 04 Gemini ADC execution completed on 13 September 2026.
It produced no semantic-provider output because Vertex AI rejected every
transport call before structured generation.

## Retained first-run evidence

- Primary cases: 138
  - role: 128 rejected / 0 verified
  - candidate: 10 rejected / 0 verified
- Predeclared repeatability cases: 15 rejected / 0 verified
- Transport attempts: 459
- HTTP status distribution: 403 = 459
- Semantic proposal results: none
- Primary results were not replaced or retried as semantic runs.

The deterministic parity artifact remains valid:

```text
role direct V1 versus Batch 02 adapter: 100 / 100 exact
candidate direct V1 versus Batch 02 adapter: 2 / 2 exact
non-parity cases: none
```

## Blocking condition

The chosen Vertex endpoint returned `PERMISSION_DENIED` for
`aiplatform.endpoints.predict` on the configured project/model. The retained
raw attempt artifacts contain the exact provider response, request identities,
timestamps, and retry history:

- `llm/primary.json`
- `repeatability/runs.json`
- `telemetry/attempts.json`
- `telemetry/all-attempts.json`

The failure is an operational provider-permission issue, not an extraction
semantic result. Batch 04 cannot calculate LLM semantic quality, provenance,
high-risk false positives, or stability from this run.

## Required next action

Do not replace this evidence. A later, explicitly authorized scope amendment
must pin an ADC principal/project/model combination with
`aiplatform.endpoints.predict` permission (or authorize a different
provider/transport), identify a separate rerun, and preserve this failed run.
Batch 04 remains open. No extraction architecture decision follows from this
failure.
