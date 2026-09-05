# RADAR Remediation Status

Baseline:
- base commit: `1f440e34f32fe06637596f5e48c2417f1bc19e19`
- branch: `remediation/01-auth-permission-non-escalation`
- certification status: baseline typecheck passed; the certification and build runners start but this terminal integration returns before their child-process completion status. The Gate 0 integrity suites pass (16 tests); the new authorization regression fails as expected against the confirmed defect.

## Completed
- Current branch head — Gate 0 safety coverage made mandatory; added the authorization permission non-escalation regression matrix.
- Current branch head — repaired Gate 0b test fixtures so evaluated-output assertions establish candidate, opportunity, and referential prerequisites.

## Current
- remediation ID: Gate 3 — feed and metrics truth (uncommitted)
- branch: `remediation/04-feed-metrics-truth`
- canonical population: active `search_plan_candidates` joined to active `opportunity_versions`, scoped by tenant, person, search plan, and current evaluation context. Its exact partition is `EVALUATED + SPARSE_SPEC + UNMATERIALIZED + PROFILE_REQUIRED + NOT_EVALUABLE + INVALID = TOTAL`; valid evaluated artifacts further partition exactly into engine `PURSUE + CONSIDER + PASS`.
- filters and ranking: content categories and decision filters apply before keyset pagination. `needs_more_signal` is derived only from `SPARSE_SPEC`, never persisted as a content category. Tiers are ordering-only and do not map unavailable/corrupt records to PASS.
- category projection: `opportunity_versions.category_ids` is a rebuildable JSON projection classified from canonical job title plus readable JD text at ingestion. Existing active versions must be repaired deterministically with `npx tsx scripts/backfill-opportunity-version-categories.ts`; this updates only rebuildable category IDs and leaves protected source documents, users, tenants, people, OAuth links, credentials, decisions, and evaluation artifacts untouched.
- metrics: engine, user, and effective breakdowns remain separate. `totalShortlisted` is engine `PURSUE + CONSIDER` only. `activePursuits` remains a deprecated compatibility field set to zero because RADAR has no approved active-pursuit lifecycle. The canonical integrity validator uses independently constructed canonical-scope queries and returns `UNAVAILABLE` for incomplete scope; it never falls back to historical evaluation or decision tables.
- validation: focused keyset, metrics, and dossier/navigation suites pass (3 files, 22 tests); TypeScript verification passes. External certification capture reports all seven stages and SSR build passing in 299.90 seconds.
- Gate 3 corrective closure: effective metrics now follow `userDecision ?? engineVerdict` directly; invalid/non-evaluated artifacts never enter engine, shortlist, or effective decision buckets. Integrity independently compares every state and engine-verdict bucket, not only partition totals. Feed, raw-feed, and navigation share the non-actionable tier for invalid/missing evaluations even when a user decision is retained. Dynamic `needs_more_signal` is included in category metrics for `SPARSE_SPEC` without persisting it as content membership.
- schema readiness: `npm run db:migrate` is the single supported migration lifecycle command; `npm run dev` runs it before Vite and deployment runs it after install but before build/restart. Missing database credentials fail startup visibly rather than allowing a stale schema to reach login. Migration runner coverage asserts migrations 037/038, their columns, and repeated-run idempotence.
- Gate 3 final corrective pass at `6a7f69a`: `evaluatedDecisions` now means decisions attached to genuinely valid evaluated artifacts only; `allRecordedDecisions` and `userBreakdown` include every retained canonical user decision regardless of evaluation availability. Effective metrics apply `userDecision ?? engineVerdict` for every state and use explicit `none` for no decision/no valid engine verdict rather than collapsing all unavailable states into sparse. Upgrade coverage starts at the real pre-037 migration set, applies 037/038 via the canonical runner, executes the fingerprint/category serving SQL, and verifies repeat-run idempotence.
- remediation ID: Gate 2 — canonical serving truth (final closure in progress; uncommitted)
- branch: `remediation/03-canonical-serving-truth`
- decision model: persisted engine verdict and explicit user action are separate; serving resolves `effectiveDecision = userDecision ?? engineVerdict`. Pagination/page size is presentation-only and cannot change either fact.
- evaluation validity: `NOT_EVALUABLE`/`PROFILE_REQUIRED`, `INVALID`, and `UNMATERIALIZED` remain distinct canonical states. Unsupported or malformed stored evaluation payloads are `INVALID`, never silently reclassified as a valid inability to evaluate.
- review provenance: `reviewedFingerprint` is retained and produces `UNREVIEWED`, `CURRENT`, `STALE`, or `UNKNOWN` from fingerprint equality without erasing a stale explicit user decision.
- provenance closure: `materialized_evaluations.evaluation_fingerprint` is the dedicated exact intrinsic `evaluationInputHash`; `evaluation_context_fingerprint` remains a separate context identity. Feed and dossier expose both, and review freshness compares only the former. The nullable migration deliberately leaves historical derived rows without a trustworthy artifact fingerprint `INVALID` until rematerialized; no derived-state reset was executed and protected `canonical_decisions.reviewed_fingerprint` rows were left untouched.
- persisted evaluation contract: the sole canonical evaluated artifact is `CanonicalEvaluatedPayloadV4_3` (`schemaVersion: v4.3-intrinsic`, `evaluationContractVersion: v4.3`), validated by `isCanonicalIntrinsicEvaluationV4_3`. The worker writes this JSON, materialization persists its exact `evaluationInputHash` scalar, and both feed/dossier accept only that contract for an evaluated artifact. The prior v4.2 intrinsic shape remains fixture/legacy-only and has no canonical serving caller.
- compatibility retirement: feed and dossier do not adapt non-canonical persisted evaluation payloads into advisory output; invalid derived artifacts require rematerialization.
- presentation closure: `/opportunity/$jobHash` and `/decisions` no longer import static candidate data or invoke capability, execution, or briefing engines in the browser. The dossier presents the canonical persisted evaluation only; Decisions loads `getDecidedOpportunitiesFn()` rather than the unreviewed shortlist path.
- final presentation authority closure: `/opportunity/$jobHash` always calls the scoped canonical dossier server function before rendering. `ClientOpportunityCache` cannot short-circuit authorization or replace persisted evaluation/decision truth. `/decisions` exhausts the decided keyset cursor rather than truncating at 50 records, and its browser-only `radar.opportunities.tracking.v1` pursuit workflow (tracking fields, drawer, and localStorage lifecycle) is removed pending a separately designed domain workflow.
- browser decision cache: decisions are mirrored only under an authenticated `tenantId:personId` cache scope. The retired global `radar.decisions.v1` cache and bulk browser-to-server synchronization path cannot transfer an unsynced browser decision into another authenticated account.
- decision hook lifecycle: canonical hydration now occurs once per mount; storage events consult only the resolved authenticated scope ref and cannot briefly clear UI state through a stale `scope = null` closure.
- performance follow-up: `OpportunityService.listForUser()` now performs canonical dossier hydration after its lean feed query (one feed query plus one dossier query per returned item). This is an intentional semantic-safety N+1 during Gate 2 and should be replaced by a bounded batch canonical-dossier projection in a later serving-performance unit; it is not hidden by synthetic feed DTOs.
- validation: Gate 2 provenance-closure focused suites pass (6 files, 49 tests), including feed/dossier parity, pagination, worker materialization, and inventory audit; standalone typecheck passes. `npm run certify` again started Stage 1 in the local harness, whose nested-child aggregate output remains unreliable; full-gate evidence requires an external aggregate capture.
- remediation ID: Gate 1 / Remediation 3 — identity and authority hardening
- branch: `remediation/02-identity-authority-hardening`
- candidate authority: confirmed and repaired. Worker and context materialization now produce `NOT_EVALUABLE` with no advisory score or verdict when the authoritative candidate projection is absent.
- evidence ownership: confirmed and repaired. Text-hash reuse is permitted only for the same person; identical content never transfers a candidate-owned evidence graph.
- OAuth scope: confirmed and repaired. The callback provisions person, user, active membership, tenant scope, and OAuth link transactionally before session creation.
- sensitive endpoints: run events resolve canonical run ownership before reading artifacts; process-local `live-scraped.json` is no longer served; corpus regeneration and status are admin-only.

## Storage architecture verification
- Large payload backend: BlobStore. Acquisition writes `snapshots/<cardHash>.json` before enqueueing enrichment; workers retrieve it by `payload_key`.
- Queue metadata backend: Turso `enrichment_jobs`, containing `payload_key`, snapshot reference, lifecycle, and provenance metadata—not aggregate snapshots or raw browser HTML.
- Canonical readable JD backend: `opportunity_versions.raw_content`, which stores extracted/readable opportunity text or normalized structured source used for evaluation; PDF/raw source material uses `source_payload_key` in BlobStore.
- live-scraped.json status: DEBUG/OPERATOR EXPORT ONLY. It is not a production serving or evaluation input; BlobStore staging remains authoritative for acquisition payloads.
- Artifact retention/cleanup: successful enrichment deletes the staged payload after canonical persistence; terminal artifacts are also eligible for bounded retention cleanup only when no active job shares the key.

## Blocked / Requires Decision
- This terminal integration does not retain final output/exit status for nested `npm run certify` or `npm run build` child processes. An external run is required to distinguish an application hang from the runner defect.

## Deferred
- Gate 1 remediations 1 and 3 through 5 remain deferred pending external review of this isolated authorization change.
