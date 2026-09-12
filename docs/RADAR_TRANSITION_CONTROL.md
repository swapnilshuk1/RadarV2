# RADAR Transition Control

Status: ACTIVE

This document is the governing execution record for the RADAR intelligence transition. It exists so architecture, scope, invariants, decisions, and gate state survive individual chat/agent sessions. It is not a progress narrative; it is a control surface.

## 1. Current Baseline

- Repository: `swapnilshuk1/RadarV2`
- Working branch: `phase5/intelligence-narrator-platform`
- Frozen Extraction V1 baseline commit: `adbfc375ab3f1974cb73c87bc24279f3877ac610`
- Baseline commit message: `feat(intelligence): extraction v1 closure with frozen corpus invariants and high precision role propositions`
- Frozen corpus source branch: `codex/candidate-corpus-100`
- Frozen corpus commit: `e1f0a47575accedcd7fd3d681c7b084ca377b0fd`
- Current execution gate: **Gate 1 of 3 — substrate/contracts + extraction architecture decision**

The `adbfc37` extractors are a deterministic benchmark and fallback/reference implementation. They are **not assumed to be the final production extraction architecture**.

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
             Decision + Uncertainties
                         ↓
                PursuitStrategy
                         ↓
                   DossierPlan
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
4. **Evaluation makes judgments.** Fit, identity, career value, trajectory, friction, risks, verdicts, and decision sensitivity belong here.
5. **Unknowns remain unknown.** Missing reporting lines, P&L authority, compensation, team scale, etc. must not be silently filled with generic assumptions.
6. **Composition writes; it does not discover.** `BriefCompositionEngine` may choose wording, order, compression, emphasis, and transitions. It may not discover facts, create new evaluations, invent unknowns, or change the authoritative verdict.
7. **Persistence stores canonical evaluated truth.** Serving/presentation must not recompute advisory truth independently.
8. **Corpus performance does not define correctness.** Production rules may not be tailored to corpus IDs, company names, benchmark literals, or one-off source phrases.
9. **No subsystem is optimized in isolation.** Every change is evaluated for downstream effect on the final dossier and upstream truth guarantees.
10. **Agent reports are not implementation evidence.** Review actual code/diff first, tests second, report third.

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

Each edge must retain role evidence IDs, candidate proof IDs, rationale/relationship metadata, and confidence/epistemic status as appropriate.

### `EvaluationSnapshot`
The authoritative advisory state, including at minimum:

- verdict;
- identity assessment;
- capability assessment;
- career value / trajectory assessment;
- lifestyle/friction assessment;
- decision drivers;
- decision risks;
- evidence strength;
- triggered policy/rule IDs where deterministic policy remains relevant;
- provenance to graph/evidence IDs.

### `DecisionHinges` / `Uncertainties`
Explicit unresolved questions and why they matter, including what confirming/rejecting the unknown would do to the recommendation.

### `PursuitStrategy`
Effort level, pursuit mode, tailoring depth, immediate next action, dependencies, stop conditions, and provenance to the authoritative evaluation.

### `DossierPlan`
The immediate semantic input to composition. It selects the judgments and evidence that Sections I–IX may express. Every material item must be grounded by evidence/graph/evaluation IDs and carry epistemic status.

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
compose(dossierPlan, groundedContext)
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

Target: **1–1.5 focused engineering days**.

Scope:

- freeze `adbfc37` as deterministic baseline;
- inspect current end-to-end RADAR code before introducing contracts;
- define canonical contracts listed above;
- identify existing reusable types/components and architectural conflicts;
- implement an LLM-backed extraction path **beside** the deterministic baseline, not by deleting it;
- share the same mechanical provenance/validation layer where practical;
- build a comparative audit harness using frozen + unseen/adversarial inputs;
- decide whether role extraction, candidate extraction, or both should switch architectures.

Gate 1 exit criteria:

- versioned contracts exist and compile;
- existing production behavior has not been silently rewired;
- deterministic baseline remains reproducible;
- LLM extraction is bounded behind an interface/adapter and is not serving production truth yet;
- exact-source/provenance failures fail closed;
- comparative evidence covers unseen/adversarial inputs, not just corpus recall;
- a written extraction architecture decision is recorded with evidence;
- no new corpus-specific production semantic rules are introduced.

### Gate 2 — Intelligence Core

Target: **1.5–2 focused engineering days**.

Scope:

```text
RoleIntelligence + CandidateProof
        ↓
RoleCandidateEvidenceGraph
        ↓
Evaluation
        ↓
Unknowns / Decision Hinges
        ↓
PursuitStrategy
```

Gate 2 must structurally answer:

- What does the role materially require?
- What can the candidate actually prove?
- What is direct, adjacent, transferable, or unsupported?
- Is the role worth pursuing?
- Why?
- What are the material risks?
- What is not known?
- Which unknowns could change the recommendation?
- How much effort should the candidate invest?

Gate 2 exit criteria:

- every material judgment traces to evidence/graph IDs;
- unsupported facts remain unsupported;
- uncertainties are explicit;
- verdict and strategy are authoritative and non-contradictory;
- no dossier prose is required to make the decision intelligible;
- evaluation does not rely on presentation-layer heuristics.

### Gate 3 — Dossier Plan, Composition, Canonical End-to-End

Target: **1.5–2 focused engineering days**.

Scope:

```text
Evaluation package
      ↓
DossierPlan
      ↓
BriefCompositionEngine
      ↓
Canonical persisted artifact
      ↓
Serving
      ↓
UI
```

Gate 3 exit criteria:

- Sections I–IX are planned from grounded judgments;
- composition cannot create new advisory facts;
- every material dossier claim is traceable to plan/evaluation/evidence;
- canonical evaluated artifact is persisted and consumed directly;
- serving/presentation do not recompute candidate-specific advisory truth;
- end-to-end dossiers are materially useful, not merely schema-valid;
- regression/build/test suites pass at the integration boundary.

## 9. Execution Timebox

Target: **4–6 focused engineering days total**.

A plausible compressed path:

- Day 1: repo-wide architecture inspection, contracts, LLM extraction implementation/harness begins;
- Day 2: extraction comparison/decision + EvidenceGraph implementation begins;
- Day 3: EvidenceGraph + Evaluation + DecisionHinges + PursuitStrategy;
- Day 4: DossierPlan + composition integration + first end-to-end certification;
- Days 5–6: contingency for real integration failures or architecture corrections, not scope expansion.

Do not compress below what evidence supports. A green unit suite is not a reason to close a gate early.

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
| Pursuit strategy | Does recommended effort follow from the authoritative evaluation? |
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
- allow browser/UI logic to become an alternative advisory engine.

## 14. Decision Log

### D-001 — Freeze deterministic Extraction V1 as baseline
**Decision:** `adbfc37` is the reference deterministic baseline. Further semantic regex growth is paused pending Gate 1 comparison.

### D-002 — Corpus is not the universe
**Decision:** The 100 frozen cases remain a regression benchmark. Architecture must be validated against unseen/adversarial inputs and general language/structure phenomena.

### D-003 — Composition cannot discover facts
**Decision:** The future composition boundary is `DossierPlan + grounded context`; composition is downstream of evaluation and decision planning.

### D-004 — Three-gate compressed execution
**Decision:** Transition is supervised through three integration gates rather than six sequential component gates, with parallel work inside gates and strict boundary reviews.

## 15. Open Questions — Gate 1 Must Resolve

1. Which existing matcher/evaluator/policy/career-value components are genuinely reusable versus coupled to legacy `Opportunity` / projection assumptions?
2. What is the minimum stable contract for `RoleCandidateEvidenceGraph` that supports evaluation without over-modeling future needs?
3. Which semantic extraction work should move to an LLM for role facts, candidate proofs, or both?
4. What deterministic validator layer should be shared between deterministic and LLM extraction paths?
5. What model/provider abstraction, cache key, retry/fail-closed behavior, and structured-output schema are practical in the current app/runtime?
6. What unseen/adversarial evaluation set is sufficient for a credible architecture decision without turning Gate 1 into a research project?
7. Which existing canonical persistence/serving contracts can carry the future evaluation/dossier artifact without creating another parallel truth path?

## 16. Current Next Action

**Gate 1 starts with repository-wide inspection, not coding by assumption.**

The first agent must:

1. read this control file;
2. inspect the actual current pipeline from scrape/ingestion through extraction/evaluation/persistence/serving/presentation;
3. inspect `adbfc37` Extraction V1 implementation and tests;
4. identify reusable existing intelligence components and legacy coupling;
5. propose/finalize the minimum contracts and extraction experiment design;
6. implement only Gate 1 scope after reconciling those findings with this document;
7. return code/diff/test evidence and unresolved risks without declaring later gates complete.

When Gate 1 closes, update `Current execution gate`, Gate 1 results, and the Decision Log in this file in the same change set.