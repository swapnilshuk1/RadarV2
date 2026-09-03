# Phase 7 — Fresh Acquisition and Evaluation Validation

**Status:** Gate 1 repair plan. Internal milestones are evidence checkpoints,
not separate approval ceremonies.

## Program governance

The remaining work uses three meaningful gates:

```text
G1 — Contract Repair
     candidate projection → acquisition/document validation → JobProjection
     → eligibility → evaluation/materialization → durable lineage
        |
        v
G2 — Fresh-Data Validation
     controlled fresh acquisition → lineage → projection → eligibility
     → evaluation → manual inspection → end-to-end certification
        |
        v
G3 — Production Decision
     production baseline → deploy/activate → smoke → observation
```

The former C4a/C5/C6/6A/6B/7A/7B labels remain useful evidence references,
but they are not approval boundaries. Work may proceed between internal
milestones when it stays within the declared gate, does not create production
impact, and continues to meet focused-test and certification requirements.

An immediate stop and new approval is required only if a newly discovered issue
materially changes risk or scope: destructive schema/data work, irreversible
production mutation, cross-tenant exposure, a new external credential/security
boundary, or a new serving/persistence architecture outside the existing
authorities.

## Decision and purpose

The legacy 3,254-job canonical corpus remains a preserved forensic baseline. It
must not be deleted, reclassified, rematerialized, or treated as the truth set
for contemporary acquisition quality. The historical 60-job audit is no longer
a replay cohort because the interrupted run `run-1788360270053` did not retain
a durable source-listing-to-canonical-version join for 58 of its 60 records.

Phase 7 validates the repaired pipeline with a deliberately small, contemporary
cohort whose identity is retained from discovery through canonical ingestion.
It is not a new serving universe: every accepted posting enters the tenant's
existing cumulative canonical opportunity pool. The cohort label is only an
acquisition-provenance and analysis handle.

```text
source listing / card
        |
        v
durable per-ingestion lineage record
        |
        v
canonical opportunity + immutable version
        |
        v
tenant/person active-context candidate and evaluation
        |
        v
shortlist projection
```

## Why the current ledger is insufficient

`acquisition_ledger` is the existing persistence authority for acquisition
state. It already carries the portal, source job ID, canonical job ID, URL and
document-quality state. It cannot establish a reproducible run-level join
because it has neither `scrape_run_id` nor `opportunity_version`; its current
uniqueness is `(source_portal, canonical_job_id)`. The scraper receives the
authoritative `canonicalJobId` and `opportunityVersion` from
`CanonicalIngestionService.ingestOpportunity`, but presently emits only
aggregate telemetry after that call. Snapshots and journal events retain card
identity separately, not the returned canonical/version identity.

The Phase 7 repair must extend this existing acquisition authority. It must not
add a second mapper, validator, scorer, canonical store, or serving path.

## G1 internal milestone — lineage implementation

Before any live validation scrape, add an **additive migration** and a
repository method on `StorageProvider.acquisition` that records one durable
outcome for every attempted card ingestion. The record may be a new child table
of `acquisition_ledger` (preferred, because it preserves repeated run history),
not an overwrite of the ledger's current state.

Minimum fields for each successful ingestion:

| Field | Authority / purpose |
| --- | --- |
| `scrape_run_id` | durable run identity from `scrape_runs` |
| `tenant_id`, `person_id` | scope that launched the run |
| `acquisition_ledger_id` and `card_id` | stable source-listing/card identity |
| `source_portal`, `source_job_id`, `source_url` | portal-owned source identity |
| `canonical_job_id`, `opportunity_version` | return values from canonical ingestion |
| `capture_state`, `document_state` | observed capture/validation state; never inferred from score |
| `content_hash` | immutable captured-document identity |
| `created_at` | event time |

For an unsuccessful validation or canonical-ingestion attempt, retain the same
source identity, run, capture/document state, and failure class, while leaving
canonical job/version null only where canonical ingestion never succeeded. A
successful ingestion is invalid unless both returned identifiers are present.

Persistence requirements:

- Explicitly persist returned identifiers; never reconstruct them from a title,
  URL, time, content hash, or current-pool lookup.
- Make recording idempotent for one `(scrape_run_id, card_id, ingestion_attempt)`
  event. A retry is a distinct, ordered attempt and must not overwrite prior
  provenance.
- Record the lineage result after canonical ingestion commits. If its durable
  write fails, mark that card/run as lineage-incomplete and fail the validation
  run rather than claiming a usable cohort.
- Keep this record as provenance only. `canonical_opportunities`, active
  contexts, and serving queries remain the authorities for the cumulative pool
  and shortlist.
- Keep payload/blob provenance on `opportunity_versions`; this ledger links to
  it and does not duplicate bytes or JD text.
- The migration is additive, nullable only for failed attempts, has no
  historical backfill, and does not modify existing legacy rows.

Required implementation evidence before any portal interaction:

1. A focused repository/service test proves source card → canonical job →
   effective version is persisted from the actual ingestion result.
2. A duplicate retry is idempotent and cannot create duplicate canonical rows,
   versions, or indistinguishable lineage events.
3. Failed validation, redirect, wrong-page, PDF, and sparse states retain their
   truthful state; invalid documents cannot acquire a fabricated version or
   evaluation identity.
4. Tenant/person and run scope are retained and cross-scope writes are rejected.
5. The mapping is queryable without snapshots, run journals, title matching, or
   other filesystem artifacts.
6. Existing canonical serving and active-context shortlist behavior is unchanged.

Update the authoritative test inventory only as part of that separately
approved implementation, following the repository's test-governance protocol.

## G2 internal milestone — controlled live cohort

Run only after Phase 7A passes and a fresh read-only baseline confirms the
target tenant/person, active evaluation context, and no active scrape-run lock.

Initial cap: **five query families × three portals × one page**, with a maximum
of ten processed cards per portal/query unit. A second page is not automatic;
it requires review of the first-page lineage and document-quality results.

Proposed role families are test objectives, not a claim that every portal must
return every family:

| Family | Intent |
| --- | --- |
| VP / executive client services | agency and client-services leadership relevance |
| VP client experience / digital | digital and customer-experience leadership relevance |
| chief strategy / transformation | strategy and transformation executive relevance |
| VP growth / marketing | primary career-direction relevance |
| VP engineering | deliberate technical hard-exclusion control |

Use the active plan's permitted location, recency, department and portal filter
settings. Preserve the exact final portal URL and filter parameters per unit.
PDF, redirect/wrong-page, and sparse-document cases are observed and classified
when encountered; they are not manufactured by bypassing the normal validator.

## Live-run hard stops

Stop the run and do not promote the cohort for analysis if any of these occur:

1. A successful canonical ingestion lacks exactly one durable lineage record
   containing both canonical job and opportunity version IDs.
2. The recorded source/card identity does not match the identity supplied to
   canonical ingestion.
3. A duplicate lineage record, canonical opportunity, or canonical version is
   created for the same idempotent attempt.
4. A failed/redirected/wrong-page document reaches JobProjection or evaluation
   as if it were usable.
5. An unavailable evaluation has a persisted score or recommendation decision,
   or an evaluated artifact violates score/decision integrity.
6. The run writes outside its tenant/person scope, changes the active context,
   deletes legacy canonical records, or creates scrape-scoped serving behavior.

Portal transport failures, login challenges, or an empty page are not evidence
of a RADAR contract failure. Record them as unit outcomes, stop that unit, and
include them in the report without inventing jobs or retries beyond the cap.

## Required post-run evidence

The Phase 7B report must distinguish acquisition from suitability and include:

```text
planned units / executed units / stop reason
final portal URL and filters per executed unit
discovered cards
captured document states and validation outcomes
source card → canonical job → opportunity version lineage completeness
new versus reused canonical opportunities and versions
projection completeness and capability/evidence population
ELIGIBLE / REVIEW / INELIGIBLE distribution
EVALUATED / NOT_EVALUABLE / SPARSE_SPEC / acquisition-pending distribution
valid score and decision integrity checks
```

Manually inspect a bounded sample: at least ten validated documents where
available, plus every PDF, redirect/wrong-page, and unavailable case observed
within the cap. Compare the observed roles to the historical audit's role
families, not to unrecoverable historic vacancy identities.

## Gate boundaries

G1 permits the additive lineage migration, repository/service integration, and
offline tests. It does not permit portal interaction, production activation,
rematerialization, score or eligibility-policy changes, archive/quarantine
writes, or historical-corpus deletion.

Once G1 is green, G2 may run the bounded cohort described above without a
separate approval pause. G3 is the sole remaining hard production-change gate:
it is required before deployment, active-context mutation, or any production
recovery/activation decision.
