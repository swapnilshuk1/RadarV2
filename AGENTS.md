# AGENTS.md — RADAR Intelligence Rebuild

## READ THIS FIRST

This file governs work on branch:

```text
rebuild/intelligence-ground-up
```

Before changing intelligence, dossier, evaluation, enrichment, narrative, candidate matching, company context, or related UI code, read:

```text
docs/rebuild/RADAR_REBUILD_MISSION.md
```

That document is the detailed product contract. This file is the short operational contract.

Legacy transition/gate documents are historical reference only on this branch unless the product owner explicitly revives them.

---

## 1. THE MISSION

**Build RADAR backwards from the two approved executive dossier benchmarks: the DaMENSCH-style dossier and the Schnell-style dossier.**

The product is not the parser, ontology, score, evidence graph, evaluator, governance framework, or test harness.

The product is a **rich, impressive, decision-useful executive dossier** that can populate the substantive content of both benchmark templates.

A thin audit report with six or seven perfectly defensible facts is still a failure.

The dossier must be able to express, when relevant:

- PURSUE / CONSIDER / PASS and a strong executive thesis;
- why the opportunity deserves attention;
- what the role really is and what success requires;
- expected mandate and outcomes;
- direct / adjacent / transferable candidate fit;
- identity alignment, capability coverage and career capital;
- candidate precedents that actually support the recommendation;
- reporting line, authority, team, geography, P&L and scope analysis;
- material gaps, risks and unresolved questions;
- what would strengthen, weaken or reverse the decision;
- recruiter / screening / interview strategy;
- resume / LinkedIn positioning where useful;
- evidence and claim lineage.

The canonical intelligence must support both benchmark dossier layouts from the same underlying model.

---

## 2. THREE EVIDENCE PLANES

Build the dossier from:

```text
ROLE INTELLIGENCE
    JD / job-post / role evidence

CANDIDATE EVIDENCE
    CV / resume / approved candidate sources

CONTEXT INTELLIGENCE
    company / market / funding / workforce / leadership /
    organization / growth / public-context evidence
```

Then reason across all three.

Candidate achievements must never be invented from a JD.

---

## 3. MISSING INFORMATION IS AN ACQUISITION PROBLEM

If a required dossier field is not explicit in the JD, **do not drop the section**.

The system should attempt to:

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

Examples:

- company size → company/workforce context;
- funding → official/company/investor/reputable external context;
- growth trajectory → public financial, workforce, expansion, hiring and product/geography signals;
- reporting line → title hierarchy, executive distance, organizational apex, geography, function and leadership roster;
- team scope → build/hire/mentor language, remit, company scale, related hiring and organization signals;
- reason for hiring → funding, expansion, leadership change, acquisition, transformation, product launch or related hiring.

If acquisition cannot settle the point, use a grounded inference or turn it into a useful question / decision hinge.

---

## 4. GROUNDED INFERENCE IS ALLOWED AND REQUIRED

Do not impose a literal-only standard that destroys product usefulness.

The final visible distinction is intentionally simple:

- **EXPLICIT** — directly supported by source or reliable acquired evidence.
- **INFERRED** — grounded in evidence plus defensible reasoning.

Examples:

- “build, hire and mentor the function” supports meaningful people-leadership responsibility even without an exact headcount;
- a VP / Head of GCC or GSS India with enterprise scope should be reasoned about using organizational hierarchy and executive distance, not treated as though every reporting relationship is equally plausible;
- company expansion plus a build mandate can support a scale-up thesis.

Do not fabricate precise numbers or named relationships without evidence. Prefer ranges, topology, probability and clearly labelled inference.

---

## 5. REPORTING LINE, TEAM SCOPE AND CONTEXT MUST BE RESOLVED RESOURCEFULLY

Use **Executive Distance** where useful:

```text
0 = CEO / company head
1 = direct CEO / President / global CxO proximity
2 = EVP / SVP / major BU head
3 = VP / regional or functional leader
4 = director-level management
5 = operational management
```

Distance is contextual, not title-deterministic.

For team scope, prefer honest ranges/topology rather than fake precision:

```text
Leadership: DIRECT / MATRIX / HYBRID
Scale: 1–5 / 5–15 / 15–30 / 30–75 / 75–150 / 150+
State: ESTABLISHED / SCALE-UP / GREENFIELD / RESTRUCTURE
```

Context Intelligence should actively seek company size, employee band, funding, growth trajectory, workforce trend where appropriately available, leadership changes, expansion, acquisitions, launches, hiring activity and organizational structure clues.

---

## 6. NARRATIVE VARIATION IS MANDATORY

Two similar jobs must not produce the same dossier with company/title nouns swapped.

Before prose generation, derive an editorial layer such as:

```text
Role archetype
Mandate shape
Career move
Authority shape
Fit shape
Evidence shape
Decision tension
```

The existing “14 contexts” may be reused if they materially help. They are not sacred. A different layer is acceptable, but **some deliberate narrative-variation layer is mandatory**.

Variation means a different thesis, emphasis, ordering and argument structure — not synonym shuffling.

Final prose should feel like a high-quality executive adviser, not an ATS engine or audit report.

---

## 7. BUILD VERTICALLY

Prefer a working end-to-end slice over months of upstream perfection:

```text
ONE REAL JD
    +
ONE REAL CANDIDATE
    +
ACQUIRED CONTEXT
    ↓
complete intelligence
    ↓
complete DossierModel
    ↓
Template A + Template B
```

Improve that vertical slice against the benchmark dossiers, then broaden.

Do not let extraction work become the product.

---

## 8. SCRAPER PRESERVATION BOUNDARY

The current scraper/acquisition capability is preserved.

Do not casually delete or rewrite scraper behavior, portal acquisition, durable scrape orchestration, payload preservation, source identity, or scraper-required persistence.

If an old scraper dependency lives in an intelligence-named folder, move/refactor it into the proper acquisition layer rather than amputating scraper functionality.

---

## 9. WORK SMART AND FAST — NO GOVERNANCE THEATRE

The previous transition accumulated excessive gates, acknowledgements, ledgers, review loops and procedural overhead. **Do not reproduce that on this branch.**

Normal implementation work does **not** require product-owner permission.

Agents are expected to code, test, iterate and make ordinary engineering decisions without stopping for trivial approvals.

Do not create:

- 10-stage gate structures for ordinary feature work;
- commit-acknowledgement bureaucracy;
- new governance ledgers for routine changes;
- approval checkpoints for harmless refactors;
- long audit documents instead of working code;
- certification programs whose cost exceeds the feature being built.

Use the lightest process that protects the product.

A practical default loop is:

```text
understand the dossier outcome
→ inspect existing code
→ implement the smallest coherent vertical improvement
→ run relevant tests/typecheck/build
→ inspect the actual rendered/product result
→ iterate
```

Tests exist to accelerate confidence, not to become the project.

---

## 10. WHEN YOU MUST STOP AND ASK

There is one important exception to the “move fast” rule.

The following are product-owner-locked:

- the two benchmark dossiers as the product target;
- dossier-first architecture;
- richness must not be sacrificed merely to maximize literal certainty;
- grounded inference is allowed and required;
- visible EXPLICIT vs INFERRED cues;
- missing information triggers acquisition/inference/decision-hinge logic rather than automatic section deletion;
- narrative variation is mandatory;
- scraper capability is preserved during the rebuild.

An agent may not silently dilute or replace these principles.

If an agent believes one of these locked principles **must** change, it must stop and request explicit permission before implementing that change.

The request must begin with this warning in bold red text where the interface supports HTML:

<span style="color:red"><strong>THIS DECISION WILL COMPROMISE THE PROJECT AS CURRENTLY DEFINED. I AM REQUESTING YOUR EXPLICIT PERMISSION BEFORE MAKING THIS CHANGE.</strong></span>

If red font is not supported, use:

🔴 **THIS DECISION WILL COMPROMISE THE PROJECT AS CURRENTLY DEFINED. I AM REQUESTING YOUR EXPLICIT PERMISSION BEFORE MAKING THIS CHANGE.**

Then explain only:

1. which locked principle would change;
2. why it appears unavoidable;
3. what product capability would be lost/diluted;
4. what alternative was tried first;
5. the smallest change requested.

**Do not use this escalation for normal coding decisions.** It is specifically for compromising the product mission.

Silence is not permission. Only an explicit affirmative response from the product owner authorizes such a compromise.

---

## 11. BASIC ENGINEERING DISCIPLINE

Keep this simple:

- inspect before changing;
- reuse stable infrastructure where it helps;
- avoid duplicate persistence/state systems;
- do not bypass source/provenance integrity;
- keep UI, domain and persistence dependencies sensible;
- run focused tests for changed behavior;
- run TypeScript/build checks before claiming completion when feasible;
- do not claim a test or build passed unless it actually ran successfully.

No additional governance layer is implied by these rules.

---

## 12. FINAL INVARIANT

> **The job is to get to the two benchmark dossiers — richly, intelligently, resourcefully, with the strongest evidence available and transparent inference where needed. Everything else is implementation detail.**
