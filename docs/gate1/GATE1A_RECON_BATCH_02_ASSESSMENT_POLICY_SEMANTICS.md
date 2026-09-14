# Gate 1A Recon — Batch 02: Assessment + Policy Semantics

Status: **OBSERVED / PARTIAL RECON**  
Gate: **1 of 3**  
Scope of this batch: assessment engines, shortlisting/quality scoring, decision policy, and the current requirement/evidence matching model.  
No production behavior changed in this batch.

## Why this batch exists

Batch 01 established that RADAR already has a strong canonical persistence boundary, but that the evaluator orchestration is coupled to presentation and the canonical v4.3 payload does not persist the full intermediate reasoning substrate.

This batch asks a narrower question before any new `EvaluationSnapshot`, `RoleCandidateEvidenceGraph`, or dossier-planning stack is designed:

> How much of the current intelligence core is actually reusable as authoritative reasoning, and how much is heuristic/product policy that must be separated or replaced?

The answer is mixed. There is valuable prior art, especially in semantic evidence resolution, explicit requirement matching, immutable candidate/job projections, fail-closed evaluation states, and policy-versioned decision thresholds. But several current assessment outputs are not clean facts. They blend source evidence, regex/string heuristics, synthetic defaults, transferability assumptions, and product-policy scoring into objects that downstream code treats as authoritative.

## Files inspected

Primary scope:

- `src/lib/intelligence/engines/IdentityAssessmentEngine.ts`
- `src/lib/intelligence/utils/IdentityDistanceCalculator.ts`
- `src/lib/intelligence/engines/CapabilityAssessmentEngine.ts`
- `src/lib/intelligence/semantic/RequirementEvidenceAdapter.ts`
- `src/lib/intelligence/semantic/types.ts`
- `src/lib/intelligence/engines/OpportunityAssessmentEngine.ts`
- `src/lib/intelligence/engines/CareerAssessmentEngine.ts`
- `src/lib/intelligence/engines/CareerValueEngine.ts`
- `src/lib/intelligence/engines/LifestyleAssessmentEngine.ts`
- `src/lib/intelligence/calculators/ShortlistingPotentialCalculator.ts`
- `src/lib/intelligence/policy/QualityScoreCalculator.ts`
- `src/lib/intelligence/policy/DecisionPolicyEngine.ts`
- `src/lib/intelligence/policy/DecisionRule.ts`
- `src/data/ontology/decision_policy.json`
- `src/lib/domain/semantic.ts`
- `src/domain/evidence.ts`
- `src/lib/domain/candidate_projection.ts`
- `src/lib/intelligence/builders/CandidateProjectionBuilder.ts`
- `src/lib/intelligence/context.ts`
- `src/lib/intelligence/engine.ts` (only the orchestration needed to establish how these components are actually wired)

This is still not a full audit of every classifier/resolver feeding the projections. Those remain later recon work if needed.

## 1. Current assessment/policy path

For a non-sparse opportunity, the evaluator currently executes:

```text
CandidateProjection + EvaluationJobProjection
  ↓
IdentityAssessmentEngine
CapabilityAssessmentEngine
OpportunityAssessmentEngine
CareerAssessmentEngine
LifestyleAssessmentEngine
  ↓
calculateShortlistingPotentialFromAssessments
  ↓
CareerValueEngine
  ↓
DecisionPolicyEngine
    ↳ EvidenceGate again
    ↳ IdentityDistanceCalculator again
    ↳ QualityScoreCalculator
    ↳ hard gates / policy thresholds / friction / SP gates
    ↳ claim permissions / drivers / risks / UI-facing labels
  ↓
RecommendationRecord
```

Two immediate architectural consequences follow:

1. The assessment layer is **not purely fact-producing**. Several engines already embed policy and editorial interpretation.
2. `DecisionPolicyEngine` is **not purely decision policy**. It recomputes semantic judgments, creates claim permissions, creates narrative drivers/risks, and emits UI-facing text in addition to deciding `PURSUE | CONSIDER | PASS`.

The long-term boundary should therefore preserve useful primitives while separating:

```text
source/projection facts
  → requirement relationships / derived assessment facts
  → policy decision
  → editorial interpretation / composition
```

rather than treating every current `*Assessment` field as equally canonical.

## 2. Identity semantics are not reusable as authoritative truth in their current form

### 2.1 `IdentityAssessmentEngine` is deterministic, but its inputs are weak

The engine takes the candidate's first `executiveTheme` (through `CandidateEvaluationContext.primaryIdentityStr`) and compares it to `job.executiveIdentity.value`. If no candidate theme exists it uses `"UNKNOWN"`; if the job identity is absent it falls back to `"Commercial & Marketing Leadership"`.

That sounds fail-safe until the calculator is inspected.

### 2.2 `IdentityDistanceCalculator` silently maps unknown/unrecognized identities to commercial/marketing

`IdentityDistanceCalculator` initializes both candidate and job domains to:

```text
commercial_marketing
```

and only changes that domain if a small set of strings indicate technology/engineering, operations/delivery, or clinical/medical.

Therefore an unrecognized or `UNKNOWN` candidate identity is not represented as unknown. It becomes `commercial_marketing` by default. An unrecognized job identity does the same. The resulting distance can be `0.00`, which the assessment converts into a full identity match.

This is not just a coarse ontology. It is an **unknown → positive-domain coercion**.

### 2.3 The policy path recomputes identity using a different candidate source

`engine.ts` later derives `candIdentityVal` by reading an `executiveIdentity` property from the candidate projection via an untyped cast, then falls back to `"Commercial & Marketing Leadership"`.

But `CandidateProjection` does not define `executiveIdentity`, and `CandidateProjectionBuilder` does not populate that field. The canonical candidate identity inputs actually exposed by the projection are `executiveThemes`, attained title/seniority, structural classifiers, capabilities, and semantic evidence.

So there are currently two identity calculations with different inputs:

```text
IdentityAssessmentEngine
  candidate = first executiveTheme / UNKNOWN

DecisionPolicyEngine identity gate
  candidate = projection.executiveIdentity via cast
            → otherwise "Commercial & Marketing Leadership"
```

This means the final policy identity veto is not cleanly consuming the already-produced identity assessment; it re-derives identity with a fallback that is effectively commercial by construction.

### Batch conclusion — identity

The concept of an explicit identity-distance gate is useful. The current implementation is not sufficiently evidence-faithful to become a future canonical `EvaluationSnapshot` field unchanged.

**Disposition:**

- `IdentityAssessmentEngine` → `REFACTOR_SUBSTANTIALLY`
- `IdentityDistanceCalculator` → `REPLACE`

The replacement should consume an explicit, source-backed identity representation and return `UNKNOWN` when identity cannot be resolved. Unknown must never collapse into the dominant/default positive domain.

## 3. Capability matching contains the strongest reusable intelligence — but the engine mixes proof with synthetic transferability

### 3.1 Strong existing foundation

The current capability path already has several concepts worth preserving:

- explicit job capabilities and taxonomy tiers;
- candidate `CanonicalSemanticEvidence`;
- requirement-specific satisfaction rather than universal ontology equivalence;
- negation and aspirational-evidence filtering;
- semantic relationship types;
- evidence relationship types;
- direct-vs-supporting evidence distinctions;
- candidate/job evidence IDs on `EvidenceMatch`;
- explicit missing capabilities;
- a pure `RequirementEvidenceAdapter` that does not mutate scores or policy.

`RequirementEvidenceAdapter` is especially important prior art. Its invariant is correct: semantic resolution answers what evidence means; requirement satisfaction separately decides whether that meaning satisfies a particular requirement. It explicitly prevents examples such as EBITDA accountability from automatically satisfying P&L ownership.

### 3.2 `RequirementEvidenceAdapter` is useful, but it is not yet a complete evidence graph

The adapter returns:

```text
satisfies
strength
confidence
reason
matchedProof
matchedEvidence
```

and the semantic evidence object retains concept, entity type, relationship, directionality, confidence, source phrase, context, temporal state, negation, evidence strength, and metadata.

That is close to the relationship primitive needed by a future evidence graph.

However:

- capability matching returns on the **first** satisfying evidence item rather than ranking all candidate evidence;
- several mappings are still hardcoded string rules;
- `matchedEvidence` is subsequently collapsed by `CapabilityAssessmentEngine` into a simpler `EvidenceMatch` plus optional ID arrays;
- missing capabilities are represented as decorated strings such as `"capability [CORE_MANDATE]"`, not typed relationship nodes;
- `EvidenceMatch` does not itself carry an explicit `DIRECT_MATCH | ADJACENT | GAP | UNKNOWN` relationship type;
- source IDs are not first-class fields on `CanonicalSemanticEvidence`; trace resolution relies partly on `metadata.sourceId` or generated fallback IDs.

So this is **not yet the future `RoleCandidateEvidenceGraph`**, but it is the strongest implementation seed found in this batch.

### 3.3 `CapabilityAssessmentEngine` adds policy-heavy transferability after semantic evidence matching

After trying requirement-aware semantic evidence, the engine falls through a sequence of increasingly inferential mechanisms:

1. substring matching;
2. executive-scope grounding;
3. hardcoded operational-equivalence clusters;
4. ontology relationship graph paths;
5. an executive-potential floor.

Several of these are useful hypotheses for transferability, but they are not equivalent to direct candidate evidence.

A particularly important example is the executive-scope branch. A generic executive capability can be treated as supported when the candidate has enterprise decision authority/commercial scope, and the returned `matchedProof` can be synthesized as:

```text
Enterprise P&L Ownership & <...> Board Decision Authority
```

That phrase is not necessarily a source-backed candidate fact. The trace helper then attempts to resolve evidence IDs for the synthesized proof; it can legitimately return no evidence IDs.

### 3.4 Potential is blended into fit strongly enough to mask absence of evidence

The engine computes two vectors:

```text
evidenceStrength
capabilityPotential
```

then defines:

```text
overallFit = capabilityPotential * 0.70 + evidenceStrength * 0.30
```

For an executive candidate, the fallback potential floor can be materially positive even when direct capability evidence is absent. That can yield a non-trivial `overallFit` despite the required capability remaining in `missingCapabilities`.

The policy layer partly protects material requirements by downscaling a `PURSUE` when a required `CORE` capability is explicitly missing, but the underlying assessment object still conflates:

- demonstrated fit;
- transferable/adjacent potential;
- product-policy optimism.

Those should be separate outputs.

### Batch conclusion — capability/evidence

Keep and evolve the semantic evidence model and requirement-specific relationship concept. Do not preserve the current composite capability fit as the sole canonical truth.

**Disposition:**

- `RequirementEvidenceAdapter` → `REUSE_WITH_NEW_INPUT_CONTRACT`
- `CanonicalSemanticEvidence` / semantic relationship model → `REUSE_WITH_NEW_INPUT_CONTRACT`
- `EvidenceMatch` → `REUSE_WITH_NEW_INPUT_CONTRACT`
- `CapabilityAssessmentEngine` → `REFACTOR_SUBSTANTIALLY`

The future evaluator should expose at least two separate channels:

```text
DEMONSTRATED / SOURCE-BACKED SATISFACTION
TRANSFERABLE / ADJACENT POTENTIAL
```

and policy should decide how much adjacency is allowed for a particular requirement. Potential must not silently mutate factual satisfaction.

## 4. Opportunity assessment is predominantly heuristic re-interpretation, not a clean consumer of structured projection truth

`OpportunityAssessmentEngine` re-parses title and description text with a large set of regex/string rules to determine:

- mandate type;
- mandate scope;
- executive vs functional vs execution level;
- experience range;
- seniority signal;
- operating-level/work-nature/scope assessment;
- final opportunity score.

It contains company/context-specific overrides and explicit special cases, including named-company patterns and title phrases. It also assigns numeric modifiers directly from title strings.

This is strategically different from the stronger `JobProjectionBuilder` direction, where structured grounded dimensions and semantic evidence should already be the authoritative substrate.

The engine therefore duplicates extraction/classification work inside the evaluator and turns that re-parsed text into a score treated as canonical input by `QualityScoreCalculator`.

**Disposition:** `OpportunityAssessmentEngine` → `REPLACE`

The replacement should consume typed job-projection facts and emit typed assessment facts/uncertainties. Regex/text classifiers may remain upstream extraction helpers, but should not be the final authoritative opportunity-assessment boundary.

## 5. Career semantics combine valid structural comparisons with arbitrary valuation policy

### 5.1 `CareerAssessmentEngine` has a reusable structural kernel

The engine correctly compares candidate and job operating levels and fails when either level is unknown. That fail-closed behavior is useful.

But the engine then mixes the structural comparison with product-policy valuation:

- company/role/description keyword search against brand tiers;
- fixed brand-capital values;
- fixed scope/commercial multipliers;
- fixed regression risk multipliers;
- default execution-ambiguity risk;
- a fixed `+40` baseline in net career value.

The result is then labeled `FORWARD | LATERAL | BACKWARD` and scored as career value.

### 5.2 `CareerValueEngine` mixes fact, heuristic, and prediction

The breakdown is a useful shape:

- title progression;
- scope expansion;
- commercial scale;
- brand signal;
- future optionality.

But the implementation assigns hardcoded values and textual reasons from string checks and defaults. Examples include:

- explicit P&L text → `0.95` commercial scale;
- executive job + high commercial scale → `0.95` future optionality and a `"Path to CEO/Board"` reason;
- unknown brand metadata → neutral `0.5`;
- default future optionality → estimated `0.6`.

The decomposition is worth preserving; the current numbers are policy hypotheses rather than authoritative facts.

**Disposition:**

- structural level-comparison primitive → `REUSE_WITH_NEW_INPUT_CONTRACT`
- `CareerAssessmentEngine` → `REFACTOR_SUBSTANTIALLY`
- `CareerValueEngine` → `REFACTOR_SUBSTANTIALLY`

Future state should persist the observed/derived career facts separately from user-specific value weights and optionality predictions.

## 6. Lifestyle has useful preference logic, but unknowns are currently converted into positive fit

`LifestyleAssessmentEngine` has a useful policy-backed location-cluster mechanism and explicit work-model comparison. But several semantics are not safe as authoritative facts:

- if candidate-specific location preferences are effectively absent, location fit becomes `true`;
- compensation fit is hardcoded to `true`;
- schedule mismatch is searched only in `role + location`, not the full job description;
- evidence count is returned as `4` regardless of which of those dimensions were actually evidenced;
- unknown job details are often represented as compatible rather than unresolved.

A future evaluator should distinguish:

```text
FIT
MISMATCH
UNKNOWN / NOT_SPECIFIED
```

for each lifestyle dimension. User preference policy can then decide whether unknown is acceptable.

**Disposition:** `LifestyleAssessmentEngine` → `REFACTOR_SUBSTANTIALLY`

## 7. Shortlisting potential is a policy score, not an assessment fact

`ShortlistingPotentialCalculator` is deterministic and has already been refactored to avoid the old direct circular dependency on the final decision. That is a useful improvement.

However the score remains a product-policy construct. It uses fixed weights and fixed floors/defaults:

```text
requirements alignment 35%
evidence strength       25%
title/scope alignment   20%
seniority fit           10%
domain fit              10%
```

Notable semantics include:

- requirements score gets a `+40` uplift;
- no capabilities defaults requirements score to `50`;
- no usable confidence can default evidence strength to `60`;
- no domain-familiarity gaps yields `90` domain fit;
- seniority/title components collapse assessments into fixed buckets such as `80/60/50/40`;
- the legacy decision-dependent interface remains in the same module for backward compatibility.

This is not a probability calibrated from observed hiring outcomes. It is an interpretable heuristic ranking/policy signal.

**Disposition:** `ShortlistingPotentialCalculator` → `REFACTOR_SUBSTANTIALLY`

Preserve the idea of a separate shortlist/accessibility signal, but make its contract explicit as policy/estimate, not evidence truth. If retained, its assumptions/weights must be versioned and its unknown handling must be explicit.

## 8. `QualityScoreCalculator` is cleanly centralized, but it still converts unknowns into synthetic scores

A positive finding is that the intrinsic quality formula is centralized. The non-identity weights in code match `decision_policy.json`:

```text
career      0.4615
capability  0.2308
opportunity 0.3077
```

Identity acts as an eligibility gate rather than a weighted score, which is conceptually defensible.

But unknown components are assigned synthetic numeric values:

- unavailable capability → `50`;
- absent opportunity score → `80`.

Those values are then blended into the authoritative quality score. This means an unknown is not merely carried forward as uncertainty; it changes the score as if a neutral/high observation existed.

The weights are also hardcoded in `QualityScoreCalculator` even though the same weights exist in `decision_policy.json`, creating a potential configuration-drift surface.

**Disposition:** `QualityScoreCalculator` → `REFACTOR_SUBSTANTIALLY`

Retain central versioned scoring, but require explicit missing-data semantics. A future quality score should either be computable from known components with an explicit coverage/confidence model or be unavailable—not silently imputed with product defaults unless the policy contract explicitly calls that out.

## 9. Decision policy contains valuable gates, but it currently spans four architectural layers

`DecisionPolicyEngine` contains several good policy ideas worth preserving:

- sparse-spec fail-closed handling;
- evidence-integrity failure handling;
- explicit `NOT_EVALUABLE` / `SPARSE_SPEC` states;
- identity mismatch gate;
- capability threshold gate;
- required core-capability downscaling;
- specialist-domain downscaling;
- shortlisting-potential gating;
- pursuit-friction gating;
- career-value protection (`easy trap`);
- versioned numeric thresholds from `decision_policy.json`;
- triggered rule IDs.

But the class is not just policy. It also:

1. recomputes identity distance rather than consuming one canonical identity relationship;
2. calculates recommendation confidence;
3. constructs claim permissions;
4. derives presentation-facing decision drivers/risks;
5. constructs UI labels and narrative strings;
6. derives tailoring effort, trajectory-upside prose, and relative-differentiator prose;
7. consumes both structured assessments and raw job-description text.

### 9.1 Claim permission is currently coupled to inference rather than only evidence

The most important example is `TRANSFORMATION` permission. It is allowed when either:

- raw source text contains `transform`;
- grounded mandate evidence supports transformation; **or**
- career trajectory equals `FORWARD`.

A forward career judgment is not evidence that the role itself is a transformation mandate. This shows why claim permissions should live downstream of a typed evidence/relationship graph, not be created inside decision policy from a mixture of source text and recommendation inference.

### 9.2 The policy trace has a units inconsistency

`decision_policy.json` defines `capabilityCutoff = 0.25`, which is correctly used against `capability.overallFit` on the `[0,1]` scale in the actual capability policy gate.

But the diagnostic `pipeline` first converts capability fit to a `[0,100]` `capabilityScore`, then compares that score to the same `0.25` cutoff when assigning pipeline `PASS | FAIL`.

So the final policy gate and the trace-stage status are using different units for the same configured threshold. This appears to be a trace/observability inconsistency rather than the principal verdict gate, but it is another reason not to treat the current trace as the future canonical reasoning graph unchanged.

### 9.3 A separate `DecisionRule.ts` rule table exists alongside imperative policy code

`DecisionRule.ts` defines declarative priority rules (`R-900`, `R-800`, lifestyle vetoes, promotion/match, capability confidence modifier), while `DecisionPolicyEngine` contains its own large imperative decision tree and newer rule IDs.

This batch does not declare the declarative table dead because usage outside the inspected path has not been exhaustively proven. It does establish that the authoritative runtime path inspected in `engine.ts` calls `DecisionPolicyEngine.evaluate(...)` directly. Later cleanup should resolve whether `DecisionRule.ts` remains an active compatibility artifact or is removable.

**Disposition:** `DecisionPolicyEngine` → `REFACTOR_SUBSTANTIALLY`

The rule intent should largely survive, but the future engine should consume an explicit evaluation snapshot and return only policy artifacts:

```text
verdict
rule IDs
policy reasons
policy confidence/coverage if needed
policy version
```

Claim permissions, editorial prose, and UI labels should not be part of the decision-policy truth kernel.

## 10. Evidence model: strong primitives exist, but the current capability trace is not yet the target graph

There are currently three related layers:

### A. Raw immutable evidence

`src/domain/evidence.ts` defines:

```text
ExtractedFact
EvidenceGraph
ExtractionProvenance
```

with source spans, document hashes, extractor/prompt/model versions, and immutable lineage. This is strong prior art and should be retained.

### B. Canonical semantic evidence

`CanonicalSemanticEvidence` adds normalized meaning, semantic/evidence relationships, directionality, confidence, negation, temporality, strength, source phrase, context, and metadata.

This is also strong prior art.

### C. Requirement relationship trace

`RequirementEvidenceAdapter` creates a requirement-specific relationship, and `CapabilityAssessmentEngine` emits `EvidenceMatch` with optional job/candidate evidence IDs.

That final layer is the part closest to a future role↔candidate evidence graph, but it currently loses too much structure and only represents accepted matches cleanly.

### Batch conclusion — evidence graph direction

Do **not** invent a parallel evidence system. Evolve these existing layers into a typed graph whose relationship record can carry, at minimum:

```text
requirementId / requirement concept
candidate evidence node IDs
job evidence node IDs
relationship = DIRECT | STRONG_SUPPORT | ADJACENT | GAP | UNKNOWN
confidence
reason/rule ID
source/provenance references
policy-independent satisfaction state
```

Then let capability assessment, decision policy, and dossier planning consume the same relationship graph instead of each reconstructing evidence semantics independently.

## 11. Reuse classification for Batch 02

| Component | Classification | Reason |
| --- | --- | --- |
| `IdentityAssessmentEngine` | `REFACTOR_SUBSTANTIALLY` | Useful explicit dimension, but candidate/job fallback behavior and weak identity representation can create false positive matches. |
| `IdentityDistanceCalculator` | `REPLACE` | Unknown/unrecognized identities default to commercial/marketing; tiny hardcoded domain map is not an authoritative semantic distance model. |
| `CanonicalSemanticEvidence` types | `REUSE_WITH_NEW_INPUT_CONTRACT` | Strong semantic/provenance concepts; source identity and requirement linkage should become more explicit. |
| `RequirementEvidenceAdapter` | `REUSE_WITH_NEW_INPUT_CONTRACT` | Correct separation of semantic meaning from requirement satisfaction; needs typed/ranked multi-evidence relationships rather than first-match collapse. |
| `EvidenceMatch` | `REUSE_WITH_NEW_INPUT_CONTRACT` | Existing job/candidate evidence IDs are valuable, but relationship type, missing/unknown state, and richer provenance should be first-class. |
| `CapabilityAssessmentEngine` | `REFACTOR_SUBSTANTIALLY` | Strong evidence-aware core is mixed with hardcoded equivalence, synthetic proof, potential floors, and a 70/30 potential-vs-evidence composite. |
| `OpportunityAssessmentEngine` | `REPLACE` | Re-parses raw text through extensive regex/company/title heuristics instead of treating structured job projection as the canonical substrate. |
| `CareerAssessmentEngine` | `REFACTOR_SUBSTANTIALLY` | Structural level comparison is useful; brand/scoring/risk constants are policy and should be separated. |
| `CareerValueEngine` | `REFACTOR_SUBSTANTIALLY` | Good decomposition, but numeric valuation and optionality predictions are hardcoded heuristic policy. |
| `LifestyleAssessmentEngine` | `REFACTOR_SUBSTANTIALLY` | Location/work-model logic is useful; unknowns become positive fits and compensation is always true. |
| `ShortlistingPotentialCalculator` | `REFACTOR_SUBSTANTIALLY` | Deterministic and separate from final decision, but still a fixed heuristic policy score with synthetic defaults/floors. |
| `QualityScoreCalculator` | `REFACTOR_SUBSTANTIALLY` | Centralized scoring is good; unknown capability/opportunity values are imputed as 50/80 and weights are duplicated in code/config. |
| `DecisionPolicyEngine` | `REFACTOR_SUBSTANTIALLY` | Preserve gates/rule intent; separate identity recomputation, claim permissions, narrative, UI, and raw-text interpretation from policy. |
| `ExtractedFact` / `EvidenceGraph` / extraction provenance | `REUSE_AS_IS` candidate | Immutable source facts and lineage are the strongest truth primitive inspected in this batch. |
| `engine.ts` assessment/policy orchestration | `REFACTOR_SUBSTANTIALLY` | Confirmed Batch 01 finding: orchestration remains too broad and passes mixed truth/policy/presentation artifacts across layers. |

## 12. What should become future `EvaluationSnapshot` truth

Based on this batch, a future persisted evaluator snapshot should favor **typed facts and relationships**, not the current narrative/heuristic composites wholesale.

Likely durable outputs:

```text
identity relationship
  - resolved candidate identity IDs/evidence
  - resolved role identity IDs/evidence
  - relationship / distance
  - UNKNOWN when unresolved

capability relationships[]
  - requirement
  - direct/supporting/adjacent/gap/unknown
  - candidate evidence IDs
  - role evidence IDs
  - confidence
  - rule/reason

opportunity facts
  - operating level
  - work nature
  - commercial/accountability scope
  - mandate
  - reporting/people/financial scope
  - evidence + uncertainty

career deltas
  - level delta
  - scope delta
  - explicit regression/promotion facts
  - policy-independent uncertainty

lifestyle deltas
  - location/work-model/schedule/compensation states
  - FIT | MISMATCH | UNKNOWN

policy result
  - verdict
  - policy version
  - triggered rule IDs
  - decision hinges / blocking constraints
  - score only where its coverage/unknown semantics are explicit
```

What should **not** be elevated into canonical evaluation truth without redesign:

- synthetic proof phrases;
- implicit transferability floors;
- brand-capital constants;
- fixed future-optionality predictions;
- `UNKNOWN → fit` defaults;
- UI labels;
- editorial claim permissions;
- narrative drivers/risks assembled from untyped strings;
- duplicated raw-text regex classification after canonical projection exists.

## 13. Architectural decision from this batch

The intelligence core is **partially reusable, not reusable wholesale**.

The right migration direction is not:

```text
throw away evaluator
→ build a parallel DossierPlan intelligence stack
```

and it is also not:

```text
persist every current Assessment object as canonical truth
```

The supported direction is:

```text
existing immutable evidence/projections
  ↓
evolve semantic requirement relationships into a typed evidence graph
  ↓
refactor assessments to produce policy-independent facts + uncertainty
  ↓
persist an explicit EvaluationSnapshot / evolved canonical evaluation artifact
  ↓
run a narrower versioned DecisionPolicy over that snapshot
  ↓
feed the existing V2 proposition/editorial pipeline from those persisted semantics
```

This preserves the strongest parts of RADAR while removing hidden positive defaults and fact/policy/presentation coupling.

## 14. No implementation authorization yet

This batch does **not** authorize:

- replacing the evaluator immediately;
- changing current recommendation thresholds;
- changing v4.3 payload semantics in place;
- deleting `DecisionRule.ts`;
- introducing a parallel evidence graph disconnected from existing evidence types;
- rewriting the V2 dossier/editorial pipeline;
- changing UI/serving behavior.

The findings above should inform the next architecture boundary, but production changes should wait until the adjacent V2 editorial path is fully mapped.

## 15. Next small batch

**Batch 03 — Existing V2 editorial/proposition pipeline**

Inspect end-to-end:

```text
buildEvaluatedPresentationV2
  → buildEditorialIntelligenceContract
  → composeEditorialIntelligenceV2
  → CanonicalDossierPresentationV2
```

Specifically determine:

1. what exact evaluator/candidate/job inputs the V2 contract consumes;
2. whether propositions already distinguish fact, inference, limitation, and recommendation strongly enough;
3. where proposition text is deterministic vs composed/invented;
4. whether the V2 contract can consume the evolved evidence relationships proposed above;
5. whether the existing V2 artifact is already the practical `DossierPlan`, or whether a thinner planning contract is still required;
6. which memo sections from the product-quality reference can be rendered from existing V2 propositions without creating a second intelligence stack.

Do not begin implementation until that path is classified.