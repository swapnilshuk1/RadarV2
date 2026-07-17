# The RADAR Constitution
**Version 1.0** — *Established July 2026*

This document codifies the permanent, non-negotiable architectural invariants of RADAR. Every contributor must read, understand, and preserve these principles across all future releases.

---

## 🎯 Definition of the Platform
> **RADAR is a governed, deterministic evidence-to-decision platform in which every career recommendation is a replayable interpretation of structured, audited knowledge derived from persistent, normalized evidence.**

---

## 📜 The Nine Permanent Invariants

1. **Preserve Source Before Interpretation**
   Original job description text is permanently normalized and persisted as Tier 1 source text. Extractors should remain replaceable and reproducible from this raw text at any point.

2. **Separate Descriptive Analytics From Prescriptive Governance**
   Observational statistics (heatmaps, trend curves) are descriptive; promotion decisions (adding terms to ontology) are prescriptive. Analytical patterns must never automatically modify the ontology.

3. **Evidence Precedes Capability**
   Capabilities are derived; they must map back with clear, explainable provenance to matched technologies and mined evidence. No capability may exist without direct evidence.

4. **Capability Precedes Recommendation**
   Opportunities are recommended based on structured fit against candidate capabilities, not raw keyword searches. Recommendation policies never interpret raw evidence directly.

5. **Knowledge is Versioned, Governed, and Lifecycled**
   Ontology entries progress through formal, deterministic states with clear rules for both promotion and retirement.

6. **All Recommendation Decisions are Replayable**
   Recommendation assessments are frozen in historical snapshots, allowing the platform to replay exactly what an executive saw at any given point in time.

7. **Every Semantic Assertion Has Provenance**
   Every matched condition contributing to a capability score must provide at least one valid, non-empty, cited evidence quote from the Tier 1 normalized corpus.

8. **Architecture Evolves Through ADRs**
   No new pipeline, reasoning engine, or semantic layer may be introduced without an approved Architectural Decision Record demonstrating that existing layers cannot express the concept.

9. **Knowledge Evolves Through Releases**
   Platform code is decoupled from curation. Code updates follow semantic versioning (SemVer), while knowledge and policy assets evolve via independent, weekly calendar snapshots.

---

## 🔀 Governance & Parallel Development Rule of Thumb
* **Parallelize Producers**: Corpus ingestion, ontology candidate proposals, user interfaces, analytics, and policy experiments.
* **Centralize Governors**: Canonical ontology approval, capability semantic definitions, recommendation contracts, and architectural ADRs.
