# Gate 1B — Batch 04 Scope Revision 3

**Status:** READY
**Scope revision:** 3
**Corrective-scope start commit:** `0d93b59518db52d7db01fdc62e25c723b80aef30`

## Purpose

Scope revision 2 completed the locked first Gemini/Vertex execution. It is
permanently retained as `RUN_0_VERTEX_PERMISSION_BLOCKED` and is not a
semantic-quality result:

```text
Vertex attempts: 459
HTTP 403: 459
Verified LLM outputs: 0
Semantic proposal sets available for scoring: 0
```

The ADC-authenticated request reached Vertex AI, but the execution principal
lacked `aiplatform.endpoints.predict` for the configured project/model. The
existing deterministic control remains successful: role parity is 100/100,
candidate parity is 2/2, and there are no deterministic non-parity cases.

The corrective-scope start is the acknowledgement of that completed Run 0.
This prevents earlier scope-revision-2 implementation acknowledgements from
being retrospectively treated as scope-revision-3 work; they remain retained
historical evidence.

This revision authorizes one separately identified
`RUN_1_VERTEX_AUTHORIZED` operational rerun after the existing Gemini/Vertex
path is available to an ADC principal and project with the necessary narrow
Vertex permission. It does not alter the scientific question or authorize a
provider, model, prompt, schema, fixture, label, scoring, or extraction change.

## Operational preflight

Before any benchmark fixture is sent, record non-secret operational provenance:

- ADC mechanism and safely obtainable principal/account identity;
- endpoint project and quota project when available;
- Vertex region; and
- the existing pinned Gemini model.

Run exactly one non-scored transport capability probe using the existing
transport and structured-output mapping. Retain its request identity, HTTP
status, provider/model, latency, non-secret response metadata, token usage when
available, and non-secret error details when unsuccessful.

If the probe fails with HTTP 403 or another infrastructure-blocking result,
stop. Do not issue the 138-case primary population or repeatability slice. Do
not change cloud IAM unless an already authorized administrative capability is
explicitly available. Report the principal, project, missing permission, and
the minimally appropriate pre-existing Vertex AI role/permission requirement.

## Locked semantic experiment

`RUN_1_VERTEX_AUTHORIZED` must use the exact scope-revision-2 locked
comparison apparatus:

- same Gemini on Vertex provider, ADC authentication, model, and generation
  configuration;
- same Batch 03 prompt/hash, proposal schema/version, ontology, assembler,
  verifier, normalizer, exact-source rules, and deterministic provider adapter;
- same frozen historical source artifact, unseen/adversarial/candidate
  populations, labels, material-fact inventories, high-risk negatives,
  matching/scoring/aggregation rules, repeatability slice, and repeat count.

Only the operational endpoint project/region where required and the
Vertex-authorized ADC principal/IAM binding may differ. No access tokens,
refresh tokens, private keys, or credential-file content may be retained.

Run 1 must have a separate artifact directory and immutable run identity. It
cannot overwrite or replace Run 0 primary, repeatability, telemetry, manifest,
or report artifacts. Transport retry remains distinct from a semantic rerun;
the predeclared single primary semantic output per fixture remains binding.

## Boundaries and completion

This is evidence-only. It does not authorize a production extraction switch,
an extraction architecture recommendation, Batch 05, Batch 06, EvidenceGraph,
evaluation, policy, persistence, dossier, serving, UI, or source-immutability
work.

If the probe succeeds, Run 1 may complete the locked comparison and report
separate role/candidate semantic, provenance, structural/enrichment,
high-risk, rejection, repeatability, latency, token, and cost observations.
The extraction architecture decision remains **OPEN**. Batch 05 remains
**NOT AUTHORIZED** and requires a separate explicit governance authorization
after Batch 04 closes.
