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
