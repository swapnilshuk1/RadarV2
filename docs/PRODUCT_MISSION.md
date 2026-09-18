# RADAR Product Mission and Non-Negotiable Contract

**Status:** GOVERNING FOR `rebuild/intelligence-ground-up` and the integrated `main` branch

**Purpose of this document:** prevent architectural drift, memory loss, audit-first detours, and silent dilution of the product outcome. Every agent entering this branch must read this document before changing intelligence, dossier, enrichment, evaluation, narrative, or related UI code.

---

## Current owner-approved presentation

Template B is the sole production layout. Both benchmarks remain references for
substantive richness; a second renderer is not required. The current generation
contract is an executive memo: decision brief, opportunity value, mandate,
candidate fit, decision conditions and approach, with complete supporting evidence.
The acceptance standard is equivalent meaning and decision usefulness, not exact
copy. PURSUE and CONSIDER receive memos; PASS keeps its canonical evaluation and
is explicitly skipped for composition. This direction supersedes dual-template
wording in the benchmark descriptions below.

## 1. The Mission

RADAR exists to turn a scraped executive job opportunity plus candidate evidence into a **rich, impressive, decision-useful executive dossier** at the quality level represented by the two approved benchmark dossier templates supplied by the product owner:

- **Benchmark A — DaMENSCH-style executive decision dossier**
- **Benchmark B — Schnell-style executive memorandum / action dossier**

These templates are the heart of the rebuild. They are not visual inspiration and they are not optional examples. They are the **product acceptance target**.

The rebuild succeeds only when RADAR can populate the full substantive content required by both benchmark dossier styles and render it as persuasive, varied, executive-grade narrative.

The mission is **not** to build the most conservative parser, the purest ontology, the most objectively defensible assessment, or the longest audit trail. Accuracy and provenance are constraints on the product; they are not substitutes for the product.

---

## 2. Product Success Standard

A completed dossier should be capable of answering, when relevant:

1. **What is the opportunity and what is RADAR's call?**
   - PURSUE / CONSIDER / PASS
   - concise executive verdict
   - decisive thesis rather than score-dump prose

2. **Why does this opportunity deserve attention?**
   - strategic career value
   - scope expansion
   - authority expansion
   - platform/company quality
   - timing and company trajectory

3. **What is this role actually asking the executive to do?**
   - mandate
   - outcomes
   - responsibilities
   - scope
   - authority
   - expected delivery
   - likely near-, medium-, and longer-term priorities where defensibly inferred

4. **Why does the candidate fit?**
   - direct precedent
   - adjacent precedent
   - transferable precedent
   - identity alignment
   - capability coverage
   - differentiated candidate strengths
   - grounded evidence from candidate sources

5. **Where are the risks, gaps, and unresolved questions?**
   - reporting line
   - authority
   - P&L ownership
   - team scale
   - geography
   - economics/compensation where relevant
   - domain gaps
   - work model/location
   - other material uncertainty

6. **What would change the decision?**
   - stronger-pursue conditions
   - weaker conditions
   - pass conditions
   - executable decision hinges

7. **How should the candidate approach the opportunity?**
   - recruiter conversation strategy
   - opening positioning
   - questions to ask
   - what to verify
   - screening-call strategy
   - interview strategy
   - resume/LinkedIn positioning where relevant

8. **What evidence supports the recommendation?**
   - role evidence
   - candidate evidence
   - contextual/company evidence
   - relational reasoning
   - explicit vs inferred cue
   - claim lineage sufficient to audit the material conclusion

9. **What candidate precedents matter most?**
   - experience and claims inventory
   - verified achievements
   - evidence linked to the actual recommendation, not a generic resume dump

A system that produces only six or seven extracted JD facts, a score, and a few generic questions has **not completed the mission**. Those facts are inputs to the dossier, not the dossier itself.

---

## 3. Work Backwards From the Dossier

The system must be designed backwards from the benchmark dossier fields:

```text
Benchmark A + Benchmark B
        ↓
Dossier Field Contract
        ↓
Field Resolution / Acquisition
        ↓
Role Intelligence + Candidate Evidence + Context Intelligence
        ↓
Role–Candidate–Context Reasoning
        ↓
Evaluation + Decision Hinges + Pursuit Strategy
        ↓
Canonical Dossier Model
        ↓
Narrative Planning
        ↓
Template B executive memo rendering
```

The central engineering question is not:

> “Can we extract this ontology label from the JD?”

It is:

> **“What must RADAR know to write this dossier section well, and how will RADAR acquire or infer that information?”**

---

## 4. Three Evidence Planes

Every dossier is built from three evidence planes.

### 4.1 Role Intelligence

What is knowable about the role from the JD/job posting and related role evidence:

- purpose and mandate
- outcomes
- responsibilities
- seniority
- people leadership
- organizational build
- authority
- commercial/P&L scope
- geography
- transformation/build/scale context
- requirements/preferences
- reporting clues
- success indicators

### 4.2 Candidate Evidence

What is knowable about the person from candidate sources:

- roles and chronology
- proven outcomes
- commercial/financial scope
- team scale
- geographic scale
- organization building
- transformation
- launches
- revenue/cost/pipeline/customer results
- stakeholder leadership
- domain precedents
- capabilities

Candidate achievements must never be invented from the JD.

### 4.3 Context Intelligence

What is knowable from public/company/market context:

- company size
- employee band
- funding rounds
- public financial information
- growth trajectory
- workforce growth where lawfully/appropriately available
- leadership appointments/departures
- office/geographic expansion
- acquisitions
- product launches
- related hiring activity
- company stage
- company trajectory
- organizational structure clues
- market and competitive context

Context Intelligence is a **first-class input**, not an optional enrichment after the dossier is written.

---

## 5. Missing Information Triggers Acquisition — Not Section Deletion

**Non-negotiable invariant:** if a dossier section requires information that is not explicit in the JD, the system must attempt to acquire or resolve it before giving up.

The resolver may:

```text
extract
retrieve
search
correlate
calculate
derive
infer
validate
ask
```

A missing explicit fact is not permission to delete the section.

Examples:

- No stated company size → acquire company/workforce context.
- No stated recent funding → inspect official announcements, investor information, reputable company/news context.
- No stated growth trajectory → use revenue/public data where available, workforce trend, expansion, hiring, product/geographic signals.
- No stated reporting line → use executive distance, title hierarchy, organizational apex, geography, functional scope, known leadership roster, comparable role structure.
- No stated team number → infer topology/range from build/hire/mentor language, title, remit, company scale, related hiring and organizational signals.
- No explicit reason for hiring → infer likely mandate trigger from funding, expansion, leadership change, product launch, acquisition, transformation, or related hiring.

If acquisition still cannot resolve the issue, the dossier should use a grounded inference or turn the uncertainty into a useful decision hinge/question.

---

## 6. Grounded Inference Is Allowed and Required

RADAR must make executive-grade common-sense judgments when the evidence supports them.

Examples:

- “Build, hire and mentor the function” supports a **people-building mandate** even if exact headcount is absent.
- A VP / Head of GCC or GSS India role with enterprise scope is not treated as though it could plausibly report to a manager simply because the JD omitted the reporting line.
- A national/global functional head at the organizational apex can be inferred to have high executive proximity even when the precise person is unknown.
- An explicit growth/build mandate combined with company expansion may support an inferred scale-up thesis.

Inference must remain grounded. Do not fabricate precise numbers or named relationships without evidence.

### Visible product epistemics

The final dossier uses a restrained visible distinction:

- **EXPLICIT** — directly supported by a source or reliable acquired evidence.
- **INFERRED** — supported by evidence + reasoning, but not literally stated.

Do not suppress useful interpretation merely because it is inferred.

Do not turn unsupported speculation into fact.

If evidence is insufficient to assert a conclusion, convert it into a **question or decision hinge** rather than silently dropping the section.

---

## 7. Reporting Line and Team Scope Must Be Resolved Resourcefully

### Reporting line

Use a probable organizational graph, not a literal-only rule.

Signals may include:

- title/seniority
- company size
- local organizational apex
- geography
- functional scope
- known executive roster
- CEO/founder proximity
- decision rights
- P&L/commercial accountability
- board exposure
- language of mandate

Use **Executive Distance** as a reusable concept where useful:

```text
0 = CEO / company head
1 = direct CEO / President / global CxO proximity
2 = EVP / SVP / major BU head
3 = VP / regional or functional leader
4 = director-level management
5 = operational management
```

Distance is contextual, not title-deterministic. A VP at a small company may be distance 1; a VP at a massive multinational may be farther away. A Head of India GCC may be local apex even if the title is VP.

### Team scope

Prefer topology and range to fake precision:

```text
Leadership mode: DIRECT / MATRIX / HYBRID
Estimated scale: 1–5 / 5–15 / 15–30 / 30–75 / 75–150 / 150+
Function state: ESTABLISHED / SCALE-UP / GREENFIELD / RESTRUCTURE
```

Build/hire/mentor language, function remit, company scale, related hiring and organizational structure may support the estimate.

---

## 8. Canonical Intelligence Feeds One Executive Memo

Build one rich canonical intelligence model and one Template B executive memo. Preserve the benchmarks' unique information without generating duplicate sections or a second layout.

The current presentation contract groups the substantive intelligence as follows:

```text
opportunity + candidate
verdict + canonicalDecisionTrace
executiveThesis
opportunityValue
  mandate appeal + identity alignment + career capital
mandate
  priorities + source-backed milestones + outcomes
candidateFit
  mapped requirement IDs + evidence-bounded assessments
  distinct candidate precedents where useful
decisionConditions
  question + consequence + requirement/field references
approach
  nextSteps + opening
  resumeNarrative + linkedinStrategy + screening + interview
resolutions
  reporting line + team + scope + company context
candidateConflicts
evidence
  roleClaims + candidateClaims + contextualClaims + relationalClaims + lineage
narrativePlan
  variation layer + points assigned to one primary section
generation
  model identity + factual/coverage review receipts
```

A field may be explicit, inferred, or unresolved-as-hinge. A required dossier section must not disappear merely because one source is incomplete.

---

## 9. Narrative Layering Is Mandatory

Two similar jobs must not automatically produce the same dossier with nouns swapped.

Before prose generation, determine a narrative/editorial layer such as:

### Role archetype

Growth / GM / Commercial / Transformation / Builder / Product / Operating / Advisory / Functional Leader / other evidence-grounded archetype.

### Mandate shape

Build / Scale / Fix / Transform / Steward / Integrate.

### Career move

Step-up / scope expansion / lateral strategic move / platform move / turnaround bet / capability stretch.

### Authority shape

True owner / influencer / operator / advisor / unclear authority.

### Fit shape

Direct precedent / adjacent / transferability-heavy / high-upside stretch / strong fit with one critical gap.

### Evidence shape

Explicit-rich / inference-heavy / authority-uncertain / mandate-clear / company-context-thin / other useful editorial condition.

### Decision tension

Scope / authority / economics / geography / reporting / team / domain / mandate / career capital / other material tension.

The existing “14 contexts” may be reused **only if they materially improve this objective**. Their historical existence is not a reason to preserve them. Some other layering scheme is acceptable, but **a narrative-variation layer is mandatory**.

Narrative variation means different thesis, emphasis, ordering and argument structure — not synonym shuffling.

---

## 10. Editorial Quality Is a Product Requirement

The final presentation must be impressive and executive-grade.

Requirements:

- decisive but not reckless
- rich, not mechanical
- non-repetitive
- strong editorial hierarchy
- evidence separated from interpretation without killing flow
- useful questions rather than generic “verify this” boilerplate
- no sentence-template spam such as “The role requires X. You have X. Therefore there is alignment.”
- strong prose rhythm and variation
- whitespace and typography used intentionally
- restrained provenance cues
- no raw internal confidence dump unless useful to the reader

The product should feel like a high-quality executive adviser, not an audit report or ATS match engine.

---

## 11. Benchmark Content and the Production Memo

### Template A — DaMENSCH-style dossier

Retain these substantive capabilities where useful, grouped into the memo:

- headline / opportunity identity
- “Worth pursuing” executive brief
- why pursue
- watch for
- why this role is interesting
- why this recommendation
- identity alignment
- capability coverage
- career-capital value
- the call / honest verdict
- core / adjacent / transferable fit
- what you will be expected to deliver
- why RADAR believes you are well positioned
- clarify before the call
- what would change this decision
- evidence behind recommendation
- explicit vs partial/inferred evidence
- experience & claims inventory
- final action/verdict controls

### Template B — Schnell-style memorandum

Retain these substantive capabilities where useful, grouped into the memo:

- verdict / RADAR score or equivalent decision signal
- opportunity headline and context
- executive advisory thesis
- 1-minute verdict overview
- why this fits
- what to verify
- why this deserves your attention
- what success requires
- critical screening questions
- why this reached your desk
- executive bottom line
- how to win the conversation
- next action / proceed block
- positioning workspace
- resume narrative
- LinkedIn strategy
- screening call
- interview strategy
- evidence/methodology/claim lineage

The production memo groups this content into the call, opportunity value, mandate, candidate fit, decision conditions, approach and an expandable evidence reference. Facts have one primary home; brief thesis previews and distinct actions may refer back to them. The evidence model retains detail without requiring repeated prose.

---

## 12. Dossier-First Acceptance Questions

Every architectural change should be tested against these questions:

1. Can the intelligence layer populate every meaningful field visible in both benchmark dossiers?
2. Can every factual assertion be traced to JD, candidate, or contextual evidence?
3. Can useful grounded inference survive without masquerading as explicit fact?
4. Does the system identify what is decision-changing instead of dumping generic unknowns?
5. Can two similar jobs result in materially different theses and narratives because their context differs?
6. Would an executive actually find the final rendered dossier worth reading and acting on?

If an ontology, extractor, verifier, benchmark, abstraction or test does not materially help one of these outcomes, it should not dominate the critical path.

---

## 13. Development Posture

Build vertically first:

```text
ONE REAL JD
     +
ONE REAL CANDIDATE PROFILE
     +
ACQUIRED CONTEXT
     ↓
complete intelligence
     ↓
complete canonical DossierModel
     ↓
Template B executive memo
```

Improve the full vertical slice before broadening the system.

Do not spend months perfecting extraction while the downstream dossier remains absent.

---

## 14. Scraper Preservation Boundary

The rebuild branch exists to preserve the current scraper/acquisition capability while replacing the dossier/intelligence system from the ground up.

Scraper behavior, portal acquisition, durable scrape orchestration, payload preservation, source identity and necessary persistence infrastructure are **preserved unless a specific scraper change is separately authorized**.

Do not delete scraper functionality merely because an old scraper dependency currently lives under an intelligence-named folder. Move/refactor the dependency into the appropriate acquisition layer instead.

---

## 15. NON-NEGOTIABLE CHANGE CONTROL

The mission, benchmark templates, dossier-first architecture, richness standard, inference policy, acquisition-first handling of missing information, narrative-layer requirement, and scraper-preservation boundary are **product-owner locked**.

An agent is **not authorized** to dilute, redefine, postpone, reinterpret, narrow, remove, or substitute any of them on its own authority.

If an agent believes any locked principle must change, it must STOP before implementing the change and obtain explicit permission from the product owner.

The request for permission must contain this warning exactly, rendered in bold red text where the interface supports HTML/CSS:

<span style="color:red"><strong>THIS DECISION WILL COMPROMISE THE PROJECT AS CURRENTLY DEFINED. I AM REQUESTING YOUR EXPLICIT PERMISSION BEFORE MAKING THIS CHANGE.</strong></span>

If the interface strips font color, the agent must still render the warning as prominently as possible using both a red marker and bold text:

🔴 **THIS DECISION WILL COMPROMISE THE PROJECT AS CURRENTLY DEFINED. I AM REQUESTING YOUR EXPLICIT PERMISSION BEFORE MAKING THIS CHANGE.**

The agent must then state:

1. exactly which locked principle it proposes to change;
2. why it believes the change is necessary;
3. what product capability will be lost, diluted or deferred;
4. what alternative it tried first;
5. the smallest possible change it is requesting.

**Silence is not consent. Proceeding because a change seems technically cleaner is not consent. Proceeding because a test is difficult is not consent. Proceeding because information is incomplete is not consent.**

Only an explicit affirmative response from the product owner authorizes the change.

---

## 16. What Agents Must Never Do Again

- Turn the rebuild into an ontology-certification project whose output is a thin dossier.
- Treat literal-only extraction as intelligence.
- Drop dossier sections merely because the JD omits a field.
- Equate “unknown” with “stop thinking.”
- Invent exact figures where only a range is supportable.
- Claim that inference is forbidden.
- Hide useful inference because absolute certainty is impossible.
- Allow inferred content to masquerade as explicit fact.
- Generate candidate achievements from the JD.
- Produce repetitive dossiers that differ only in employer/title nouns.
- Optimize tests while losing the benchmark dossier outcome.
- Reopen the product mission without explicit product-owner permission.

---

## 17. Mandatory Read Order for This Branch

Before any intelligence/dossier/enrichment/evaluation work:

1. `AGENTS.md`
2. `docs/PRODUCT_MISSION.md`
3. Inspect the current scraper/acquisition boundary before changing dependencies.
4. Inspect the current benchmark-oriented dossier work before introducing new abstractions.

Use `docs/ARCHITECTURE.md` for the current implementation and `docs/README.md`
for current operational guidance. This product mission remains the governing
contract when implementation details change.

---

## Final invariant

> **The job is to get to the two benchmark dossiers — richly, intelligently, resourcefully, with the strongest evidence available and transparent inference where needed. Everything else is implementation detail.**
