# PHASE 6C PRODUCTION OBSERVABILITY CONTRACT

============================================================
RADAR V4 EXECUTIVE OBSERVABILITY CONSTITUTION
============================================================

This document defines the permanent, constitutional observability requirements, telemetry contracts, alert thresholds, and multi-population invariants for the RADAR V4 Semantic Intelligence Engine.

---

## 1. Multi-Population Invariants & Boundaries

To prevent metric conflation, all evaluation and calibration metrics MUST declare and adhere to strictly segregated population boundaries:

1. **PRODUCTION POPULATION (\`populationType: "PRODUCTION"\`)**:
   - Live scraped opportunities stored in the canonical Turso Cloud LibSQL database.
   - Current scale: \`2,233\` opportunities.
   - Invariant: Production score-delta metrics MUST NEVER aggregate or include Golden fixtures.

2. **GOLDEN / FIXTURE POPULATION (\`populationType: "GOLDEN_FIXTURE"\`)**:
   - Curated executive benchmark test fixtures (e.g., \`j-bmw-india-cmo\`, \`j-vml-cmo\`, \`j-tcs-cxo\`).
   - Purpose: Controlled functional recovery verification (e.g., intentional \`+11.0\` recovery for \`j-bmw-india-cmo\` from 71 \`CONSIDER\` to 82 \`PURSUE\`).
   - Invariant: Fixture recoveries MUST NEVER be treated as production incidents or score drift.

3. **OFFLINE / SHADOW POPULATION (\`populationType: "OFFLINE_SHADOW"\`)**:
   - Synthetic candidate evaluations and offline regression mutations.

$$\\text{PRODUCTION} \\neq \\text{GOLDEN\\_FIXTURE} \\neq \\text{OFFLINE\\_SHADOW}$$

---

## 2. Telemetry Terminology & Reconciliation Standard

To avoid ambiguous labeling (e.g., calling all resolved matches "enriched"), the system establishes explicit first-class metric terminology:

- **\`semanticEvidenceDetectedCount\`**: Opportunities where $\\ge 1$ structured semantic evidence entity was extracted from the role/JD.
- **\`semanticSatisfyingCount\`**: Opportunities where extracted evidence successfully satisfies at least one role capability requirement.
- **\`semanticScoringEligibleCount\`**: Opportunities where evidence satisfies confidence ($\\ge 0.75$), temporal (CURRENT), and non-negated qualification criteria.
- **\`semanticScoreChangedCount\`**: Opportunities where semantic evidence produced a non-zero final score delta ($\\Delta \\neq 0$).
- **\`semanticScoreIncreaseCount\`**: Opportunities where $\\Delta > 0$.
- **\`semanticScoreDecreaseCount\`**: Opportunities where $\\Delta < 0$.
- **\`semanticNoOpCount\`**: Opportunities where valid semantic evidence was extracted and confirmed baseline fit, but produced zero score delta ($\\Delta = 0$).
- **\`noSemanticEvidenceCount\`**: Opportunities where no semantic evidence was detected.

### The Canonical Reconciliation Identity:

$$\\text{Total Opportunities} = \\text{ScoreChanged} + \\text{SemanticNoOp} + \\text{NoSemanticEvidence}$$

---

## 3. Polysemous Token Lifecycle & False Positive Zero Invariant

All high-risk polysemous tokens (\`target\`, \`apple\`, \`amazon\`, \`shell\`, \`meta\`, \`gm\`, \`md\`, \`lead\`, \`head\`, \`executive\`, \`manager\`, \`director\`, \`account\`, \`enterprise\`) must be processed through the 6-stage lifecycle:

$$\\text{RAW\\_DETECTION} \\rightarrow \\text{CONTEXTUALLY\\_RESOLVED} \\rightarrow \\text{QUARANTINED} \\rightarrow \\text{NON\\_SATISFYING} \\rightarrow \\text{SATISFYING} \\rightarrow \\text{SCORING\\_ELIGIBLE}$$

### Permanent Invariants:
1. $\\text{RAW\\_DETECTION} \\neq \\text{SEMANTIC\\_SATISFACTION}$
2. Any entity classified under \`falsePositiveClassification\` MUST NEVER transition to \`scoringEligible\` or \`actuallyScored\`.
3. Permanent assertion: \`falsePositiveScoringEscapes === 0\`.

---

## 4. Operational Telemetry & Latency Provenance

- **Database Storage Latency**: If database query latency is not instrumented in storage, it MUST be reported as:
  \`PRODUCTION LATENCY: NOT INSTRUMENTED IN TURSO STORAGE\`
- **Local CPU Benchmark Speed**: Must ALWAYS be labeled as:
  \`OFFLINE LOCAL BENCHMARK TIMING\` (never conflated with cloud database query round-trip time).
- **User & Queue Audit History**: If audit logs are uninstrumented in Turso, report:
  \`USER-MUTATION AUDITABILITY: NOT INSTRUMENTED\`.

---

## 5. Alert Thresholds & Escalation Matrix

| Level | Condition | Required Action |
| :--- | :--- | :--- |
| **P0 (Critical)** | Any False Positive Escape to Scoring (\`FP > 0\`) | Immediate Rollback to \`v2\` baseline; Halt Evaluation Pipeline |
| **P0 (Critical)** | Any Hard-Gate Violation / Unauthorized User Choice Mutation | Halt serving layer; Revert database transactions |
| **P0 (Critical)** | Any Unexplained Score Delta in Production | Quarantine affected opportunity IDs |
| **P1 (High)** | Production Max Delta exceeds Certified Bound ($\\Delta > 11$) | Trigger Forensic Reconciliation Audit |
| **P1 (High)** | Unexpected Stale Fingerprint in Production Cache | Trigger Cache Invalidation & Re-fingerprinting |
| **P2 (Medium)**| Material Semantic Distribution Drift | Trigger Policy Calibration Harness |
