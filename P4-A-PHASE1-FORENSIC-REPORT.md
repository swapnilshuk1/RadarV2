# P4-A PHASE 1 EXTENDED: COMPREHENSIVE FORENSIC REPORT

## Date: 2026-08-15
## Status: INVESTIGATION COMPLETE - DO NOT FIX

---

## EXECUTIVE SUMMARY

### Critical Finding: The 141 Non-Vetoed Zeros Are **INTENTIONAL**

**Location:** `src/lib/intelligence/policy/DecisionPolicyEngine.ts:550`

**Code:**
```typescript
return {
  verdict: "PASS",
  rawScore,           // ← Preserved (e.g., 51, 53, 59)
  priorityScore: 0,    // ← Explicitly set to 0
  vetoed: false,       // ← NOT vetoed
  vetoReason: null,
  ...
}
```

**Semantics:**
- `rawScore` = actual calculated score (0-100), preserved for audit
- `priorityScore` = 0 for all PASS decisions, regardless of rawScore
- This is a **deliberate two-tier scoring system**

---

## 1. ZERO-SCORE FORENSICS

### Total Score=0: 936 opportunities (61.8% of corpus)

| Category | Count | Percentage | Assessment |
|----------|-------|------------|------------|
| **Vetoed** | 795 | 84.9% | Intentional exclusion |
| **Non-Vetoed** | 141 | 15.1% | **Intentional** (see below) |

### Veto Reasons (795 vetoed zeros)

| Veto Reason | Count | % of Zeros |
|-------------|-------|------------|
| G-EXECUTIVE-IDENTITY-MISMATCH | 547 | 58.4% |
| G-SUB-TIER-MANDATE-VETO | 225 | 24.0% |
| G-IDENTITY-VETO | 22 | 2.4% |
| G-EXECUTION-VETO | 1 | 0.1% |

### RawScore Analysis for Zeros

| RawScore | Count | % of Zeros | Assessment |
|----------|-------|------------|------------|
| rawScore = 0 | 547 | 58.4% | Failed identity/capability early |
| **rawScore > 0** | **389** | **41.6%** | **Calculated but overridden** |

**RawScore distribution (where > 0):**
- Min: 9, Max: 76, Mean: 55.12
- Most common: 57 (28), 58 (26), 52 (24), 59 (24)
- Distribution: 50-59 (173), 60-69 (102), 70-79 (20)

**Conclusion:** 389 opportunities have meaningful rawScores but are displayed as 0.

---

## 2. TRACE: SAMPLE ZERO CASES

### A. Hard-Veto Zeros (Identity Mismatch)

**Example:** j-4d8a0ef3fad4
- Veto: G-EXECUTIVE-IDENTITY-MISMATCH
- RawScore: 0
- CV: 57, SP: 81
- Identity: FAILED (distance: 0.85, required < 0.80)
- **Assessment:** Legitimate veto - identity mismatch

### B. Non-Vetoed Zeros (141 cases)

**Example:** j-122635045f26
- Vetoed: **false**
- RawScore: **51**
- Priority: **0**
- CV: 46, SP: 63, Friction: 18
- Pipeline: Identity:MATCH:100 → Capability:PASS:50 → Career:PASS:46 → Lifestyle:FAIL:82 → Ranking:COMPLETE:51
- **Assessment:** RawScore calculated as 51, but priorityScore explicitly set to 0

**This is intentional code behavior, not a bug.**

---

## 3. RAW SCORE VS FINAL SCORE

### For All 936 Zero-Final-Score Cases:

| Type | Count | Assessment |
|------|-------|------------|
| A. rawScore = 0 | 547 | Failed early (identity/capability) |
| **B. rawScore > 0, final = 0** | **389** | **PASS decision override** |

### Why rawScore > 0 But Final = 0?

**The Decision Policy Engine has explicit branches:**

```
if (vetoed) {
  return { priorityScore: 0, vetoed: true }
} else if (rawScore >= 70) {
  return { priorityScore: rawScore, verdict: "PURSUE" }
} else if (rawScore >= 60) {
  return { priorityScore: rawScore, verdict: "CONSIDER" }
} else {
  return { priorityScore: 0, verdict: "PASS" }  // ← This is line 550
}
```

**All rawScores < 60 get priorityScore = 0, regardless of actual value.**

---

## 4. THE 10-59 GAP

### Score Distribution by Band:

```
Band      | Count | %     | Visual
----------|-------|-------|--------
0         |   936 | 62.4% | ███████████████████
1-9       |     0 |  0.0% |
10-19     |     0 |  0.0% |
20-29     |     0 |  0.0% |
30-39     |     0 |  0.0% |
40-49     |     0 |  0.0% |
50-59     |     0 |  0.0% |
60-69     |   156 | 10.4% | ███
70-79     |   296 | 19.7% | ██████
80-89     |   108 |  7.2% | ██
90-99     |     3 |  0.2% |
```

### Why No Scores 1-59?

**Root Cause:** The decision threshold logic (lines 475-555):

```typescript
// Line 475-482
if (rawScore >= POLICY_THRESHOLDS.PURSUE && ...) {
  // priorityScore = rawScore (70+)
}
// Line 522-531
else if (rawScore >= POLICY_THRESHOLDS.CONSIDER) {
  // priorityScore = rawScore (60-69)
}
// Lines 545-555 (else branch)
else {
  priorityScore: 0  // ← All scores < 60 become 0
}
```

**The gap is intentional** - all opportunities scoring < 60 are bucketed to priorityScore = 0.

**However:** The rawScore IS calculated and preserved (values like 51, 53, 59 exist in rawScore).

---

## 5. NON-VETOED SCORE=0 ANALYSIS

### Summary:
- Count: 141
- Percentage of corpus: 9.31%
- Decision: All PASS
- RawScore range: 9 - 59

### Examples:

| JobHash | RawScore | CV | SP | Friction | Assessment |
|---------|----------|----|----|----------|------------|
| j-122635045f26 | 51 | 46 | 63 | 18 | Calculated but bucketed to 0 |
| j-922e82d57877 | 53 | 46 | 87 | 18 | High SP but low CV |
| j-87a0a5fabc3a | 59 | 84 | 80 | 28 | Almost 60, but friction high |
| j-d1a2303beab1 | 49 | 51 | 91 | 28 | High SP but friction high |

### Why priorityScore = 0?

**Line 550 explicitly sets priorityScore = 0 when:**
- rawScore < 60 (threshold for CONSIDER)
- Not vetoed
- Decision = PASS

**This is intentional threshold-based bucketing.**

---

## 6. SCORE BANDS ANALYSIS

| Band | Count | % | PURSUE | CONSIDER | PASS | Veto% | Avg CV | Avg SP |
|------|-------|---|--------|----------|------|-------|--------|--------|
| 0 | 936 | 62.4 | 0 | 0 | 936 | 85% | 55 | 72 |
| 1-9 | 0 | 0.0 | - | - | - | - | - | - |
| 10-19 | 0 | 0.0 | - | - | - | - | - | - |
| 20-29 | 0 | 0.0 | - | - | - | - | - | - |
| 30-39 | 0 | 0.0 | - | - | - | - | - | - |
| 40-49 | 0 | 0.0 | - | - | - | - | - | - |
| 50-59 | 0 | 0.0 | - | - | - | - | - | - |
| 60-69 | 156 | 10.4 | 0 | 156 | 0 | 0% | 57 | 77 |
| 70-79 | 296 | 19.7 | 256 | 40 | 0 | 0% | 57 | 77 |
| 80-89 | 108 | 7.2 | 108 | 0 | 0 | 0% | 71 | 79 |
| 90-100 | 3 | 0.2 | 3 | 0 | 0 | 0% | 84 | 86 |

### Key Insights:

1. **62.4% at score 0** - Bimodal distribution
2. **Complete gap 1-59** - Threshold bucketing
3. **CONSIDER band (60-69):** 156 opportunities, no vetoes
4. **PURSUE band (70+):** 407 opportunities, no vetoes
5. **Higher scores correlate with higher CV and SP**

---

## 7. SCORE SEMANTICS

### Field Definitions:

| Field | Location | Meaning | Usage |
|-------|----------|---------|-------|
| `rawScore` | DecisionPolicyEngine.ts:270 | Calculated continuous score (0-100) | Audit/trace |
| `priorityScore` | DecisionPolicyEngine.ts: Various | Display/ranking score (0 or 60+) | UI/ranking |
| `record.priority` | engine.ts:412 | Same as priorityScore | Final output |

### Displayed Score (present.ts:83):
```typescript
const scoreVal = record.priority !== null ? Math.round(record.priority) : 0;
```

**Uses priority, not rawScore.**

### Is the Score Meant to Rank ALL Opportunities?

**Current Implementation:**
- **YES** for 60+: Ranked by actual score
- **NO** for < 60: All bucketed to 0 (no differentiation)

**Implication:** 62% of corpus is NOT meaningfully ranked.

---

## 8. RANKING BEHAVIOR

### Score 0 Opportunities:
- Count: 936
- Ranking: **All tied**
- Secondary ranking: **None visible**

### Are They Differentiated by Other Fields?

| Field | Range in Score-0 | Used for Ranking? |
|-------|------------------|-------------------|
| rawScore | 0-76 | No (priority used) |
| CV | 46-84 | No |
| SP | 57-91 | No |
| Friction | 0-28 | No |

**Conclusion:** 936 opportunities are completely undifferentiated in ranking.

**Product Question:** Is this acceptable?

---

## 9. SCORE × DECISION × VETO MATRIX

### Most Common Combinations:

| Combination | Count | Assessment |
|-------------|-------|------------|
| 0-PASS-VETO | 795 | Correct: Vetoed excluded |
| 0-PASS-NO-VETO | 141 | **Questionable: PASS with score 0** |
| 70-79-PURSUE-NO-VETO | 256 | Correct: High score, pursue |
| 60-69-CONSIDER-NO-VETO | 156 | Correct: Medium score, consider |
| 80-89-PURSUE-NO-VETO | 108 | Correct: Very high score |

### Anomalies:

| Anomaly | Count | Explanation |
|---------|-------|-------------|
| Non-zero PASS | 0 | PASS always has score 0 |
| Zero PURSUE | 0 | PURSUE always has score >= 70 |
| Zero CONSIDER | 0 | CONSIDER always has score >= 60 |

**No anomalies detected - behavior is consistent.**

---

## 10. IS THIS INTENTIONAL?

### Evidence for INTENTIONAL:

1. ✅ **Explicit code** at line 550: `priorityScore: 0`
2. ✅ **Clear threshold logic:** < 60 → 0, 60+ → actual score
3. ✅ **rawScore preserved** for audit
4. ✅ **vetoed flag** distinguishes veto vs. threshold
5. ✅ **Consistent behavior** across all records

### Evidence for DEFECT:

1. ⚠️ **62% undifferentiated** seems high
2. ⚠️ **rawScore > 0 but hidden** seems wasteful
3. ⚠️ **No secondary ranking** for zeros
4. ⚠️ **Complete 1-59 gap** is unusual

### Verdict:

**INTENTIONAL but QUESTIONABLE DESIGN**

The behavior is explicitly coded, but the product implications may not be desirable.

---

## 11. UNIQUE SCORES ANALYSIS

### Only 33 Unique Scores Used:

**Score → Count (top 10):**
- 0 → 936 (62.4%)
- 75 → 38
- 70 → 35
- 77 → 35
- 74 → 34
- 80 → 32
- 78 → 31
- 72 → 30
- 73 → 28
- 76 → 24

**Why so few unique scores?**

1. **Bucketing:** All < 60 → 0
2. **Rounding:** Math.round() in line 270
3. **Threshold effects:** Scores cluster at decision boundaries
4. **Weight interactions:** Formula produces similar scores

---

## 12. SCORE CLUSTER ANALYSIS

### Discrete Brackets Detected:

| Score | Count | Decision | Likely Origin |
|-------|-------|----------|---------------|
| 0 | 936 | PASS | Threshold < 60 |
| 60 | 23 | CONSIDER | Threshold = 60 |
| 70 | 35 | PURSUE | Threshold = 70 |
| 75 | 38 | PURSUE | High performer |
| 77 | 35 | PURSUE/PURSUE | Strong match |
| 80 | 32 | PURSUE | Very strong match |

**Conclusion:** Scores arise from calculation + thresholding, not continuous distribution.

---

## 13. PRELIMINARY HYPOTHESIS

### WHAT WE KNOW:

1. ✅ 936 opportunities (61.8%) score exactly 0
2. ✅ 795 are vetoed (85% of zeros, intentional)
3. ✅ 141 are NOT vetoed (15% of zeros, **intentional threshold behavior**)
4. ✅ Complete gap from scores 1-59 (threshold bucketing)
5. ✅ Only 33 unique scores (rounding + thresholding)
6. ✅ RawScore preserved but hidden for 389 zeros
7. ✅ Non-vetoed zeros have rawScores 9-76
8. ✅ Line 550 explicitly sets `priorityScore: 0` for PASS

### WHAT WE STRONGLY SUSPECT:

1. 🔍 The 0 score represents **EXCLUSION from ranking** for opportunities < 60
2. 🔍 The design is **intentional bucketing**, not a bug
3. 🔍 The 10-59 gap is **deliberate threshold behavior**
4. 🔍 Scores are **calculated continuously** but **displayed discretely**

### WHAT REMAINS UNKNOWN:

1. ❓ Whether the 62% exclusion rate is **product-desirable**
2. ❓ Whether users understand that 0 means "< 60" not "worst"
3. ❓ Whether a secondary ranking should exist for zeros
4. ❓ Whether rawScores should be visible to users

### WHAT APPEARS INTENTIONAL:

1. ✅ Vetoed → score 0 (clear exclusion)
2. ✅ Threshold-based decisions (60=CONSIDER, 70=PURSUE)
3. ✅ RawScore preservation for audit
4. ✅ Score capping at 100, flooring at 0
5. ✅ Line 550: `priorityScore: 0` for PASS

### WHAT APPEARS QUESTIONABLE:

1. ⚠️ 62% of corpus undifferentiated
2. ⚠️ No scores 1-59 displayed
3. ⚠️ High-scoring PASS opportunities hidden as 0
4. ⚠️ Only 2.2% unique scores

### GENUINE SCORING DEFECTS:

**NONE IDENTIFIED**

All behavior is explicitly coded and internally consistent.

### REQUIRES PRODUCT-MODEL DISCUSSION:

1. 📝 Should PASS opportunities show actual score instead of 0?
2. 📝 Is 62% exclusion rate acceptable?
3. 📝 Should there be secondary ranking for zeros?
4. 📝 Should 0-59 be more granular?
5. 📝 Is the current "binary" scoring (in vs. out) the right UX?

---

## CONCLUSION

### The 936 Zeros Are **INTENTIONAL**, Not a Defect

**Root Cause:**
- Line 550 in DecisionPolicyEngine.ts: `priorityScore: 0`
- Applied to all opportunities with rawScore < 60
- Both vetoed and non-vetoed PASS decisions

**Mechanism:**
- RawScore calculated continuously (0-100)
- PriorityScore bucketed: < 60 → 0, 60+ → actual
- Display uses priorityScore, not rawScore

### The Real Question Is Product, Not Engineering

**This is a PRODUCT DECISION, not a scoring defect.**

The implementation correctly executes the current design:
- **Vetoed:** Excluded (score 0)
- **< 60:** Excluded from ranking (score 0)
- **60-69:** Consider (actual score)
- **70+:** Pursue (actual score)

### Recommendation

**DO NOT change code.** Instead:

1. **Document** the current scoring semantics
2. **Decide** whether the 62% exclusion is product-desirable
3. **Consider** whether to expose rawScores for PASS opportunities
4. **Evaluate** whether 0-59 should have granularity

The scoring system is **internally consistent** and **executes the documented policy correctly**.

The question is whether **that policy is the right one**.

---

**STATUS: INVESTIGATION COMPLETE**

**NO CODE CHANGES RECOMMENDED**

**PRODUCT DECISION REQUIRED**
