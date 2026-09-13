# Gate 1B — Batch 04 Authorization

**Status:** READY
**Scope revision:** 1
**Batch start commit:** `4c7c682b97702cad6c82faac929acc84bc4b5dc4`

## Purpose

Batch 04 is a reproducible, read-only scientific comparison of the frozen
deterministic extraction baseline and the Batch 03 experimental LLM
semantic-proposal path. It produces observations and retained artifacts for
Batch 05; it does not select an extraction architecture.

## Locked comparison populations

Before either provider runs, the comparison manifest must declare the fixture
ID, immutable content hash, source identity, partition, and expected
mechanical validity for every case.

- **Frozen regression:** `radar-certification/corpus/001.json` through
  `100.json`, exactly as committed at the batch start commit. These files are
  immutable during Batch 04.
- **Unseen:** `UNSEEN_ROLE_01` through `UNSEEN_ROLE_12`, and
  `UNSEEN_CANDIDATE_01` through `UNSEEN_CANDIDATE_08`, created and frozen
  before either provider runs.
- **Adversarial:** `ADV_01` through `ADV_16`, including formatting, punctuation
  and heading mutations; reordered sections; repeated/ambiguous anchors;
  sparse postings; role/company contamination; qualification-versus-duty
  confusion; and reporting-line, P&L, people/team-authority, and
  decision-authority false-positive risks.

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
content, labels, or scoring in response to observed results. Any necessary
correction requires an explicit scope amendment and a separately identified
rerun. No result may be silently replaced.

## Exclusions

This authorization does not permit an architecture decision, hybrid/production
implementation, canonical source-fact persistence, EvidenceGraph, evaluation,
policy, dossier, serving, UI, or source-immutability changes. Batch 05 remains
separately authorized work.
