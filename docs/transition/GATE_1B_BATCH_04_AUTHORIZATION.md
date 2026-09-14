# Gate 1B — Batch 04 Authorization

**Status:** READY
**Scope revision:** 1
**Batch start commit:** `4c7c682b97702cad6c82faac929acc84bc4b5dc4`

## Purpose

Batch 04 is a reproducible, comparison-only evaluation of the frozen
deterministic extraction baseline and the Batch 03 experimental LLM
semantic-proposal path. It may create Batch 04 fixtures, labels, manifests,
reports, and audit artifacts, but must not modify production extraction
semantics, provider prompts/configuration, canonical persistence, or runtime
authority. It produces observations for Batch 05; it does not select an
extraction architecture.

## Locked comparison populations

Before either provider runs, the comparison manifest must declare the fixture
ID, immutable content hash, source identity, partition, expected mechanical
validity, label schema version, label-set hash, and authoring/review status for
every case. All gold labels, material-fact inventories, high-risk negatives,
matching rules, scoring rules, and metric aggregation rules must be committed
before either provider runs against the relevant population. Provider output
must not be visible to the person or process establishing or changing labels.

- **Frozen regression:** `radar-certification/corpus/001.json` through
  `100.json`, exactly as committed at the batch start commit. These files are
  immutable during Batch 04. The comparison manifest must record the
  provenance chain from the historical frozen source identity to the
  certification fixture identity/hash and then to the Batch 04 manifest hash.
  Batch 04 must not regenerate or normalize this corpus.
- **Frozen candidate regression:** `Swapnil_Shukla_Resume_M.md`,
  `Swapnil_Shukla_Executive_Resume_v3.md`, and approved `BM-01` through
  `BM-13` acceptance facts. Source bytes and hashes must be pinned before
  either provider runs.
- **Unseen:** `UNSEEN_ROLE_01` through `UNSEEN_ROLE_12`, and
  `UNSEEN_CANDIDATE_01` through `UNSEEN_CANDIDATE_08`, created and frozen
  before either provider runs.
- **Adversarial:** `ADV_01` through `ADV_16`, including formatting, punctuation
  and heading mutations; reordered sections; repeated/ambiguous anchors;
  sparse postings; role/company contamination; qualification-versus-duty
  confusion; and reporting-line, P&L, people/team-authority, and
  decision-authority false-positive risks.

## Identity, parity, and repeatability

The comparison manifest must pin the exact deterministic extractor/version and
provider-adapter/version; LLM provider implementation/version; model/provider
identifier; prompt hash/version; proposal-schema version; assembler version;
mechanical verifier version; generation configuration; and immutable source
snapshot identity/hash.

Deterministic baseline parity means the Batch 02 deterministic provider adapter
reproduces the direct frozen V1 extractor output for the same immutable source,
modulo only explicitly enumerated non-semantic envelope fields declared before
execution. The report must include exact role and candidate parity counts and
identify every non-parity case.

Each LLM fixture is run once for the primary locked comparison. A separately
identified, predeclared repeatability slice is run a fixed number of times with
identical source, model, prompt, schema, and generation configuration. Primary
results must never be replaced by a better repeat. The report must state whether
the provider supports deterministic seed semantics and measure proposal
presence/absence, semantic-classification, exact-quote, high-risk
classification, and whole-run-failure agreement or variance across repeats.

## Required measurements

Report role and candidate extraction separately. For each, retain and report:

- provenance and exact-span validity;
- labeled semantic precision/recall, or a documented equivalent where a label
  is inapplicable;
- structural coverage and metric/entity enrichment coverage separately from
  semantic quality;
- high-risk role false positives for P&L ownership, reporting line,
  people/team authority, and decision authority;
- deterministic baseline parity;
- local proposal rejection causes, whole-run rejections/failures, and
  unresolved mechanical failures;
- immutable source/cache identity; provider/model, prompt, proposal-schema,
  assembler, and generation-configuration versions; and
- latency, token usage, cost, and explicit unavailable-telemetry counts.

Retain raw fixture manifests, provider outputs, verifier outcomes, labels and
scores, rejection sidecars, and telemetry under
`audit-reports/gate1b-batch04/`.

## Anti-tuning rule

Batch 04 must not modify extraction semantics, prompt/configuration, fixture
content, labels, matching/scoring/aggregation rules, or repeat policy in
response to observed results. Any necessary correction requires an explicit
scope amendment and a separately identified rerun. No result may be silently
replaced.

## Exclusions

This authorization does not permit an architecture decision, hybrid/production
implementation, canonical source-fact persistence, EvidenceGraph, evaluation,
policy, dossier, serving, UI, or source-immutability changes.

**Batch 05 is NOT AUTHORIZED by this batch and requires a separate explicit
governance authorization after Batch 04 closes.**
