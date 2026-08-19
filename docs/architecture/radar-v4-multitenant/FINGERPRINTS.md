# Fingerprint Specifications

## 1. Ontology Fingerprint (`ontology_fingerprint`)
* **Purpose**: Uniquely identifies the semantic extraction model used for an evaluation.
* **Composition**: Hash of (Canonical Ontology v3 Version + Tenant Ontology Configuration JSON).
* **Immutability**: Changing a tenant's config generates a new fingerprint, guaranteeing evaluation determinism.

## 2. Evaluation Context Fingerprint (`contextFingerprint`)
* **Purpose**: Identifies the exact immutable execution snapshot for an evaluation. *Note: EvaluationContext describes tenant/person/search/evaluation configuration, it does NOT include the opportunity/job version.*
* **Composition**: Hash of (`tenantId`, `personId`, `searchPlanSnapshotId`, `ontologyVersion`, `ontologyFingerprint`, `policyVersion`, `profileVersion`).
* **Immutability**: If the candidate's profile or the search plan changes, a new fingerprint is generated, allowing for safe re-evaluations.

## 3. Evaluation Identity
* **Purpose**: Absolute idempotency key for distributed evaluation workers. Binds the immutable `EvaluationContext` to a specific mutable `OpportunityVersion`.
* **Composition**: `canonical_job_id` + `opportunity_version` + `evaluation_context_fingerprint`.
* **Constraint**: `UNIQUE(canonical_job_id, opportunity_version, evaluation_context_fingerprint)`.

## 4. Opportunity Version Fingerprint (`opportunity_version`)
* **Purpose**: Tracks content changes for a stable job identity.
* **Composition**: Hash of the raw job description text and scraped metadata.
