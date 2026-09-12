# RADAR Transition Control

Status: ACTIVE

This document is the governing execution record for the RADAR intelligence transition. It exists so architecture, scope, invariants, decisions, and gate state survive individual chat/agent sessions. It is not a progress narrative; it is a control surface.

## 1. Current Baseline

- Repository: `swapnilshuk1/RadarV2`
- Working branch: `phase5/gate1-architecture-recon`
- Frozen Extraction V1 baseline commit: `adbfc375ab3f1974cb73c87bc24279f3877ac610`
- Baseline commit message: `feat(intelligence): extraction v1 closure with frozen corpus invariants and high precision role propositions`
- Frozen corpus source branch: `codex/candidate-corpus-100`
- Frozen corpus commit: `e1f0a47575accedcd7fd3d681c7b084ca377b0fd`
- Current execution gate: **Gate 1 of 3 — Gate 1B substrate/provenance + extraction architecture decision**
- Gate 1A architecture reconnaissance: **COMPLETE**

The `adbfc37` extractors are a deterministic benchmark and fallback/reference implementation. They are **not assumed to be the final production extraction architecture**.

### Gate 1A reconnaissance record

Gate 1A completed six code-grounded reconnaissance batches before production implementation:

```text
Batch 01 — evaluation → materialization
  36af2ebabca1c1cb023f0968d2175cef431fba18

Batch 02 — assessment + policy semantics
  2d5b1a5ffef277cb3117a3d249623e3ff8ec4729

Batch 03 — V2 editorial/proposition architecture
  2e325882a6ab5586ccc54959d2b30f8d6536077b

Batch 04 — serving/read path + legacy coexistence
  f4e1ae73d3ccc66e816cda3c44bf3738b9cca25f

Batch 05 — source/provenance durability + V1 retirement prerequisites
  edb84ea92190b3c6d430fb845da0c267e626ab89

Batch 06 — contract reconciliation + migration sequence
  cf43e43185065e866b07680e357dc224889af10e
```

The governance correction is recorded in:

```text
docs/gate1/GATE1A_RECON_BATCH_06A_CONTROL_RECONCILIATION.md
```

Gate 1A established:

- the V2 persisted dossier/serving shell is reusable and should be evolved rather than discarded;
- a parallel second `DossierPlan` stack should not be introduced;
- the existing `EditorialIntelligenceContract` is the plan-like seam to evolve/version;
- semantic ownership must be split among source facts, role↔candidate relationships, evaluation, decision policy, editorial planning, composition, persistence and serving;
- source/provenance IDs must be lifetime-resolvable, not merely deterministic;
- candidate source immutability/versioning is therefore a legitimate prerequisite;
- v4.3 remains historical canonical truth and should receive a clean successor rather than semantic mutation;
- V1 remains compatibility-only until exact-input backfill/cutover coverage is proven.

**Still open:** the production extraction architecture. Gate 1A validated useful contracts and the deterministic baseline; it did **not** decide whether production role/candidate semantic extraction should be deterministic, LLM-first, or hybrid.

## 2. Product Goal

RADAR must turn a scraped job description and candidate evidence into a decision-grade executive opportunity dossier that is:

1. source-grounded;
2. explicit about uncertainty;
3. useful enough to drive a pursue / consider / pass decision;
4. able to explain why;
5. able to show what evidence supports the judgment;
6. able to identify what unknowns could change the decision;
7. consistent from evaluation through persistence, serving, and presentation.

The 100-case corpus is a **regression and research instrument**, not the universe of possible job descriptions.

## 3. Target End-to-End Architecture

```text
Scraped JD
   ↓
RoleIntelligence
                         ┐
Candidate Sources        │
   ↓                     │
CandidateProof           │
                         ↓
              RoleCandidateEvidenceGraph
                         ↓
                Advisory Evaluation
          ┌──────────────┼───────────────┐
          ↓              ↓               ↓
     Fit / identity   Career value   Friction/risk
          └──────────────┼───────────────┘
                         ↓
              Decision Policy
                         ↓
       Decision Hinges / Uncertainties
                         ↓
                PursuitStrategy
                         ↓
     EditorialIntelligenceContract / DossierPlan
                         ↓
              BriefCompositionEngine
                         ↓
                 Canonical Artifact
                         ↓
                Persistence / Serving
                         ↓
                       UI
```

## 4. Constitutional Invariants

These are architectural constraints. A local test pass cannot override them.

1. **Extraction discovers source facts.** It does not make candidate-role fit judgments or recommendations.
2. **Source provenance is mechanically verifiable.** Exact quotes/spans must resolve against the designated source.
3. **Matching establishes relationships.** It may classify the relationship between role evidence and candidate proof, but cannot invent either side.
4. **Evaluation makes policy-independent judgments.** Fit, identity, capability, career value, trajectory, friction, risks, uncertainty, intrinsic quality and confidence belong here.
5. **Decision policy owns the final recommendation.** `PURSUE | CONSIDER | PASS`, deterministic rule consequences, decision hinges and policy-level pursuit consequences must come from versioned policy, not prose generation.
6. **Unknowns remain unknown.** Missing reporting lines, P&L authority, compensation, team scale, etc. must not be silently filled with generic assumptions.
7. **Composition writes; it does not discover.** `BriefCompositionEngine` may choose wording, order, compression, emphasis, and transitions. It may not discover facts, create new evaluations, invent unknowns, or change the authoritative verdict.
8. **Persistence stores canonical evaluated truth.** Serving/presentation must not recompute advisory truth independently.
9. **Corpus performance does not define correctness.** Production rules may not be tailored to corpus IDs, company names, benchmark literals, or one-off source phrases.
10. **No subsystem is optimized in isolation.** Every change is evaluated for downstream effect on the final dossier and upstream truth guarantees.
11. **Agent reports are not implementation evidence.** Review actual code/diff first, tests second, report third.

## 5. Canonical Contracts to Establish

The transition should converge on explicit versioned contracts for:

### `RoleIntelligenceV1`
Source-grounded role/company/recruiting-process atoms with exact source anchors, semantic type, subject, normalized structured values where appropriate, and provenance.

### `CandidateProofV1`
Source-grounded candidate evidence: positions, bullets/source spans, atomic proof claims, structured metrics, dates/employers/titles, and provenance.

### `RoleCandidateEvidenceGraph`
For every material role atom/requirement, candidate evidence relationships such as:

- `DIRECT`
- `ADJACENT`
- `TRANSFERABLE`
- `UNSUPPORTED`
- `CONTRADICTED`
- `UNKNOWN`

Each edge must retain role evidence IDs, candidate proof IDs, rationale/relationship metadata, and confidence/epistemic status as appropriate.

### `EvaluationSnapshot`
The authoritative **policy-independent** advisory state, including at minimum:

- intrinsic quality / fit score;
- identity assessment;
- capability assessment;
- career value / trajectory assessment;
- lifestyle/friction assessment;
- decision drivers / strengths;
- decision risks / constraints;
- evidence completeness;
- decision confidence;
- explicit unknowns;
- provenance to graph/evidence IDs.

### `DecisionPolicyOutput`
The authoritative deterministic pursuit decision, including at minimum:

- final `PURSUE | CONSIDER | PASS` verdict;
- triggered policy/rule IDs;
- structured reasons/effects;
- policy version;
- provenance to the exact EvaluationSnapshot;
- structured decision hinges and pursuit consequences where policy-relevant.

### `DecisionHinges` / `Uncertainties`
Explicit unresolved questions and why they matter, including what confirming/rejecting the unknown would do to the recommendation.

### `PursuitStrategy`
Effort level, pursuit mode, tailoring depth, immediate next action, dependencies, stop conditions, and provenance to the authoritative evaluation/policy output.

### `EditorialIntelligenceContract` / `DossierPlan`
The immediate semantic input to composition. Gate 1A found that the existing `EditorialIntelligenceContract` already occupies this architectural slot and should be evolved/versioned rather than duplicated by a second plan stack. It selects the judgments and evidence that Sections I–IX may express. Every material item must be grounded by evidence/graph/evaluation/policy IDs and carry epistemic status.

Suggested epistemic labels:

- `OBSERVED`
- `DERIVED`
- `INFERRED`

Do not add labels casually; version the contract if semantics change.

## 6. Historical BriefCompositionEngine: Preserve vs Remove

The historical 21 Aug composition system is a **future composition baseline**, not an authority for factual discovery.

Preserve where useful:

- prioritization;
- ordering;
- editorial framing;
- decision sensitivity presentation;
- unknown ranking;
- career-value communication;
- concise executive wording;
- section structure / narrative flow.

Remove or move upstream where currently present:

- generic first-90-day claims;
- generic `whyNow` claims;
- assumed P&L / board / reporting-line conditions;
- generic team/headcount assumptions;
- generic compensation unknowns not grounded in source/evaluation state;
- invented deliverables;
- invented career upside/downside;
- any new verdict or fit reasoning created during composition.

Target composition boundary:

```ts
compose(editorialPlan, groundedContext)
```

not:

```ts
compose(opportunity)
```

where `opportunity` is an overloaded object containing mixed source, evaluation, UI, and presentation state.

## 7. Extraction Architecture Decision

Do **not** continue growing semantic regexes by default.

The production hypothesis to test is:

```text
Role raw text
   ↓
LLM semantic extraction
   ↓
mechanical source-span resolution
   ↓
closed ontology + subject validation
   ↓
normalization / deduplication / rejection
   ↓
RoleIntelligenceV1
```

For candidate evidence:

```text
Resume source
   ↓
deterministic position/bullet structure
   ↓
LLM proof decomposition / semantic classification
   ↓
mechanical exact-span verification
   ↓
deterministic metric normalization
   ↓
CandidateProofV1
```

The LLM should own language understanding where it materially improves generalization. Deterministic code should own truth/provenance enforcement, exact-source resolution, closed schemas, metric normalization where reliable, deduplication, cache identity, and fail-closed rejection.

The existing deterministic extractors remain the benchmark and possible fallback until the experiment proves replacement is justified.

### Extraction comparison must use more than the 100 cases

At minimum compare on:

- frozen 100-case regression corpus;
- unseen synthetic documents using unrelated companies/roles/vocabulary;
- formatting mutations;
- punctuation/heading mutations;
- reordered sections;
- near-negative/adversarial cases;
- duplicated source quotes / ambiguous anchors;
- sparse postings;
- company-context vs role-context contamination cases;
- requirement vs responsibility ambiguity;
- reporting/P&L/team/decision-authority false-positive cases.

The decision to switch must be based on empirical generalization and provenance integrity, not because one architecture is fashionable or easier to prompt.

## 8. Three-Gate Execution Plan

### Gate 1 — Substrate, Contracts, Extraction Architecture

Gate 1A reconnaissance is **complete**. Gate 1 remains open for Gate 1B implementation and extraction certification.

Scope:

- freeze `adbfc37` as deterministic baseline;
- inspect current end-to-end RADAR code before introducing contracts — **complete via Gate 1A recon**;
- define/reconcile canonical contracts — **substantially complete via Gate 1A recon**;
- identify existing reusable types/components and architectural conflicts — **complete enough to implement**;
- harden source/provenance immutability;
- implement an extraction provider boundary with the deterministic baseline preserved beside an LLM-backed path;
- share the same mechanical provenance/validation layer where practical;
- build a comparative audit harness using frozen + unseen/adversarial inputs;
- decide whether role extraction, candidate extraction, or both should be deterministic, LLM-first, or hybrid;
- persist the canonical source-fact contracts/implementation justified by that evidence.

#### Gate 1B implementation order

```text
Batch 01 — source/provenance immutability
Batch 02 — extraction provider boundary + common mechanical verifier
Batch 03 — LLM RoleIntelligence / CandidateProof experiment beside adbfc37
Batch 04 — frozen + unseen/adversarial comparison
Batch 05 — written extraction architecture decision
Batch 06 — canonical source-fact persistence/contracts
```

Do **not** begin EvidenceGraph implementation before the Gate 1 extraction decision and source-fact persistence are certified.

Gate 1 exit criteria:

- versioned contracts exist and compile;
- existing production behavior has not been silently rewired;
- source/evidence identities used canonically are lifetime-resolvable;
- deterministic baseline remains reproducible;
- LLM extraction is bounded behind an interface/adapter and is not serving production truth during the experiment;
- exact-source/provenance failures fail closed;
- comparative evidence covers unseen/adversarial inputs, not just corpus recall;
- a written role-extraction architecture decision is recorded with evidence;
- a written candidate-extraction architecture decision is recorded with evidence;
- selected canonical source-fact persistence is implemented against exact immutable source versions;
- no new corpus-specific production semantic rules are introduced.

### Gate 2 — Intelligence Core

Gate 2 does **not** begin until Gate 1 exit is certified.

Scope:

```text
RoleIntelligence + CandidateProof
        ↓
RoleCandidateEvidenceGraph
        ↓
EvaluationSnapshot
        ↓
DecisionPolicyOutput
        ↓
Unknowns / Decision Hinges
        ↓
PursuitStrategy
```

Gate 2 owns the implementation work that Batch 06 had temporarily grouped under `Gate 1B` for:

- typed persistent EvidenceGraph;
- policy-independent EvaluationSnapshot;
- deterministic DecisionPolicyOutput;
- structured Decision Hinges / Uncertainties;
- PursuitStrategy.

Gate 2 must structurally answer:

- What does the role materially require?
- What can the candidate actually prove?
- What is direct, adjacent, transferable, unsupported, contradicted, or unknown?
- Is the role worth pursuing?
- Why?
- What are the material risks?
- What is not known?
- Which unknowns could change the recommendation?
- How much effort should the candidate invest?

Gate 2 exit criteria:

- every material judgment traces to evidence/graph IDs;
- unsupported, contradicted and unknown remain distinct;
- uncertainties are explicit;
- verdict and strategy are authoritative and non-contradictory;
- no dossier prose is required to make the decision intelligible;
- evaluation does not rely on presentation-layer heuristics;
- policy is deterministic for the same exact evaluation + policy + pursuit inputs.

### Gate 3 — Dossier Plan, Composition, Canonical End-to-End

Gate 3 does **not** begin until Gate 2 exit is certified.

Scope:

```text
Evaluation + Policy package
      ↓
EditorialIntelligenceContract / EditorialPlan vNext
      ↓
BriefCompositionEngine / proposition composition
      ↓
Successor canonical persisted dossier artifact
      ↓
Dual-write / exact-input backfill
      ↓
Serving cutover
      ↓
V1 retirement
      ↓
UI
```

Gate 3 owns the implementation work that Batch 06 had temporarily grouped under `Gate 1B` for:

- evolved `EditorialIntelligenceContract` / EditorialPlan;
- successor persisted dossier;
- dual-write/parity work;
- exact-input backfill;
- serving cutover;
- V1 retirement.

Gate 3 exit criteria:

- Sections I–IX are planned from grounded judgments;
- composition cannot create new advisory facts;
- every material dossier claim is traceable to plan/evaluation/evidence/policy;
- canonical evaluated artifact is persisted and consumed directly;
- serving/presentation do not recompute candidate-specific advisory truth;
- end-to-end dossiers are materially useful, not merely schema-valid;
- 100% of reachable active legacy dossier states are classified before V1 removal;
- regression/build/test suites pass at the integration boundary.

## 9. Execution Timebox

Original planning target: **4–6 focused engineering days total**.

The target is subordinate to the gate evidence. Gate 1A reconnaissance expanded because code inspection exposed existing V2, legacy coexistence and provenance constraints that had to be understood before safe implementation.

From this point, do not compress below what evidence supports. A green unit suite is not a reason to close a gate early.

## 10. Supervisory Review Protocol

Every agent completion must be reviewed in this order:

1. **Re-read this control document.** Confirm current gate, scope, invariants, and exit criteria.
2. **Inspect actual HEAD and diff.** Do not start from the agent summary.
3. **Place the change in the whole RADAR pipeline.** State upstream dependencies and downstream consequences.
4. **Inspect adjacent tracks.** Verify the local solution does not create hidden debt elsewhere.
5. **Inspect targeted tests and audit implementation.** Determine what they actually prove and what they do not prove.
6. **Run/inspect the minimum necessary verification.** Prefer targeted tests during development; use full expensive suites at integration boundaries.
7. **Read the agent report last.** Compare its claims with the implementation and observed evidence.
8. **Update this file when a gate/decision changes.** The control record and code must not diverge.

Every supervisory response should begin with a compact orientation such as:

> Current gate: X/3. This change touches A/B. C is intentionally unchanged. Downstream effect: D. Principal architectural risk: E.

## 11. Whole-System Supervision Matrix

| Track | Supervisory question |
| --- | --- |
| Scraping / ingestion | Is source truth complete, stable, and faithfully preserved? |
| Role extraction | Are material JD facts recovered without invention or corpus overfit? |
| Candidate extraction | Are candidate proofs complete, atomic enough, and grounded? |
| Evidence graph | Are role ↔ candidate relationships defensible and traceable? |
| Evaluation / policy | Does the recommendation actually follow from grounded relationships and declared policy? |
| Unknowns / hinges | Are unresolved facts explicit, ranked, and decision-sensitive? |
| Pursuit strategy | Does recommended effort follow from the authoritative evaluation/policy? |
| Dossier planning | Is every planned statement grounded and epistemically labeled? |
| Composition | Is it expressing rather than discovering/evaluating? |
| Persistence | Is the canonical evaluated artifact stored without semantic loss? |
| Serving | Is the stored canonical truth what APIs return? |
| Presentation | Is UI displaying canonical truth instead of recomputing it? |

## 12. Test/Compute Discipline

To avoid wasting time/tokens/compute:

- during implementation, run the narrowest relevant tests first;
- do not repeatedly run the entire ~450-test harness for local edits;
- run typecheck/build when the change crosses type/build boundaries;
- run broader suites at gate/integration boundaries;
- do not rerun expensive tests without a code/config change or a specific diagnostic reason;
- keep audit outputs concise and machine-readable where possible;
- record the command and result that actually supports a closure claim.

## 13. Explicit Non-Goals Until Authorized by the Active Gate

Unless required by the active gate, do not:

- redesign scraper state-machine/durability behavior;
- modify protected production data;
- reset derived state;
- rewrite unrelated serving/UI code;
- add dossier prose before the reasoning substrate exists;
- delete the deterministic Extraction V1 baseline;
- introduce corpus/company/case-specific semantic patches;
- treat historical fixture content as source truth;
- allow browser/UI logic to become an alternative advisory engine;
- implement Gate 2 EvidenceGraph/Evaluation/Policy work while Gate 1 extraction architecture remains uncertified;
- implement Gate 3 editorial/serving cutover work before Gate 2 is certified.

## 14. Decision Log

### D-001 — Freeze deterministic Extraction V1 as baseline
**Decision:** `adbfc37` is the reference deterministic baseline. Further semantic regex growth is paused pending Gate 1 comparison.

### D-002 — Corpus is not the universe
**Decision:** The 100 frozen cases remain a regression benchmark. Architecture must be validated against unseen/adversarial inputs and general language/structure phenomena.

### D-003 — Composition cannot discover facts
**Decision:** The future composition boundary is an evolved `EditorialIntelligenceContract` / editorial plan plus grounded context; composition is downstream of evaluation and decision policy.

### D-004 — Three-gate compressed execution
**Decision:** Transition is supervised through three integration gates rather than a single long component migration, with parallel work inside gates and strict boundary reviews.

### D-005 — Gate 1A reconnaissance complete
**Decision:** Batches 01–06 provide sufficient code-grounded whole-system reconnaissance to begin implementation. Broad architecture reconnaissance stops unless implementation exposes a concrete contradiction.

### D-006 — Extraction architecture decision remains open
**Decision:** Reusable Extraction V1 contracts do not imply approval of the deterministic extractor as the final production implementation. Gate 1 must still compare deterministic vs LLM-backed/hybrid extraction on frozen and unseen/adversarial inputs before canonical production adoption.

### D-007 — Preserve original Gate 1 / 2 / 3 ownership
**Decision:** Source/provenance hardening, extraction experiment/decision and canonical source-fact persistence belong to Gate 1. EvidenceGraph/Evaluation/Policy/Hinges/PursuitStrategy belong to Gate 2. Editorial plan/composition/persistence-serving cutover/V1 retirement belong to Gate 3.

### D-008 — Evolve the existing V2 editorial seam
**Decision:** Do not introduce a second parallel `DossierPlan` stack. Evolve/version `EditorialIntelligenceContract` into the target plan-like boundary after Gate 2 supplies canonical semantic inputs.

## 15. Remaining Open Questions — Gate 1 Must Resolve

1. Which semantic extraction work should move to an LLM for role facts, candidate proofs, or both?
2. What deterministic validator layer should be shared between deterministic and LLM extraction paths?
3. What model/provider abstraction, cache key, retry/fail-closed behavior, and structured-output schema are practical in the current app/runtime?
4. What unseen/adversarial evaluation set is sufficient for a credible architecture decision without turning Gate 1 into an open-ended research project?
5. What exact extraction quality/provenance thresholds justify `DETERMINISTIC`, `LLM_FIRST`, or `HYBRID` separately for RoleIntelligence and CandidateProof?

Gate 1A has already resolved enough of the earlier reuse/coupling and canonical persistence questions to begin this experiment without further broad recon.

## 16. Current Next Action

Batch 01 is **COMPLETE**. Its source/provenance immutability guarantees remain mandatory prerequisites and must not be weakened.

**Gate 1B — Batch 02: Extraction provider boundary + common mechanical verifier.**

This is the only currently authorized production batch. It must:

1. put the current `adbfc37` RoleIntelligence and CandidateProof deterministic extraction behind explicit provider interfaces/adapters without changing output semantics;
2. define an equivalent LLM provider contract beside it, without implementing the Batch 03 LLM experiment or making LLM output production-authoritative;
3. establish one shared mechanical verifier for immutable source identity, exact source/span resolution, closed schema/ontology validation, normalization, deduplication, deterministic metric normalization where appropriate, input/cache identity, and fail-closed rejection;
4. prove the deterministic adapters reproduce the existing frozen/current baseline;
5. prove no provider/verifier path can bypass the immutable source identities established in Batch 01.

Do **not** change or begin:

```text
EvidenceGraph
evaluation
policy
PURSUE / CONSIDER / PASS behavior
canonical RoleIntelligence / CandidateProof persistence
dossier/editorial content
serving
UI
production LLM authority
```

The production extraction architecture decision remains **OPEN**.

**Batch 03 is not authorized by this Batch 02 activation.** It requires a separate governance authorization after Batch 02 is closed.

The corrected remaining Gate 1B sequence is:

```text
Batch 02 — extraction provider boundary + common mechanical verifier   [AUTHORIZED]
Batch 03 — LLM RoleIntelligence / CandidateProof experiment           [NOT AUTHORIZED]
Batch 04 — frozen + unseen/adversarial comparison                      [NOT AUTHORIZED]
Batch 05 — extraction architecture decision                            [NOT AUTHORIZED]
Batch 06 — canonical source-fact persistence/contracts                 [NOT AUTHORIZED]
```

**EvidenceGraph remains outside Gate 1 and cannot begin until Gate 1 exit is certified.**

When Batch 02 closes, update the machine-readable batch/state manifests and this section in the same governance change set. Do not infer Batch 03 authorization from the planned sequence.
