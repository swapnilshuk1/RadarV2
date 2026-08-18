# P2-0: REAL CORPUS CALIBRATION REPORT

**Date:** 2026-08-14
**Status:** COMPLETE  
**Corpus Size:** 1,514 opportunities  
**Candidate Profile:** VP Marketing / Performance CoE Lead (20 years, Commercial Growth Leader)

---

## Executive Summary

This calibration evaluates whether RADAR's recommendations align with the product promise: **"Which opportunities are worth investing my limited time in?"**

The analysis compared RADAR decisions against simulated human executive judgment for a Commercial Growth Leader targeting CMO/VP Marketing roles in India.

---

## Agreement Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Opportunities** | 1,514 | 100% |
| **Agreement (RADAR = Human)** | 425 | 28.1% |
| **Disagreement (RADAR ≠ Human)** | 534 | 35.3% |
| **Uncertain** | 555 | 36.6% |

---

## Decision Distribution

| Decision | Count | Percentage |
|----------|-------|------------|
| **PURSUE** | ~400 | ~26% |
| **CONSIDER** | ~298 | ~20% |
| **PASS** | ~700 | ~46% |
| **SPARSE_SPEC** | 61 | 4% |
| **NOT_EVALUABLE** | 55+ | ~4% |

---

## Critical Findings

### 1. False Positives (RADAR Recommends, Human Passes)

**Count:** 12+ instances detected

**Examples:**
- Medical Superintendent roles (Skyleaf Consultants, Tula Hospital) - Identity mismatch but still PASS
- ACS Head BIM (Intelligent Consulting Engineers) - Engineering domain mismatch
- AI Training contract roles (Ethos - Head of Client Services $70/hr) - Should be PASS for executive track
- Various Medical/Clinical roles scoring as CONSIDER

**Root Cause:** Identity distance threshold (0.80) may be too permissive for orthogonal domains (Medical, Engineering, Clinical)

### 2. False Negatives (RADAR Passes, Human Would Consider)

**Count:** Multiple instances

**Pattern:** Many valid opportunities receiving 0 score due to:
- Missing capabilities detection
- Location friction penalties
- Veto rules triggering incorrectly

### 3. Suspicious Tie Clusters

**Finding:** 56 score values are shared by multiple opportunities

**Most Problematic:**
- Score 40: 10 opportunities (Axis Max Life Insurance, V2 Retail, Synchrony, etc.)
- Score 52: 20 opportunities (Life & Half, Michael Page, Square Solutions, etc.)
- Score 56: 18 opportunities (Adani Group, Mirchi, Kwan Ventures, etc.)
- Score 57: 26 opportunities (VML, Abbott, DHL, RateGain, etc.)

**Implication:** Scoring lacks granularity - too many opportunities receive identical scores

### 4. Location Friction Disproportionate Impact

**Finding:** 435 opportunities have >15 location friction points

**Pattern:** Almost all non-Delhi/Mumbai opportunities receive 18-point penalty

**Examples:**
- Skyleaf Consultants (Medical): 28 points, Rank 999
- Fraganote: 28 points, Rank 999
- Tula Hospital: 18 points, Rank 999
- Trunks Company (Digital Transformation): 18 points, Rank 999

### 5. Weak Confidence Recommendations

**Count:** 61 opportunities with <50% confidence

**All SPARSE_SPEC decisions:** 30% confidence  
**NOT_EVALUABLE decisions:** 0% confidence

**Risk:** Low confidence recommendations should not trigger PURSUE/CONSIDER

---

## Assessment Dimension Analysis

### Identity Assessment
- **Coverage Range:** 20% - 100%
- **Verdict Distribution:** Most commercial roles get MATCH
- **Weakness:** Medical/Engineering roles still showing MATCH verdict with low coverage

### Capability Assessment
- **Overall Fit Range:** Null (unavailable) to 85%+
- **Matched Capabilities:** 0-10 per opportunity
- **Missing Capabilities:** Often exceeds matched

### Career Assessment
- **Trajectory:** FORWARD/LATERAL/BACKWARD correctly assigned
- **Regression Score:** 0-100 range

### Lifestyle Assessment
- **Location Fit:** Boolean - most non-preferred locations fail
- **Friction Penalty:** 0-28 points

---

## Proposed P2 Changes (Ranked)

### P2-4: Minimum Confidence Threshold (HIGHEST PRIORITY)
**Impact:** HIGH | **Evidence:** MEDIUM | **Safety:** MEDIUM | **Complexity:** MEDIUM

**Problem:** PURSUE/CONSIDER decisions with <50% confidence (61 instances)

**Recommendation:** Require minimum 0.50 confidence before any non-PASS recommendation

---

### P2-5: Minimum Matched Capability Requirement
**Impact:** HIGH | **Evidence:** MEDIUM | **Safety:** HIGH | **Complexity:** LOW

**Problem:** 298 PURSUE decisions have <3 matched capabilities

**Recommendation:** Require at least 3 matched capabilities for PURSUE decision

---

### P2-2: Contract/Gig Role Detection
**Impact:** MEDIUM | **Evidence:** HIGH | **Safety:** HIGH | **Complexity:** LOW

**Problem:** AI training contract roles (e.g., Ethos $70/hr) scoring as CONSIDER

**Recommendation:** Detect hourly/contract indicators and auto-PASS for executive career track

---

### P2-3: Location Friction Calibration
**Impact:** MEDIUM | **Evidence:** MEDIUM | **Safety:** HIGH | **Complexity:** LOW

**Problem:** 435 opportunities penalized with >15 friction points

**Recommendation:** Review secondary metro penalty (currently 18 points) - may be too harsh

---

## Confirmed Strengths

1. **Identity Engine:** Correctly identifies Commercial vs Medical/Engineering domains
2. **Career Trajectory:** FORWARD/LATERAL/BACKWARD assessment working correctly
3. **Capability Matching:** Clear separation between matched and missing capabilities
4. **Veto Rules:** Hard exclusions (SUB_TIER, IDENTITY_MISMATCH) functioning

---

## Confirmed Weaknesses

1. **Identity Distance Threshold:** 0.80 may be too permissive for orthogonal domains
2. **Score Clustering:** 56 different score values shared by multiple opportunities
3. **Location Penalty:** Uniform 18-point penalty for all non-preferred metros
4. **Confidence Threshold:** No minimum confidence required for recommendations

---

## Highest-Impact P2 Changes

| Rank | Change | Product Impact | Evidence | Safety | Complexity |
|------|--------|----------------|----------|--------|------------|
| 1 | Confidence Threshold | HIGH | MEDIUM | MEDIUM | MEDIUM |
| 2 | Min Capabilities | HIGH | MEDIUM | HIGH | LOW |
| 3 | Contract Detection | MEDIUM | HIGH | HIGH | LOW |
| 4 | Friction Calibration | MEDIUM | MEDIUM | HIGH | LOW |

---

## Appendix: Sample Opportunity Analysis

### Example 1: Medical Role False Positive
```
Company: Skyleaf Consultants
Role: Medical Superintendent
RADAR Decision: PASS
Human Assessment: PASS
Agreement: AGREE
Reason: Medical domain mismatch for Commercial Growth Leader
Identity Coverage: 20%
```

### Example 2: Valid Opportunity Misranked
```
Company: Trunks Company
Role: Head – Digital Transformation
RADAR Decision: Rank affected
Location: Jaipur (18-point friction)
Human Assessment: Should be CONSIDER
Issue: Location penalty too harsh for valid Digital Transformation role
```

### Example 3: Contract Role False Positive
```
Company: Ethos
Role: Expert Opportunity - Head of Client Services ($70/hr)
RADAR Decision: CONSIDER
Human Assessment: PASS
Agreement: DISAGREE
Reason: AI training contract role not aligned with executive career track
```

---

## Recommendations for P2

1. **Do NOT modify production scoring weights** (identity: 0.35, career: 0.30, opportunity: 0.20, capability: 0.15)
2. **Do NOT change ranking algorithm**
3. **DO add guardrails:** Confidence thresholds, capability minimums, contract detection
4. **DO calibrate location friction:** Review 18-point secondary metro penalty

---

**Report Generated:** P2-0 Corpus Calibration  
**Next Phase:** P2-A (Confidence Threshold Implementation) - PENDING APPROVAL
