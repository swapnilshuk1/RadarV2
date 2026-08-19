# V4 Multi-Tenant RADAR Migration: Handover & Governance

## 1. Why This Migration Exists
The RADAR system is evolving from a single-user architecture to a Multi-Tenant platform (V4). This migration enables isolated, multi-user executive job intelligence while preserving the canonical evaluation engine. The core challenge is tenantizing configuration and context without fragmenting the global intelligence semantics.

## 2. Non-Negotiable Invariants
1. **Zero State Bleed**: No tenant-specific state may influence another tenant's evaluation.
2. **Canonical Policy Supremacy**: Tenant-specific configuration may specialize inputs and context, but cannot alter canonical RADAR policy semantics or fork the decision logic.
3. **Immutability of Evaluation**: One canonical opportunity version evaluated under one immutable evaluation context produces exactly one materialized evaluation.
4. **Separation of Acquisition and Evaluation**: Jobs are scraped once globally, but evaluated *N* times locally.

## 3. Forbidden Shortcuts
* **No opportunistic refactoring:** Do not clean up unrelated V4 code. If it isn't strictly required by the M0–M8 contract, do not touch it.
* **No phase jumping:** Strict phase locks. Phase `M(N+1)` cannot start until `M(N)` is mechanically certified.
* **No subjective exit gates:** "Looks good" is not acceptable. Every phase requires deterministic tests, schema inspection, and negative tests.
* **No changing the golden fixtures:** The existing V4 evaluation corpus is the golden regression suite. Do not modify golden fixtures to make failing tests pass.
* **No destructive migrations:** Expand → dual/read-compatible → verify → switch → contract. Never `DROP` or `ALTER` destructively without a verified rollback plan.

## 4. Current Phase Lock (Checkpoints)
- **M1 - M3**: COMPLETED & FULLY CERTIFIED.
- **M4 (Canonical Acquisition & Gating)**: 
  - **M4.1**: `020_canonical_acquisition.sql` remediated. Composite ownership limits (tenant/person/plan) and version matching (job/version) mechanically tested via negative valid-but-cross-lineage bounds. M4.1 is COMPLETED WITH REMEDIATION.
  - **M4.2**: Deterministic `canonical_job_id` and `opportunity_version` implemented. M4.2 is COMPLETED.
  - **STOP**: Do not proceed to M4.3 without explicit phase-gate certification.
