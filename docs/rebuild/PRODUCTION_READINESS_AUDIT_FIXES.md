# Production-readiness audit fixes

The release candidate uses **staged-v8 / staged-decision-v8**, **dossier-v3.7**,
and **editorial-facts-v2**. Historical evaluation data is preserved. No production
deployment, backfill or context activation is part of this change.

## Closed code gaps

- Current dossier storage, publication and readiness require a complete set of
  application-created factual-review receipts. Receipts bind each section's exact
  content and sentence IDs to its frozen input, evidence, sources, candidate
  conflicts, reviewer and review policy. Missing, duplicate, incomplete or stale
  receipts fail closed. Persisted v3.6 rows cannot bypass this check.
- Google authentication uses `google-auth-library` ADC discovery and refresh,
  including local users, service-account credentials, workload identity federation
  and metadata identities. Deployment credentials and IAM permissions still need
  to be configured for the actual runtime.
- Migration `051_dossier_model_checkpoints.sql` adds a durable model-response
  cache. Plans, section proposals, repairs and reviews resume across process
  restarts. The scope includes exact evaluation identity, composition/review
  recipe and both models' configurations; each request also includes its prompt,
  input and schema. Validators run on every reuse. Provider failures are not
  cached; malformed reviewer responses are discarded so retries can recover.
- Factual review receives cited claims and their complete ancestry, source
  metadata and unresolved candidate conflicts. It no longer receives the entire
  unrelated evidence catalog for each section. Missing support returns to the
  composer, which retains the full evidence corpus. Review coverage errors retry
  the reviewer without rewriting valid prose.
- Missing Tavily configuration and search/provider failures pause fresh work
  before freezing a snapshot. A successful search with no results is `NO_RESULTS`;
  retrieved evidence is `RETRIEVED`, not proof that each requested field was
  answered. Field resolution remains a separate model stage.
- The v8 context fingerprint includes the immutable acquisition recipe. Fresh
  input and rollout readiness check compatibility with that fingerprint.
  Candidate conflicts are also carried into context resolution, career-capital
  adjudication and final reasoning under v8.
- New serving projections bind their presentation version. Historical v3.4/v3.5
  projections remain readable by exact evaluation fingerprint. Backfill selection
  and readiness validate the canonical evaluation, dossier, factual reviews,
  decision trace and serving projection instead of trusting JSON self-agreement.

## Compatibility and operations

Apply migration 051 to the approved target before running dossier composition.
Existing v6 behavior and frozen v7 inputs remain readable. Fresh v7 acquisition
pauses rather than silently adopting the changed acquisition policy; prepare a
new v8 context for new evaluations. Existing historical serving pointers are
not automatically changed. Current rollout readiness requires an operational
search receipt in each eligible input, valid current dossiers/publications,
zero unprepared work and zero pending/processing work.

Malformed current-version presentation rows remain unavailable; composition does
not overwrite immutable historical presentation evidence to hide corruption.
Operational inspection is required for such rows.

## Validation

- Local full certification: TypeScript and production build passed; 65 test files,
  605 tests passed. A subsequent acquisition-fingerprint compatibility guard passed
  typecheck and the two affected files (26 tests). CI validates the final commit.
- Regression coverage includes process-cache loss after a late reviewer 429,
  durable reuse of accepted work, malformed-review recovery, standard ADC
  credential types, scoped evidence packets, review-receipt rejection, historical
  serving, context readiness, and DTO-to-both-DossierView-template rendering.
- One real ADC/Gemini 3.8 Flash capability probe passed. The new reviewer correctly
  rejected the known unsupported "40 direct reports" claim. The next semantic
  case returned HTTP 429; subsequent live model calls were stopped. The remaining
  semantic cases and a complete real v3.7 dossier remain operationally unverified.
- Offline measurement over 19 saved production review requests reduced input JSON
  from 651,626 to 209,714 characters (68%). This excludes system instructions and
  does not claim an equivalent billed-token reduction.

Local diagnostic artifacts are retained under `.radar/audit-fixes-20260919/`;
the local certification log is `.radar/local-review/certification-audit-fixes.log`.
These contain no credentials and are not release inputs. Production rollout still
requires runtime credentials/quota, an approved v8 population, complete reviewed
dossiers and separate activation approval.
