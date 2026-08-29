# FOR-0 Immutable Turso Production Forensic Snapshot

## Snapshot Metadata
- **Snapshot ID**: `turso_snapshot_20260829005309`
- **SQLite Snapshot File**: `radar-turso-snapshot-2026-08-29.sqlite`
- **File Size**: 108.32 MB (113577984 bytes)
- **Source Database**: `Turso Cloud (LibSQL)` (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`)
- **Environment**: `dev`
- **Extraction Started At**: `2026-08-29T00:52:05.406Z`
- **Extraction Completed At**: `2026-08-29T00:53:09.043Z`
- **Overall Snapshot Hash**: `06c54a65a4a95425c73dc282579f4de538518179c7544690e81cd09f361ee5f5`
- **Consistency Status**: `SNAPSHOT CONSISTENT`
- **Local Fidelity Verification**: `100% PASSED`
- **Foreign Key Violations**: `0`

## Read-Only Safety Guarantees
- **Production Turso Mutations**: **0**
- **Application State Mutations**: **0**
- **LocalStorage Mutations**: **0**
- **Remediation Executed**: **NONE**
- **Execution Guard**: Fail-closed assertReadOnlySql check enabled on all database queries.

## Captured Tables & Row Counts

| Table Name | Turso Row Count | Snapshot Row Count | Schema Match | Content Hash Match | Status |
| :--- | ---: | ---: | :---: | :---: | :--- |
| `_migrations` | 29 | 29 | YES | MATCH | PASSED |
| `_test_contract` | 2 | 2 | YES | MATCH | PASSED |
| `acquisition_ledger` | 632 | 632 | YES | MATCH | PASSED |
| `active_evaluation_contexts` | 0 | 0 | YES | MATCH | PASSED |
| `assessment_records` | 0 | 0 | YES | MATCH | PASSED |
| `assessments` | 0 | 0 | YES | MATCH | PASSED |
| `auth_sessions` | 35 | 35 | YES | MATCH | PASSED |
| `calibration_runs` | 6 | 6 | YES | MATCH | PASSED |
| `candidate_documents` | 2 | 2 | YES | MATCH | PASSED |
| `candidate_evaluations` | 0 | 0 | YES | MATCH | PASSED |
| `candidate_projection` | 2 | 2 | YES | MATCH | PASSED |
| `canonical_decisions` | 0 | 0 | YES | MATCH | PASSED |
| `canonical_opportunities` | 632 | 632 | YES | MATCH | PASSED |
| `career_intents` | 0 | 0 | YES | MATCH | PASSED |
| `career_profiles` | 7 | 7 | YES | MATCH | PASSED |
| `claim_facts` | 0 | 0 | YES | MATCH | PASSED |
| `claims` | 0 | 0 | YES | MATCH | PASSED |
| `companies` | 2010 | 2010 | YES | MATCH | PASSED |
| `credential_audit_logs` | 0 | 0 | YES | MATCH | PASSED |
| `decisions` | 0 | 0 | YES | MATCH | PASSED |
| `document_contents` | 0 | 0 | YES | MATCH | PASSED |
| `documents` | 269 | 269 | YES | MATCH | PASSED |
| `dossier_views` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_evidence_clusters` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_evidence_provenance` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_knowledge_debt` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_pipeline_candidate_capabilities` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_pipeline_proposals` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_pipeline_raw_observations` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_published_aliases` | 113 | 113 | YES | MATCH | PASSED |
| `ekb_published_capabilities` | 19 | 19 | YES | MATCH | PASSED |
| `ekb_published_capability_graph` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_published_embeddings` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_published_mobility_graph` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_published_platform_graph` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_published_relationships` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_published_versions` | 1 | 1 | YES | MATCH | PASSED |
| `ekb_release_candidates` | 0 | 0 | YES | MATCH | PASSED |
| `ekb_temporal_evidence` | 0 | 0 | YES | MATCH | PASSED |
| `evaluation_context_scopes` | 0 | 0 | YES | MATCH | PASSED |
| `evaluation_contexts` | 15 | 15 | YES | MATCH | PASSED |
| `evaluation_jobs` | 3204 | 3204 | YES | MATCH | PASSED |
| `evaluation_signatures` | 0 | 0 | YES | MATCH | PASSED |
| `evidence` | 599 | 599 | YES | MATCH | PASSED |
| `evidence_graphs` | 2 | 2 | YES | MATCH | PASSED |
| `fact_evidence` | 593 | 593 | YES | MATCH | PASSED |
| `facts` | 593 | 593 | YES | MATCH | PASSED |
| `intent` | 3 | 3 | YES | MATCH | PASSED |
| `match_claims` | 0 | 0 | YES | MATCH | PASSED |
| `matches` | 0 | 0 | YES | MATCH | PASSED |
| `materialized_evaluations` | 3201 | 3201 | YES | MATCH | PASSED |
| `memberships` | 4 | 4 | YES | MATCH | PASSED |
| `oauth_accounts` | 1 | 1 | YES | MATCH | PASSED |
| `opportunities` | 895 | 895 | YES | MATCH | PASSED |
| `opportunity_discoveries` | 258 | 258 | YES | MATCH | PASSED |
| `opportunity_versions` | 632 | 632 | YES | MATCH | PASSED |
| `people` | 9 | 9 | YES | MATCH | PASSED |
| `policy_comparisons` | 6 | 6 | YES | MATCH | PASSED |
| `preference_profiles` | 0 | 0 | YES | MATCH | PASSED |
| `recommendation_snapshots` | 0 | 0 | YES | MATCH | PASSED |
| `recommendations` | 0 | 0 | YES | MATCH | PASSED |
| `recovery_queue` | 6 | 6 | YES | MATCH | PASSED |
| `resume_versions` | 0 | 0 | YES | MATCH | PASSED |
| `search_plan_candidates` | 4424 | 4424 | YES | MATCH | PASSED |
| `search_plan_snapshots` | 15 | 15 | YES | MATCH | PASSED |
| `search_plans` | 8 | 8 | YES | MATCH | PASSED |
| `source_credentials` | 0 | 0 | YES | MATCH | PASSED |
| `sources` | 3 | 3 | YES | MATCH | PASSED |
| `tenants` | 8 | 8 | YES | MATCH | PASSED |
| `timeline_events` | 0 | 0 | YES | MATCH | PASSED |
| `users` | 3 | 3 | YES | MATCH | PASSED |
| `workspaces` | 0 | 0 | YES | MATCH | PASSED |

## Extraction & Verification Commands
```bash
# Run read-only snapshot extraction script
npx tsx scripts/forensics/export-turso-snapshot.ts

# Verify local SQLite snapshot
npx tsx -e "const DB = require('better-sqlite3'); const db = new DB('forensics/radar-turso-snapshot-2026-08-29.sqlite'); console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all());"
```

## Statement of Certification
This snapshot was extracted using 100% read-only SQL queries (`SELECT` and schema introspection) against the live production Turso Cloud database. No data, schema, state, or application code was modified during this operation.
