# Context Re-evaluation and Dossier Materialization

## Purpose

Create complete executive dossiers for opportunities only through a new immutable evaluation context. A successor context is a new evaluation result; it never rewrites an older score, verdict, fingerprint, review state, or user decision.

## Record meanings

- Historical context: retains the evaluation that was originally served. Existing user decisions remain attached to its original evaluation fingerprint and may become `STALE` when a successor becomes active.
- Successor context: binds the same explicit source search-plan cohort, the pinned candidate projection, and a new evaluation fingerprint. Every newly `EVALUATED` payload must include validated `dossier-v1` presentation data.
- Unavailable states: remain unavailable and must not receive invented dossier content.

## Controlled procedure

1. Resolve an authorized tenant/person scope and explicit active source plan.
2. Verify the exact source association count and that scraper/evaluation queues are quiescent.
3. Create a uniquely named `paused` successor context from that plan; do not activate it.
4. Materialize only the declared source plan into the successor. For each evaluated row, persist the evaluation-time `dossier-v1` presentation artifact together with the new canonical evaluation payload.
5. Verify source count, successor candidate count, materialization count, valid dossier count, and absence of contamination from other plans.
6. Review the successor before activation. Activation is a separate explicit operator action.

## Prohibitions

- Do not attach a dossier generated from a current engine replay to an old evaluation fingerprint.
- Do not overwrite historical `decision`, `quality_score`, evaluation fingerprint, review state, or user decision.
- Do not substitute the latest candidate profile for a context-pinned profile.
- Do not activate a successor that lacks complete materialization or valid dossier coverage for its evaluated rows.
