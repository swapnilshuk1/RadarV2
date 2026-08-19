# Entity State Machines

## 1. Tenant Lifecycle
* `provisioning`: Resources are being allocated.
* `active`: Normal operations.
* `suspended`: Blocks jobs, drains queues, revokes credentials.
* `deleted`: Hard-deleted or tombstoned.

## 2. Credential State Machine
* `active`: Credential is valid and in use by the broker.
* `revoked`: Credential has been invalidated or expired.

## 3. ScrapeJob (Acquisition)
* `pending`: Queued for global acquisition.
* `running`: Actively being scraped by stealth worker.
* `completed`: Data acquired and global `opportunity_version` created.
* `failed`: Acquisition failed (e.g. rate limit, proxy error).

## 4. EvaluationJob (Contextual Evaluation)
* `pending`: Waiting for evaluation worker.
* `processing`: Context resolved, policy engine running.
* `completed`: Materialized evaluation saved to DB.
* `failed`: Unrecoverable integrity or execution error.

## 5. Evaluation
* `evaluating`: In progress (transient).
* `actionable`: Successfully evaluated, surfaced to user (e.g., PURSUE, CONSIDER, PASS).
* `not_evaluable`: Sparse spec, missing data.
