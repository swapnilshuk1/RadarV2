# Architectural Decisions (ADRs)

## ADR 1: Strict Authentication & Resource Scoping
**Decision**: Separate Authentication (Who is calling?) from Resource Scope (What can they operate on?).
**Rationale**: A `personId` must never enter an execution context without cryptographic or middleware proof that it belongs to the authorized tenant via an `AuthContext`.

## ADR 2: Canonical Ontology vs. Tenant Configuration
**Decision**: Ontology remains Canonical. Tenants provide Configuration.
**Rationale**: 
- Canonical Ontology v3 defines the universe of concepts RADAR understands globally.
- Tenant Configuration defines what semantic concepts matter to a specific tenant.
- An Ontology Compiler merges the two into a Compiled Executable Extraction Model.

## ADR 3: Global Acquisition, Local Evaluation
**Decision**: Jobs are scraped once globally, evaluated locally per tenant.
**Rationale**: Scraping is expensive and rate-limited. Global acquisition deduplicates scraping efforts. 

## ADR 4: Stable Job Identity
**Decision**: `canonical_job_id` is deterministically derived from stable source identity, never content.
**Rationale**: If a job's text changes, it creates a new `opportunity_version`, but its root identity remains stable for tracking.

## M4.1 Relational Integrity Remediation
**Context**: During the initial implementation of the M4.1 search_plan_candidates schema, the relational model enforced foreign keys independently: canonical_job_id matched a valid job, and opportunity_version matched a valid version, but did not enforce that the version belonged to that job. Similarly, the ownership hierarchy (tenant_id, person_id, search_plan_id) was not structurally bound.
**Decision**: We introduced composite index boundaries (idx_people_tenant_lineage, idx_search_plans_lineage) and a unique opportunity constraint UNIQUE(canonical_job_id, id). The search_plan_candidates table now enforces composite foreign keys.
**Result**: A tenant projection cannot cross ownership boundaries or link a job to another job's version at the database level, strictly enforcing the M4 isolated projection contract.
