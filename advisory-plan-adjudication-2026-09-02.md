# Adjudication of Advisory Review — RADAR v2 Remediation Plan

Date: 02 Sep 2026

## Important observation

The supplied advisory attachment reproduces the current `implementation-plan-release-block-remediation-v2-2026-09-02.md`. It does not introduce a distinct set of new recommendations. The adjudication below therefore validates and refines the v2 plan against the audited code and operating constraints.

## Decisions

| Plan element | Decision | Rationale |
|---|---|---|
| Prioritize editorial correctness and tenant safety | **Accept** | These are user-visible/security risks on active production paths and do not require new infrastructure. |
| Keep Turso authoritative | **Accept** | Prevents reconciliation and backup complexity from a second production database. |
| Measure capacity before storage redesign | **Accept** | Large text usage depends on bytes/pages, scans, and write frequency, not row count alone. |
| Single-host local artifact spool | **Accept with constraints** | Practical for the current deployment, but must be explicitly bounded, retained, monitored, and never treated as canonical state. It must also be reconciled with the repository rule prohibiting persistent application files. |
| Remote BlobStore only for distributed mode | **Accept** | Avoids paying infrastructure cost before a second host/worker exists while preserving a clear distributed contract. |
| Targeted `any` remediation | **Accept** | Focuses effort where casts cross evaluation, serving, editorial, repository, or persisted-JSON boundaries. Repository-wide cleanup has poor release ROI. |
| Typed `Observed/Derived/Inferred/Unknown` model | **Modify** | Use a small discriminated union at active boundaries; do not build a broad ontology framework or migrate every historical payload before the release blockers are fixed. |
| Four evaluation states | **Accept with compatibility adapter** | Required to distinguish missing scores from evaluated scores. Read existing records through a decoder and preserve unknown legacy states. |
| One editorial evidence guard | **Accept** | Multiple direct composition paths are the root of the current failure. The guard must return usable sparse UI, not throw or blank the page. |
| Remove/quarantine duplicate server API | **Accept** | `server-api.ts` is an exported unscoped alternate path. Quarantine first; delete only after import/build verification. |
| Move all raw SQL immediately | **Narrow** | First move SQL out of active server/serving/security paths. Defer low-risk worker/diagnostic rewrites until parity tests exist. |
| Enable SQLite FKs and fail migration errors | **Accept with test classification** | Correct for contract tests. Deliberately FK-off tests, if any, must be isolated and explicitly named rather than silently changed. |
| Full SQLite/Turso transaction redesign | **Defer** | No demonstrated current incident; investigate only if active workflows use nested transactions or parity tests fail. |
| Pattern diversity as optional | **Accept** | The audit proves non-enforcement, not user harm. Treat it as a product decision, not an automatic release blocker. |
| Broad UI token cleanup and Markdown work | **Defer** | Quality debt, but lower risk than evidence, scope, and persistence failures. |

## Required refinements to the v2 plan

### 1. Make deployment mode an explicit enum

The current implementation effectively treats any non-`distributed` value as local. The plan should require an explicit value such as `single_host` or `distributed`, reject unknown values, and report the effective backend. This fixes mode ambiguity without forcing remote storage on the current host.

### 2. Define the local spool as disposable and bounded

The plan should specify:

- maximum artifact bytes and file count;
- retention duration;
- cleanup cadence and failure telemetry;
- no serving dependency on the artifacts;
- no user decisions or canonical lineage stored only there.

If the product requires replay after host loss, that is a separate remote-durability decision—not a reason to make local SQLite canonical.

### 3. Put a lightweight guard before a large type migration

Phase 1 should first add the minimum state/provenance discriminants needed by the editorial and evaluation paths. Prove behavior with adversarial tests. Expand types only where a real `any` cast still permits a contract violation. This prevents a type-system rewrite from delaying the user-visible fix.

### 4. Separate data-shape compatibility from behavior changes

Existing persisted JSON and database rows must be decoded into the new state types without rewriting the corpus. Unknown or malformed records should render as `UNAVAILABLE` and remain inspectable. Do not backfill guessed provenance.

### 5. Add a “no quota starvation” acceptance test

The capacity phase should verify that raw-artifact pressure cannot starve decisions, canonical identity, or serving. Nonessential artifact writes may be rejected or sampled when thresholds are reached; canonical writes must remain prioritized.

## Revised release-block list

The following remain non-negotiable:

1. Sparse/unevaluated editorial output is evidence-limited and safe.
2. Missing scores and title heuristics cannot become factual certainty.
3. Active serving paths are tenant/person scoped.
4. The duplicate unscoped API is unreachable or removed.
5. Certification assertions fail closed.
6. Tests enforce relevant FK and migration behavior.
7. Deployment mode is explicit; distributed mode cannot silently use local storage.
8. Turso remains canonical and decisions do not depend on raw artifacts.
9. Adversarial tests cover the failure modes above.

Pattern diversity, complete transaction redesign, broad `any` cleanup, remote object storage for single-host operation, and UI polish remain conditional follow-up work.

## Final adjudication

The v2 plan is approved as the basis for implementation, with the refinements above. The advisory’s central suggestions are accepted because they reduce scope and match the actual product constraints. Suggestions that would turn the work into a repository-wide type rewrite, mandatory object-storage migration, or full distributed architecture are rejected as premature unless measurement or an incident creates a trigger.

