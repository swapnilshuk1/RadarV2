# P4-A PHASE 1: FORENSIC SCORE TRACE

## Complete Scoring Path Documentation

### Score Entry Point

**File:** `src/lib/intelligence/policy/DecisionPolicyEngine.ts`
**Function:** `evaluate()`
**Lines:** 262-270

### Exact Scoring Formula

```typescript
// Line 254-267: Weighted Component Calculation
const rawInteractiveScore = 
  baseWeights.identity * identityScore +
  effectiveCareerWeight * careerScore +
  baseWeights.opportunity * opportunityScore +
  effectiveCapWeight * capabilityScore -
  locationFriction;

// Line 270: Bounding and Rounding
const rawScore = Math.min(100, Math.max(0, Math.round(rawInteractiveScore)));
```

### Component Breakdown

#### 1. Identity Score
- **Source:** `IdentityAssessmentEngine`
- **Calculation:** `identityScore` (0-100)
- **Weight:** `baseWeights.identity` (see baseWeights below)
- **Interaction:** Used to calculate multipliers (lines 255-256)

#### 2. Career Score
- **Source:** `CareerAssessmentEngine`
- **Calculation:** Line 250
  ```typescript
  const careerScore = (career as any).careerScore || Math.max(0, 80 - (career.regressionScore || 0));
  ```
- **Default:** 80 if careerScore not provided
- **Weight:** `effectiveCareerWeight` (base * interaction multiplier)

#### 3. Opportunity Score
- **Source:** `OpportunityAssessmentEngine`
- **Calculation:** Line 251
  ```typescript
  const opportunityScore = (opportunity as any).opportunityScore || 80;
  ```
- **Default:** 80
- **Weight:** `baseWeights.opportunity`

#### 4. Capability Score
- **Source:** `CapabilityAssessmentEngine`
- **Calculation:** `capabilityScore` (0-100)
- **Weight:** `effectiveCapWeight` (base * interaction multiplier)

#### 5. Location Friction (Subtractive)
- **Source:** `LifestyleAssessmentEngine`
- **Calculation:** Line 252
  ```typescript
  const locationFriction = (lifestyle as any).locationFrictionPenalty || 0;
  ```
- **Applied:** Direct subtraction from score

### Weights

#### Base Weights (from decision_policy.json)
Located in: `src/data/ontology/decision_policy.json`

```json
{
  "weights": {
    "identity": 0.30,
    "capability": 0.35,
    "career": 0.25,
    "opportunity": 0.10
  }
}
```

#### Interaction Multipliers (Lines 254-259)
```typescript
// Identity-distance penalizes both capability and career
const capabilityInteractionMultiplier = Math.max(0.20, 1.0 - 0.70 * identityDistance);
const careerInteractionMultiplier = Math.max(0.30, 1.0 - 0.50 * identityDistance);

const effectiveCapWeight = baseWeights.capability * capabilityInteractionMultiplier;
const effectiveCareerWeight = baseWeights.career * careerInteractionMultiplier;
```

**Key insight:** Identity distance penalizes BOTH capability and career scores through multipliers.

### Score Boundaries

- **Floor:** 0 (hard floor via Math.max(0, ...))
- **Ceiling:** 100 (hard ceiling via Math.min(100, ...))
- **Rounding:** Math.round() to nearest integer

### Veto Interaction

**Hard Vetoes:** (Lines 358-445)
- Sub-Tier mandate → vetoed = true, priority = 0
- Identity execution veto → vetoed = true, priority = null
- Career regression veto → vetoed = true, priority = null
- Capability critical gap → vetoed = true, priority = null

**Effect:** Vetoed opportunities have priority = 0 or null, but rawScore is preserved.

### Easy Trap Rule (P3)

**Location:** Lines 485-494

```typescript
// Approved Rule 1: CV < 50 AND SP >= 80 AND Friction < 10
const spHigh = shortlistingPotentialScore >= 80;
const frictionLow = locationFriction < 10;
const careerValueLow = careerScore < 50;

if (spHigh && frictionLow && careerValueLow && initialDecision === "PURSUE") {
  // Downgrade to CONSIDER
}
```

**Effect on Score:** None - Easy Trap affects decision, not score.

### Score to Decision Mapping

**File:** `src/lib/intelligence/decision.ts`
**Lines:** 10-12

```typescript
if (priority >= 70) return "PURSUE";
if (priority >= 60) return "CONSIDER";
return "PASS";
```

**Thresholds (from decision_policy.json):**
- PURSUE: ≥70
- CONSIDER: ≥60
- PASS: <60

### Decision to Priority Mapping

**In Record:** `priority` field
- 0 or null if hard vetoed
- Otherwise = rawScore

### Score Display

**File:** `src/lib/intelligence/present.ts`
**Lines:** 83-84

```typescript
const scoreVal = record.priority !== null ? Math.round(record.priority) : 0;
const scoreStr = record.priority !== null ? `${Math.round(record.priority)}/100` : "N/A";
```

### Confidence Calculation

**Lines:** 272-284

```typescript
const parsingConfidence = Math.min(1.0, 
  (identity.evidenceCount > 0 ? 0.9 : 0.6) * 
  (capability.evidenceCount > 0 ? 0.95 : 0.5)
);

const matchingConfidence = capability.matchingConfidence || 0.8;

let recommendationConfidence = (parsingConfidence * 0.4) + (matchingConfidence * 0.6);
if (evidenceCount < 3) recommendationConfidence -= 0.15;
if (capability.missingCapabilities.length > 2) recommendationConfidence -= 0.10;
if (locationFriction > 10) recommendationConfidence -= 0.10;
recommendationConfidence = Number(Math.max(0.35, Math.min(0.98, recommendationConfidence)).toFixed(2));
```

**Note:** Confidence affects display, NOT the score itself.

## Dependency Graph

```
Input Assessments:
├── IdentityAssessment
│   └── identityScore (0-100)
│   └── identityDistance (0-1)
│   └── evidenceCount
├── CapabilityAssessment
│   └── capabilityScore (0-100)
│   └── matchingConfidence
│   └── evidenceCount
│   └── missingCapabilities[]
├── CareerAssessment
│   └── careerScore (0-100) OR calculated: max(0, 80 - regressionScore)
│   └── regressionScore
│   └── trajectory (FORWARD/LATERAL/BACKWARD)
├── OpportunityAssessment
│   └── opportunityScore (default: 80)
└── LifestyleAssessment
    └── locationFrictionPenalty (default: 0)

Scoring Calculation:
├── Interaction Multipliers
│   ├── capabilityInteractionMultiplier = max(0.20, 1.0 - 0.70 * identityDistance)
│   └── careerInteractionMultiplier = max(0.30, 1.0 - 0.50 * identityDistance)
├── Effective Weights
│   ├── effectiveCapWeight = 0.35 * capabilityInteractionMultiplier
│   ├── effectiveCareerWeight = 0.25 * careerInteractionMultiplier
│   └── identityWeight = 0.30 (unchanged)
│   └── opportunityWeight = 0.10 (unchanged)
└── rawInteractiveScore = 
    (0.30 * identityScore) +
    (effectiveCareerWeight * careerScore) +
    (0.10 * opportunityScore) +
    (effectiveCapWeight * capabilityScore) -
    locationFriction

Final Score:
└── rawScore = round(min(100, max(0, rawInteractiveScore)))

Decision Policy:
├── Veto Check (can set priority = 0/null)
├── Easy Trap Check (can downgrade PURSUE → CONSIDER)
└── Threshold Check (rawScore ≥70 = PURSUE, ≥60 = CONSIDER, else PASS)

Output:
└── priority = vetoed ? 0/null : rawScore
```

## Potential Duplication/Double-Counting

### ❌ NO DUPLICATION DETECTED

Each component contributes only once:
- Identity: Once (0.30 weight)
- Capability: Once (effective weight, distance-adjusted)
- Career: Once (effective weight, distance-adjusted)
- Opportunity: Once (0.10 weight)
- Location Friction: Once (subtracted)

### ⚠️ POTENTIAL ISSUE: Identity Distance Double Impact

Identity distance affects score twice:
1. Direct: identityScore is included
2. Indirect: identityDistance reduces capability and career weights

**Question:** Should distance penalize the score twice (direct + indirect)?

## Decision-Dependent Scoring?

### ✅ NO - Score is calculated BEFORE decision

Scoring order:
1. Calculate rawInteractiveScore (line 262-267)
2. Round and bound rawScore (line 270)
3. Run veto checks (lines 358-445)
4. Run Easy Trap check (lines 485-494)
5. Final decision based on thresholds

**Verdict:** Score is PRE-DECISION, as required.

## Presentation-Derived Scoring?

### ✅ NO - Score feeds presentation, not vice versa

- Score → Record
- Record → Presenter
- Presenter → Display

**Verdict:** No circular dependency.

## Hardcoded Values

### Identified:

| Value | Location | Purpose |
|-------|----------|---------|
| default: 80 | Line 250 | Career score fallback |
| default: 80 | Line 251 | Opportunity score fallback |
| 0.70 | Line 255 | Identity distance penalty for capability |
| 0.50 | Line 256 | Identity distance penalty for career |
| min: 0.20 | Line 255 | Minimum capability multiplier |
| min: 0.30 | Line 256 | Minimum career multiplier |

## Score Meaning

### Mathematical Meaning:

The 0-100 score is a **weighted combination** of:
- 30% Identity alignment
- ~25% Career value (distance-adjusted)
- ~35% Capability fit (distance-adjusted)
- 10% Opportunity attractiveness
- MINUS Location friction penalty

### Intended Meaning:

**"Overall executive-opportunity fit score"**

Higher = better fit across identity, capability, career, and opportunity dimensions, with identity distance penalizing both capability and career contributions.

### NOT:
- Probability of getting the job
- Probability of application success
- Expected salary
- Expected happiness

## Phase 1 Summary

### ✅ Working Correctly:
- Score calculation is deterministic
- Score is PRE-DECISION
- No circular dependencies
- No presentation-derived scoring
- Clear formula with documented weights
- Proper bounds (0-100)

### ⚠️ Potential Concerns:
- Identity distance has double impact (direct + via multipliers)
- Interaction multipliers reduce weights significantly (capability can drop to 0.07 from 0.35)
- Career score has hardcoded default of 80
- Opportunity score has hardcoded default of 80

### Next Steps:
Proceed to Phase 2: Full Corpus Distribution Analysis to see if these concerns manifest in actual score behavior.
