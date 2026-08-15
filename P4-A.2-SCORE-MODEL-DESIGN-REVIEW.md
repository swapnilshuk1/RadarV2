# P4-A.2: RADAR Score Model Design Review

**Date:** 2026-08-15  
**Status:** ANALYTICAL REVIEW - NO PRODUCTION CHANGES  
**Objective:** Determine correct scoring architecture for common 0-100 opportunity index

---

## PART 1: DEFINE THE SEMANTICS

### Intended Meaning of Each Dimension

#### **Identity**
- **Current Implementation:** Vector similarity between candidate and opportunity (0-100)
- **Product Question:** Is this measuring "can do the job" or "is the right fit"?
- **Current Classification:** BOTH gate AND quality dimension (35% weight)
- **Forensic Finding:** Produces 100 for 99.4% of survivors (effectively constant)
- **Reclassification Proposal:**
  - **Primary Purpose:** Eligibility gate (hard filter)
  - **Secondary:** Quality signal only if meaningfully differentiated

#### **Career Value (CV)**
- **Current Implementation:** Trajectory assessment (FORWARD/LATERAL/BACKWARD)
- **Product Question:** Is career growth the most important factor?
- **Current Classification:** Quality dimension (25% weight, distance-adjusted)
- **Forensic Finding:** Mean 54.9, ranges 46-84
- **Reclassification:** Clear **quality dimension** - meaningful variation

#### **Capability Fit**
- **Current Implementation:** Skill match percentage (0-100)
- **Product Question:** Should capability gaps disqualify or just reduce score?
- **Current Classification:** Quality dimension (35% weight, distance-adjusted)
- **Forensic Finding:** Mean varies widely, distinguishes opportunities
- **Reclassification:** **Quality dimension** with threshold consideration

#### **Opportunity Quality**
- **Current Implementation:** Mandate attractiveness score (default 80)
- **Product Question:** What makes an opportunity "good" independent of fit?
- **Current Classification:** Quality dimension (10% weight)
- **Forensic Finding:** Actually dynamic (not fixed at 80)
- **Reclassification:** **Quality dimension** but verify calculation

#### **Pursuit Friction**
- **Current Implementation:** Location/travel penalty (subtracted)
- **Product Question:** Should friction reduce score or block pursuit?
- **Current Classification:** Decision modifier (subtractive)
- **Forensic Finding:** Range 0-28, mean 9
- **Reclassification:** **Decision modifier** (affects actionability, not quality)

#### **RADAR Score**
- **Current Implementation:** priorityScore (binary: 0 or 60+)
- **Product Intent:** Common 0-100 opportunity quality index
- **Current Reality:** Actionability/pursuit indicator, not quality ranking
- **Required Reclassification:** Must become **continuous quality dimension**

#### **Decision**
- **Current Implementation:** PURSUE/CONSIDER/PASS based on thresholds
- **Product Intent:** Action recommendation separate from quality score
- **Required Separation:** Decision should be DERIVED FROM score, not define it

### Semantic Classification Summary

| Dimension | Current Role | Proposed Role | Rationale |
|-----------|--------------|---------------|-----------|
| Identity | Gate + Quality (35%) | **Gate** | 99.4% produce 100; effectively binary |
| Capability | Quality (35%) | **Quality** | Meaningful differentiation |
| Career Value | Quality (25%) | **Quality** | Meaningful differentiation |
| Opportunity | Quality (10%) | **Quality** | Meaningful differentiation |
| Friction | Subtractive | **Decision Modifier** | Affects actionability, not quality |
| RADAR Score | Binary (0 or 60+) | **Continuous Quality Index** | Must rank ALL opportunities |
| Decision | Threshold-based | **Derived from Score** | Separate semantic concern |

---

## PART 2: EVALUATE CURRENT MODEL

### Current Formula (as implemented)
```
rawScore = (0.30 × identityScore × capabilityInteraction) +
           (0.35 × capabilityScore × capabilityInteraction) +
           (0.25 × careerScore × careerInteraction) +
           (0.10 × opportunityScore) -
           locationFriction
```

**Note:** Weights in code differ from stated policy. Using actual code weights.

### Quantitative Analysis

#### Score Range
- **Theoretical:** 0-100
- **Actual rawScore:** 0-92
- **Actual priorityScore:** 0 or 60-92
- **Effective continuous range:** 60-92 (for non-vetoed)

#### Component Variance (from forensic data)

| Component | Mean | Std Dev | Min | Max | Variance |
|-----------|------|---------|-----|-----|----------|
| Identity Score | ~99.4 (survivors) | ~2 | 0 | 100 | Very Low |
| Capability Score | Varies | Moderate | 0 | 100 | Moderate |
| Career Score | 54.9 | Moderate | 0 | 100 | Moderate |
| Opportunity Score | Dynamic | Low | Varies | Varies | Low |
| Friction | 9 | Moderate | 0 | 28 | Moderate |

#### Component Contribution to Final Score

Based on code weights and typical values:

| Component | Weight | Typical Value | Typical Contribution | % of Score |
|-----------|--------|---------------|---------------------|------------|
| Identity | 30% | 99.4 | ~29.8 | ~35% (after adjustment) |
| Capability | 35% | 60 | ~21.0 | ~25% |
| Career | 25% | 55 | ~13.8 | ~16% |
| Opportunity | 10% | 70 | ~7.0 | ~8% |
| Friction | Subtractive | -9 | -9.0 | -11% |
| **Total** |  |  | **~62.6** | **~73%** |

#### Key Finding: Identity Dominance

With identity producing 99.4% for survivors:
- Identity contributes ~30 points (essentially fixed)
- Remaining 70 points must come from other dimensions
- Actual score variance comes from: Capability + Career + Opportunity - Friction
- Effective formula: **30 + (Capability × 0.35) + (Career × 0.25) + (Opportunity × 0.10) - Friction**

#### Score Collisions

- **Total unique rawScores:** 65 (of 101 possible)
- **Total unique priorityScores:** 33 (of 101 possible)
- **Collision rate:** High (many opportunities share same score)
- **Primary cause:** Identity effectively constant + rounding

#### Effective Range Analysis

| Range | Count | % | Assessment |
|-------|-------|---|------------|
| 0-9 | 563 | 37.2% | Vetoed/failed identity |
| 10-59 | 266 | 17.6% | Present but hidden |
| 60-69 | 258 | 17.0% | CONSIDER range |
| 70-89 | 424 | 28.0% | PURSUE range |
| 90-100 | 3 | 0.2% | Exceptional |

**Effective continuous range:** 60-92 (only 32 points of 101 used for ranking)

#### Correlation Analysis

From forensic data, estimated correlations:
- Identity ↔ Final Score: Very Low (identity ~constant)
- Capability ↔ Final Score: Moderate-High
- Career ↔ Final Score: Moderate-High
- Opportunity ↔ Final Score: Low-Moderate
- Friction ↔ Final Score: Moderate (negative)

#### Critical Assessment

| Criterion | Current Model | Ideal for 0-100 Index | Assessment |
|-----------|---------------|----------------------|------------|
| Continuous range | Binary (0 or 60+) | Full 0-100 | **FAIL** |
| Component variance | Low (identity constant) | Meaningful variance | **PARTIAL** |
| Correlation spread | Concentrated in Capability/Career | Distributed across dimensions | **PARTIAL** |
| Gate separation | Conflated with score | Separate from score | **FAIL** |
| Decision derived | Score defines decision | Decision derived from score | **INVERTED** |

---

## PART 3: IDENTITY DESIGN

### HYPOTHESIS A: Identity Remains Weighted, Becomes Granular

**Proposal:**
- Keep Identity as 30% weighted component
- Modify IdentityEngine to produce meaningful differentiation
- Target range: 60-100 (survivors) with variance
- Add interaction multipliers to amplify differences

**Advantages:**
- Minimal architectural change
- Preserves current structure
- Can theoretically produce continuous scores

**Disadvantages:**
- Requires IdentityEngine redesign
- May be technically difficult (vector similarity ceiling effect)
- Current 99.4% at 100 suggests inherent limitation

**Impact on Ranking:**
- If successful: More score variance
- If unsuccessful: Same current problem

**Impact on Executive Interpretation:**
- More nuanced identity signal
- Better discrimination among similar opportunities

**Required Evidence:**
- Can IdentityEngine be modified to produce 60-100 range?
- What's the actual distribution of semantic distances?
- Is there meaningful variance to extract?

**Verdict:** Uncertain feasibility. Current evidence suggests identity is inherently binary (match/mismatch).

### HYPOTHESIS B: Identity Becomes Hard Eligibility Gate

**Proposal:**
- Remove Identity from scoring (0% weight)
- Convert to hard gate: identityDistance < threshold
- Failed → excluded from index entirely
- Passed → quality score calculated on other dimensions
- Quality score scaled to full 0-100 for survivors

**Advantages:**
- Clear semantic separation (eligible vs. ineligible)
- Quality index ranks only eligible opportunities
- Full 0-100 range available for meaningful differentiation
- Matches executive intuition: "first, am I qualified?"

**Disadvantages:**
- Larger architectural change
- Requires renormalization of other weights
- Some excluded opportunities may have been "interesting"

**Impact on Ranking:**
- Eligible opportunities: Full 0-100 range
- More meaningful differentiation among survivors

**Impact on Executive Interpretation:**
- Clear two-step: "Am I eligible?" then "How good is the fit?"
- Quality scores have full range

**Impact on P0-P3:**
- DecisionPolicyEngine: Identity check becomes early gate
- Other weights must be renormalized (sum to 100%)
- Score calculation changes: pure quality, no identity

**Required Evidence:**
- What's the identity failure rate? (forensics: ~52%)
- Can Capability + Career + Opportunity provide sufficient variance?
- What's the distribution of these three combined?

**Verdict:** Cleaner conceptual model. Better semantic alignment.

### Comparison

| Criterion | Hypothesis A (Keep Weighted) | Hypothesis B (Gate Only) |
|-----------|------------------------------|--------------------------|
| Feasibility | Uncertain (technical challenge) | High (architectural change) |
| Semantic clarity | Low (identity contributes but is constant) | High (separate concerns) |
| Score range impact | Minimal if identity remains constant | Full 0-100 for survivors |
| P0-P3 disruption | Moderate (engine redesign) | Moderate (renormalization) |
| Executive clarity | Low | High |

**Recommendation:** Hypothesis B is the cleaner model. The question is whether losing the bottom 52% from the index is acceptable.

---

## PART 4: SCORE VS DECISION SEPARATION

### Current Architecture (Inverted)
```
rawScore → [Decision Logic] → priorityScore (binary)
                     ↓
                Decision
```

Score defines decision (score < 60 → PASS → score = 0).

### Proposed Architecture (Separated)
```
rawScore → [Identity Gate] → Quality Score (0-100, continuous)
                    ↓
            [Decision Logic] → Decision
                    ↓
            [Friction Check] → Final Recommendation
```

Score is independent. Decision derived from score + other factors.

### Test Against Representative Cases

#### Case 1: High Score + PASS (Currently: Impossible)
**Hypothetical:** rawScore 85, but high friction makes it PASS
**Current:** Would become CONSIDER or PURSUE (score >= 60)
**Proposed:** Score = 85 (quality), Decision = CONSIDER (friction), Verdict = "High quality but verify logistics"

**Coherence:** Proposed model better separates "opportunity quality" from "should I pursue?"

#### Case 2: Medium Score + PURSUE
**Current:** rawScore 65 → CONSIDER (not PURSUE, needs >= 70)
**Proposed:** Quality = 65, but other factors (SP, urgency) might elevate to PURSUE

**Coherence:** Proposed model allows decision elevation based on non-score factors.

#### Case 3: Low Score + High Shortlisting Potential
**Example:** rawScore 45 (poor fit), SP 95 (easy to get)
**Current:** PASS → priorityScore 0
**Proposed:** Quality = 45 (poor opportunity), SP = separate signal

**Coherence:** Proposed model doesn't conflate "easy to win" with "worth winning."

#### Case 4: High Career Value + Low Shortlisting Potential
**Example:** CV 90 (great for career), SP 20 (hard to get)
**Current:** If rawScore >= 60 → CONSIDER/PURSUE
**Proposed:** Quality captures CV, decision considers SP separately

**Coherence:** Both models can handle this, but proposed makes the tension explicit.

#### Case 5: High Friction + High Quality
**Example:** Quality 80, Friction 25
**Current:** rawScore = 80 - 25 = 55 → PASS → priorityScore 0
**Proposed:** Quality = 80, Friction affects decision/recommendation

**Coherence:** Proposed model better reflects "great opportunity, but hard to pursue."

#### Case 6: Identity Mismatch
**Current:** Vetoed → priorityScore 0
**Proposed:** Excluded from quality index (N/A)

**Coherence:** Proposed model clearer: "not applicable" vs. "quality 0."

#### Case 7: Sub-Tier Role
**Current:** Vetoed → priorityScore 0
**Proposed:** Excluded from quality index (N/A)

**Coherence:** Same as identity mismatch.

### Verdict: Separation Produces More Coherent Model

| Aspect | Current | Proposed | Winner |
|--------|---------|----------|--------|
| Quality independence | No (decision affects score) | Yes | **Proposed** |
| Friction handling | Reduces score | Affects decision | **Proposed** |
| Hard vetoes | Score 0 | Excluded (N/A) | **Proposed** |
| Executive clarity | Low (why 0?) | High (quality vs. actionability) | **Proposed** |
| Implementation complexity | Current | Higher | **Current** |

**Recommendation:** Proposed separation is architecturally superior. Worth the implementation cost.

---

## PART 5: THE ZERO QUESTION

### Option A: 0 = Worst Opportunity

**Semantics:** Score 0 means "fundamentally unattractive opportunity"
**Implication:** Lowest-ranked eligible opportunity scores near 0
**Current:** No eligible opportunity scores near 0 (all PASS→0 are hidden)
**Assessment:**
- Pro: Full range used
- Con: Hard to distinguish "almost made it" (score 59) from "terrible fit" (score 5)
- Verdict: Rejected - doesn't match current corpus distribution

### Option B: 0 = Identity/Eligibility Failure

**Semantics:** Score 0 means "didn't pass identity gate"
**Implication:** Eligibility failures are bucketed together
**Current:** 795 vetoed + 141 PASS<60 all have priorityScore 0
**Assessment:**
- Pro: Clear semantic meaning
- Con: Eligibility failures and low-quality opportunities conflated
- Con: Raw quality information lost
- Verdict: Partial match to current, but loses information

### Option C: N/A = Eligibility Failure, All Eligible Have 0-100 Score

**Semantics:**
- Eligibility failures → N/A (or excluded)
- All eligible opportunities → scored 0-100 by quality
- Lowest eligible might score 15, not 0

**Implication:**
- Full continuous range for eligible opportunities
- Clear separation: N/A vs. quality score
- Score 0 means "eligible but lowest quality"

**Assessment:**
- Pro: Full range used
- Pro: Clear semantics
- Pro: All eligible ranked
- Con: Requires architectural change
- Verdict: **RECOMMENDED**

### Zero Question Verdict

| Option | Meaning | Current Match | Recommended |
|--------|---------|---------------|-------------|
| A | Worst opportunity | No | No |
| B | Eligibility failure | Partial | No |
| **C** | **N/A = failure, 0 = worst eligible** | **No (requires change)** | **Yes** |

---

## PART 6: CLAMPING

### Current: Clamping Applied
```
if (rawScore < 60) {
  priorityScore = 0;  // Clamped
  verdict = PASS;
}
```

Raw score preserved but hidden.

### Question: Should PASS Retain Raw Score?

**Option 1: Preserve Raw Score (Remove Clamping)**
```
RADAR Score = rawScore (always)
Decision = f(RADAR Score, Friction, etc.)
```

**Advantages:**
- Full continuous range visible
- Users can see "almost made it" (59) vs. "far off" (5)
- Better discrimination among low-fit opportunities
- Score means what it says (quality)

**Disadvantages:**
- Score no longer signals actionability
- Users might pursue low-score opportunities
- Requires decision to be separate signal

**Option 2: Keep Clamping (Current)**
```
RADAR Score = (rawScore >= 60) ? rawScore : 0
Decision = PASS if score == 0
```

**Advantages:**
- Score signals actionability
- Clear PASS vs. CONSIDER/PURSUE distinction
- Simpler user model

**Disadvantages:**
- Loses quality information for 62% of opportunities
- Can't distinguish near-misses from complete mismatches
- Score doesn't mean "quality," means "pursuit-worthy"

### Evaluation

**If RADAR Score = Quality Index:**
- Must preserve rawScore for PASS
- Decision must be separate
- **Remove clamping**

**If RADAR Score = Actionability Indicator:**
- Clamping is appropriate
- Score signals "should I pursue?"
- **Keep clamping**

**Product Intent Check:**
- Promise: "Which opportunities are worth investing my limited time in?"
- This is a QUALITY question, not actionability
- **Conclusion: Remove clamping, separate score from decision**

---

## PART 7: PROPOSE 3 MODEL OPTIONS

### OPTION 1: Minimal Evolution (Current + Tweaks)

**Formula:**
```
rawScore = (0.35 × capability) + (0.30 × identity) + (0.25 × career) + (0.10 × opportunity) - friction
Quality Score = rawScore (no clamping)
Decision =
  PURSUE if Quality Score >= 70 AND not vetoed
  CONSIDER if Quality Score >= 60 AND not vetoed
  PASS if Quality Score < 60 OR vetoed
```

**Changes from Current:**
- Remove priorityScore clamping
- Display rawScore instead of priorityScore
- Decision still threshold-based
- Identity stays weighted

**Identity Treatment:** Keep as weighted (30%)

**Friction Treatment:** Subtractive (affects quality score)

**Hard Vetoes:** Excluded from ranking (N/A)

**Meaning of 0:** Lowest quality eligible opportunity

**Expected Distribution:**
- Full 0-92 range for all non-vetoed
- 52% vetoed (N/A)
- 48% scored 0-92

**Impact on Representative Cases:**
- Case A (59): Score = 59, Decision = PASS (but visible)
- Case B (30): Score = 30, Decision = PASS
- Case C (5): Score = 5, Decision = PASS
- All distinguishable

**Advantages:**
- Minimal code change
- Full range visible
- Backward compatible with P0-P3

**Risks:**
- Identity still contributes little variance
- Score still conflated with decision
- Users might be confused by low scores

**Verdict:** Safe but incomplete solution.

---

### OPTION 2: Clean Conceptual Model (Recommended)

**Formula:**
```
// Step 1: Identity Gate
if (identityDistance > threshold) return N/A

// Step 2: Quality Score (renormalized weights)
Quality Score = (0.50 × capability) + (0.35 × career) + (0.15 × opportunity)
Quality Score = scaleTo100(Quality Score)  // Full 0-100

// Step 3: Decision (derived, separate)
Decision =
  PURSUE if Quality Score >= 75 AND Friction < 15 AND SP >= 50
  CONSIDER if Quality Score >= 60
  PASS otherwise

// Step 4: Recommendation (friction check)
If Decision = PURSUE but Friction > 20:
  Downgrade to CONSIDER with note
```

**Changes from Current:**
- Identity becomes hard gate (N/A if failed)
- Other weights renormalized (sum to 100%)
- Quality Score displayed for ALL eligible
- Decision derived separately
- Friction affects decision, not quality

**Identity Treatment:** Hard eligibility gate (0% of quality score)

**Friction Treatment:** Decision modifier (not quality component)

**Hard Vetoes:** N/A (excluded from quality index)

**Meaning of 0:** Lowest quality among eligible opportunities

**Expected Distribution:**
- ~52% N/A (identity failure)
- ~48% scored 0-100
- Full range used for eligible

**Impact on Representative Cases:**
- Case A (59 raw): Quality = 59, Decision = PASS
- Case B (30 raw): Quality = 30, Decision = PASS
- Case C (5 raw): Quality = 5, Decision = PASS
- Vetoed: N/A

**Advantages:**
- Clean semantic separation
- Full 0-100 range for eligible
- Identity doesn't dilute quality signal
- Decision independent of quality score
- Matches executive mental model

**Risks:**
- Larger architectural change
- Requires renormalization
- UI must handle N/A

**Verdict:** Best conceptual model. Recommended if implementation feasible.

---

### OPTION 3: Dual Score Architecture

**Formula:**
```
// Quality Score (continuous)
Quality Score = (0.30 × capability) + (0.25 × career) + (0.15 × opportunity) + (0.30 × identity)
Quality Score = 0-100 (all opportunities, continuous)

// Actionability Score (derived)
Actionability = Quality Score
if (vetoed) Actionability = 0
if (Friction > 20) Actionability -= 10
if (SP < 30) Actionability -= 5

// Decision (from Actionability)
PURSUE if Actionability >= 70
CONSIDER if Actionability >= 60
PASS otherwise
```

**Changes from Current:**
- Two scores: Quality (continuous) and Actionability (derived)
- Quality Score for ALL opportunities
- Actionability Score for decision
- Display both

**Identity Treatment:** Weighted in Quality Score, can cause veto in Actionability

**Friction Treatment:** Affects Actionability, not Quality

**Hard Vetoes:** Quality Score calculated, Actionability = 0

**Meaning of 0:**
- Quality Score 0 = worst opportunity
- Actionability 0 = not actionable (vetoed or very low quality)

**Expected Distribution:**
- Quality Score: Full 0-100 for all 1,514
- Actionability: Bimodal (0 or 60+)

**Impact on Representative Cases:**
- Case A (59): Quality = 59, Actionability = 59 (if not vetoed), Decision = PASS
- Vetoed: Quality = calculated, Actionability = 0

**Advantages:**
- Most information preserved
- Users see both quality and actionability
- Flexible

**Risks:**
- Complex (two scores)
- Might confuse users
- More UI work

**Verdict:** Most flexible but potentially confusing.

---

## COMPARISON SUMMARY

| Criterion | Option 1 (Minimal) | Option 2 (Clean) | Option 3 (Dual) |
|-----------|-------------------|------------------|-----------------|
| Architectural change | Low | Medium | High |
| Semantic clarity | Low | High | Medium |
| Score range | 0-92 | 0-100 | 0-100 (both) |
| Information loss | Some | Minimal | None |
| User complexity | Low | Low | High |
| Implementation risk | Low | Medium | High |
| Matches product promise | Partial | Yes | Yes |

---

## PART 8: STOP

### NO PRODUCTION CHANGES MADE

This document is purely analytical. No code was modified:
- ✗ No DecisionPolicyEngine changes
- ✗ No threshold changes
- ✗ No UI changes
- ✗ No test changes

### NEXT STEPS (Require Product Approval)

1. **Choose between Options 1, 2, or 3**
2. **Decide on Identity treatment (Hypothesis A or B)**
3. **Approve semantic changes (Score vs. Decision)**
4. **Plan implementation approach**

### QUESTIONS FOR PRODUCT

1. **Is losing 52% of corpus from the quality index acceptable?** (Option 2)
2. **Is showing low quality scores (0-59) acceptable to users?**
3. **Do we want one score or two?** (Quality vs. Actionability)
4. **Is the implementation cost of Option 2 justified?**
5. **Should we start with Option 1 and evolve to Option 2?**

---

**DESIGN REVIEW COMPLETE**

**STATUS: AWAITING PRODUCT DECISION**
