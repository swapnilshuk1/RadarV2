# Staged intelligence integration and backfill

The v6 evaluator produces immutable decisions. Rich dossier composition consumes those decisions separately. `StagedServingPublisher` publishes a matching, validated dossier into the existing serving projection with state `STAGED_EVALUATED` and no invented numeric score. Publication does not change the active context or canonical user decisions. The active pointer is still the sole serving authority.

Once the v6 context is active, normal acquisition binds new evaluation requirements to it. Exact enrichment completion releases those requirements into the staged queue. The evaluation worker renews its lease during long model calls, persists the decision, composes its dossier, publishes it, and completes the obligation. Shadow evaluations continue to stop at staged persistence.

The Scraped jobs page reads the authorized active search directly. It shows waiting analysis, active analysis, dossier preparation, failures, ready dossiers (including PASS), and outside-search roles. Unadmitted captures with retained ingestion lineage are counted separately. A failed rich presentation attempt is retained under a separate unavailable presentation version; successful retries take precedence in the visible status. Unattributed historical blobs are not assumed to belong to an account.

## Operational identities

- Context: `6b278ba4743cdaacf692e4eb24425b24743856ca6f984d73dda5e10723c41c30`
- Policy / contract: `staged-v6` / `staged-decision-v6`
- Candidate profile: `projection-8acff2997f98e0d6418d8b01c5244128a6b9d6aa61232a5e791afd6210fea8e4`
- Tenant / person: `tenant_default` / `ms6i7e3y-4x0chy5fy`
- Search plan: `sp_d1a6e78e-b4a8-4883-9817-918bb9757c9b`
- Previous active context (rollback target): `12bfb09a2a5d437b971972a2caae50cb27fe816b043741601e448cc613621ec8`
- Known navigation-only source version: `c1f869396405acf0c7c3eba98104d52a7d6b2eaa1b928d364cfc866a8bca564f`

The inventory on 17 September 2026 contained 401 eligible active versions: 352 had exact completed enrichment and 49 had no exact enrichment job. Sixteen contained the same navigation-only capture; this overlaps the enrichment counts. The initial v6 shadow had 46 completed, one dead letter, and ten waiting jobs with failed missing-enrichment requirements. These are inventory observations, not hardcoded acceptance thresholds.

## Bounded, resumable operation

Use the context above wherever `<context>` appears. Run recovery on the enrichment worker host: this deployment uses a local filesystem BlobStore. Do not write a payload on a different computer and assume the worker can read it.

1. `scripts/recover-missing-enrichment.ts --context=<context> --limit=50 --exclude-source-version=<known navigation source>` previews missing dependencies. With `--execute --worker-host=<actual hostname>`, it reconstructs an immutable payload from hash-verified canonical source text and enqueues normal enrichment. It does not claim a new network acquisition or fabricate enrichment completion.
2. After enrichment completes, the same command with `--execute --worker-host=<hostname> --release-completed` explicitly reopens only `FAILED / MISSING_ENRICHMENT_JOB` requirements whose exact dependency is now complete and which have no staged evaluation. The previous failure and job state are recorded in `enrichment_events` in the same transaction. Ordinary release/reconciliation does not resurrect terminal failures.
3. `scripts/backfill-staged-evaluations.ts --ready-only --exclude-source-version <known navigation source> --limit 500 --person-id <person> --profile-version <profile>` enqueues only previously unscheduled eligible versions. `--dry-run` previews selection. Completed, queued and terminal work are skipped.
4. `scripts/process-staged-evaluation-jobs.ts --context=<context> --max-jobs=500 --watch` drains that staged context, including scheduled retries. It stops when no pending/processing work remains or the bound is reached. Multiple workers use the existing database leases; each renews its own lease.
5. `scripts/compose-staged-dossiers.ts --context=<context> --limit=500 --publish` prepares and publishes completed evaluations without activation. Optional `--shards=2 --shard=0` and `--shard=1` partition a batch without overlapping selection. `--job=<canonical ID>` selects a specific dossier. `--publish-only` publishes already composed dossiers with no model calls. Failures are logged and do not stop other selected rows; the command exits nonzero if any failed. Repeating it skips completed publication.

Run TypeScript, the production build, and the current certification manifest before release. Build on Linux for the Linux host; Windows output contains Windows native dependencies. Keep web, enrichment and evaluation workers on the same release, with shared existing artifact/profile paths. Keep credentials outside Git.

Before activation, verify representative rendered PURSUE and PASS dossiers, exact context/profile/source binding, prepared serving coverage, metrics, and unchanged canonical user decisions. Activate only the explicitly bound context. Rollback restores the previous pointer and previous PM2 release; staged results and presentation audit records remain intact.

## Boundaries and remaining coverage

The v6 frozen production adapter contains JD and candidate evidence. Its existing role/company resolutions remain authoritative for this rollout; the separate context-provider acquisition capability has not been incorporated into the v6 input fingerprint. Do not claim that these dossiers used newly acquired external company research. Adding decision-bearing external context requires a separately identified evaluator context.

Navigation-only captures require reacquisition through the established scraper. They are not candidate evidence and are excluded from this backfill by byte equality with the explicitly inspected source version, not by a new English classifier. An empty model extraction is recorded as unavailable after bounded local repair.

The old v5 screening materializer, quote-copying fixture adapter, semantic regex validators, helper and prompt were removed from the production modules. The permanent semantic laboratory/corpus and persisted v4/v5 audit data remain. The old one-shot differential is retained as historical documentation under `docs/rebuild/archive/`.

Additional historical suites outside the certification manifest still contain obsolete acquisition-scope and portal-profile expectations (`gate3-distributed-lifecycle` and three profile cases in `post-gate3-acquisition-integrity`). Their failures occur in unchanged scope/profile code, before the new queue behavior. Do not describe those suites as passing or use their legacy assumptions to weaken current scope isolation.
