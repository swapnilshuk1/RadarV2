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

10. **Universal Extraction Protocol**
    All extractors emit only unified `ExtractionEvidence`. No extractor may communicate directly with the Capability Engine through a custom or ad-hoc interface. This guarantees complete decoupling and preserves the repeatability and replaceability of our matching models.

11. **The Four-Layer Epistemological Judgment Pipeline**
    To construct, calibrate, and govern executive judgment under uncertainty, all decision paths in RADAR must process knowledge sequentially through four explicit, isolated layers:
    * **Observed Facts**: Verifiable, black-and-white statements extracted directly from Tier 1 source text.
    * **Semantic Interpretation**: Understanding what those facts mean within context.
    * **Calibrated Inference**: Clearly labeled assumptions with quantified uncertainty.
    * **Governance Policy**: Deterministic rules that transform calibrated evidence into consistent recommendations.
    No extractor or model may bypass these layers to make direct, uncalibrated, or unexplainable recommendations. This guarantees complete auditability, extensibility, and resistance to model drift.

12. **Decision Confidence Invariant (The Minimal Fact Rule)**
    Every opportunity recommendation must be accompanied by the smallest set of additional facts that would materially improve the decision. This invariant drives calibration, prioritization, evidence acquisition, UI design, crawler behavior, and executive workflow.

13. **The Core Product Principle of RADAR**
    The platform does not seek to answer "Is this a good job?" It seeks to answer: *"Do I have enough reliable evidence to confidently invest my limited executive time in this opportunity?"* Every optimization, UI component, and model calibration must prioritize maximizing **Executive Time Saved Per Correct Decision**.

14. **Uncertainty Separation Invariant (Immutable Evidence, Calibrated Confidence)**
    Evidence calibration influences confidence, not facts. Observed and inferred statements remain stored as immutable evidence records in the database; what changes under calibration is solely the decision weight assigned to them based on their validation status. Facts remain quiet; uncertainty becomes visible only when it matters.



---

## 🔀 Governance & Parallel Development Rule of Thumb
* **Parallelize Producers**: Corpus ingestion, ontology candidate proposals, user interfaces, analytics, and policy experiments.
* **Centralize Governors**: Canonical ontology approval, capability semantic definitions, recommendation contracts, and architectural ADRs.
