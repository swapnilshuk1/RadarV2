# Asynchronous factual review

The product serves validated PURSUE/CONSIDER memo drafts with an explicit pending
label. Gemini review is separate from scraping and evaluation. PASS has no memo.
The reviewer can repair prose, but cannot change the canonical verdict or a user
decision. Reviewed versions require complete content-bound receipts.

## Start and configure

Apply migration `052_dossier_review_queue.sql` through the normal migration runner
against the explicitly selected database. Then supervise this process independently
of the web server and evaluation worker:

```text
npm run worker:reviews
node --import tsx scripts/run-dossier-review-worker.ts --once
```

`--once` processes at most one due task; an empty or cooling lane makes no model
request. Starting a web server does not start review. Stop signals let the current
task finish; a forced termination is recovered after its three-minute lease expires.

- `RADAR_FACTUAL_REVIEW_PROVIDER=gemini` (default and currently installed adapter).
- `RADAR_FACTUAL_REVIEW_MODEL=gemini-3.8-flash` (default).
- `GCP_PROJECT_ID` plus normal Google ADC for Gemini. Token refresh has a 30-second application deadline.
- Existing Bedrock writer credentials for corrections, only when needed.
- `RADAR_GEMINI_CONTEXT_CACHE=off` disables explicit candidate-prefix caching.

The queue accepts any injected `ReasoningModel`; a new provider needs one adapter
and a factory registration. Unknown providers fail explicitly. There is no automatic
model fallback. Review receipts and checkpoint keys record the actual model and
configuration, so one model cannot reuse another model's assessment. Changing a
model setting does not establish that model's quality or enable its caching support.

## Lifecycle and retry

`pending -> processing -> completed`; transient provider failures use `retry`.
The shared database lease allows only one review task across worker processes.
The worker renews it every 30 seconds. Review requests and any bounded correction
calls reuse existing exact-request checkpoints after restart.

Provider backoff starts around 30 seconds, doubles with jitter and caps at five
minutes. A longer provider Retry-After is respected. Other jobs cannot bypass the
provider cooldown. A successful task resets the lane. Malformed/failed semantic
review, or provider failure persisting beyond a task age of 24 hours, moves it to
`needs_attention`; it is not silently retried forever. The process logs attention
counts and work older than one hour. The daemon must be monitored by its supervisor.

A source-linked adverse finding withholds the draft even if a subsequent correction
is throttled. The opportunity card remains, with a memo-unavailable message. A failed
review never overwrites a reviewed dossier. Saving the accepted revision, upgrading
an existing publication and completing its task occur in one lease-fenced transaction.
Shadow drafts remain shadow; this worker never changes active context pointers.

Useful SELECT-only diagnostic:

```sql
SELECT status, withheld, COUNT(*) AS jobs,
       MIN(created_at) AS oldest_created_epoch_ms,
       MIN(next_attempt_at) AS next_due_epoch_ms
FROM dossier_review_jobs GROUP BY status, withheld;
SELECT next_attempt_at, failures, lease_until FROM dossier_review_lane;
```

## Verification and release

The certification manifest covers draft composition without review, exact seeded
review without rewriting, 429 persistence, cross-process cooldown, restart leases,
late-worker rejection, atomic rollback, withholding, DTO labels and reviewed
promotion. Receipt validation for reviewed dossiers stays mandatory.

Prove a real draft/review on an isolated local database before deployment. Apply
the migration and start the supervised worker as part of an approved deployment;
merely deploying the web bundle will not drain this queue. This feature does not
enqueue historical backfill or alter the active context. Every memo still reviewed
incurs reviewer cost; asynchronous review primarily removes user-facing latency.
