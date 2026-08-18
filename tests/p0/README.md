# Phase 0 Invariants: Evidence → Record → Presentation Fidelity

## Single Core Invariant

> **RecommendationRecord must be the single semantic source of truth for every user-visible decision attribute.**

This means:
- `presented.score` === `record.priority`
- `presented.decision` === `record.verb`
- `presented.confidence` === `record.confidence`
- `presented.vetoed` === `record.vetoed`
- `presented.evaluationStatus` === `record.evaluationStatus`
- `presented.archetype` === grounded claim from `record.claimPermissions`
- `presented.policyVersion` === `record.recommendationVersion`
- `presented.evidenceState` === derived from `record.trace.pipeline`
- `presented.candidateIdentity` === `record.trace.candidateProjectionHash`
The presenter and shortlist are **projections**, not interpreters.

---

## Revised Contract Definitions

### Evidence Grounding (P0-A)

Two distinct concepts:

| Concept | Definition | Trusted Values |
|:---|:---|:---|
| **SOURCE_GROUNDED** | Quote exists verbatim in `rawText` | N/A (text match) |
| **STRUCTURED_TRUSTED** | Evidence from vetted structured source | `curated`, `extractor`, `gold`, `fixture`, `onboarder` |

**Contract:** Evidence is valid if `SOURCE_GROUNDED` OR `STRUCTURED_TRUSTED`.

**Anti-patterns eliminated:**
- `!ev.provenance` fallback (accepts undefined/null)
- `!rawJobText` fallback (accepts missing source)
- `title` as automatic trust (must be explicitly STRUCTURED_TRUSTED)

### Evidence Gate Boundary (P0-B)

| Outcome | Condition | vetoed | priority | pipeline |
|:---|:---|:---:|:---:|:---:|
| **SPARSE_SPEC** | Word count < 25, commercial role | **false** | **null** | `[{ EvidenceGate }]` |
| **PASS** | Non-commercial role | false | 0 | full pipeline to rejection |
| **EVALUATED** | Word count ≥ 25 | varies | number | full pipeline |

**Critical:** SPARSE_SPEC is **epistemic uncertainty**, not veto. `vetoed: false`.

### Pipeline Isolation (P0-C)

SPARSE_SPEC trace contains **only** EvidenceGate stage. No:
- `careerValueBreakdown`
- `evidenceMapping`
- `decisionDrivers`
- `decisionRisks`

Assessment engines do not run, or their outputs are excluded from trace.

### Capability UNKNOWN (P0-D)

| evidenceState | overallFit | capabilityPotential |
|:---|:---:|:---:|
| **UNAVAILABLE** | **null** | **null** |
| PARTIAL | number | number |
| SUFFICIENT | number | number |

**No neutral 0.50 baseline.** Unknown is explicit absence, not "medium fit".

### Candidate Seniority (P0-E)

Candidate seniority is a distinct semantic dimension from operating level.

| Input Title | candidateSeniorityLevel.value | Hardcoded Override? |
|:---|:---|:---:|
| Senior Director | "DIRECTOR" | ❌ |
| VP Marketing | "VP_FUNCTIONAL" | ❌ |
| Chief Marketing Officer | "C_SUITE" | ❌ |

**OperatingLevel remains unchanged:**
- `operatingLevel` continues to use `MANAGERIAL` / `STRATEGIC` / `EXECUTIVE` taxonomy
- Classified by `OperatingLevelClassifier`
- Used for career value calculations and scoring

**CandidateSeniorityLevel is a separate dimension:**
- `candidateSeniorityLevel` uses `DIRECTOR` / `VP_FUNCTIONAL` / `C_SUITE` taxonomy
- Classified by `CandidateSeniorityClassifier`
- Preserved without hardcoded overrides

**Both dimensions are independent and may differ legitimately.**

### Presenter Purity (P0-F)

**Projection contract:**

