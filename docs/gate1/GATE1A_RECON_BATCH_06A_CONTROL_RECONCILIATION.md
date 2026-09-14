# Gate 1A Recon — Batch 06A: Control Reconciliation Amendment

Status: **GOVERNANCE AMENDMENT / NO PRODUCTION CODE**  
Gate: **1 of 3**  
Branch: `phase5/gate1-architecture-recon`

## 1. Purpose

Gate 1A reconnaissance is accepted as substantially complete. The six recon documents remain valid and should be retained.

This amendment corrects **execution governance only**. It does not reopen the forensic findings, redesign the reconciled ownership model, or authorize production changes.

It corrects two sequencing errors in Batch 06:

1. the original Gate 1 LLM-vs-deterministic extraction experiment was omitted from the proposed implementation sequence;
2. Batch 06 relabelled work belonging to Gates 2 and 3 as one long `Gate 1B` sequence.

Those two parts of Batch 06 are superseded by this document and by the updated `docs/RADAR_TRANSITION_CONTROL.md`.

All other Batch 06 contract-reconciliation findings remain in force unless separately amended.

---

## 2. Gate 1A Recon is complete

The completed recon chain is:

```text
Batch 01 — evaluation → materialization
  commit 36af2ebabca1c1cb023f0968d2175cef431fba18

Batch 02 — assessment + policy semantics
  commit 2d5b1a5ffef277cb3117a3d249623e3ff8ec4729

Batch 03 — V2 editorial/proposition architecture
  commit 2e325882a6ab5586ccc54959d2b30f8d6536077b

Batch 04 — serving/read path + legacy coexistence
  commit f4e1ae73d3ccc66e816cda3c44bf3738b9cca25f

Batch 05 — source/provenance durability + V1 retirement prerequisites
  commit edb84ea92190b3c6d430fb845da0c267e626ab89

Batch 06 — contract reconciliation + migration sequence
  commit cf43e43185065e866b07680e357dc224889af10e
```

Gate 1A established enough code-grounded architectural truth to stop broad reconnaissance and begin controlled implementation.

### Decisions established by Gate 1A

- the current V2 persisted dossier/serving shell is useful and should be evolved rather than discarded;
- a parallel second `DossierPlan` architecture should not be introduced;
- `EditorialIntelligenceContract` is the existing plan-like seam to evolve/version;
- source facts, role↔candidate relationships, evaluation judgments, policy decisions, editorial planning and composition require separate semantic owners;
- `RoleIntelligence` is role-only and `CandidateProof` is candidate-only;
- relationship classification belongs to the EvidenceGraph; evaluation owns consequence;
- final `PURSUE | CONSIDER | PASS` belongs to deterministic policy, while intrinsic assessment/quality belongs upstream;
- source/provenance identifiers must be lifetime-resolvable, not merely deterministic;
- candidate source content therefore requires immutability/versioning before canonical CandidateProof persistence;
- canonical v4.3 remains valid historical truth and should receive a clean successor rather than semantic mutation;
- V1 is a compatibility island to retire only after exact-input backfill/cutover coverage is proven;
- presentation/serving must remain downstream of persisted canonical truth and must not recompute advisory semantics.

### Decision deliberately **not** established by Gate 1A

**The production extraction architecture remains OPEN.**

The recon validated useful extraction **contracts** and deterministic baseline behavior. It did not perform the governing comparison required to decide whether production semantic extraction should be:

```text
deterministic
LLM-first
or hybrid
```

Nothing in Batch 06 should be read as production approval of the current deterministic extractor implementation merely because its contract is reusable.

---

## 3. Correction to Batch 06 implementation sequence

Batch 06 sections that placed EvidenceGraph, EvaluationSnapshot, DecisionPolicyOutput, EditorialPlan, dossier cutover and V1 retirement under `Gate 1B` are superseded.

The dependency ordering remains useful, but the original three supervisory gates are restored.

```text
GATE 1B
substrate + extraction architecture decision

    ↓ GATE 1 EXIT

GATE 2
intelligence core

    ↓ GATE 2 EXIT

GATE 3
editorial + canonical persistence/serving integration
```

No Gate 2 or Gate 3 production work is authorized merely because Batch 06 described its eventual order.

---

## 4. Corrected Gate 1B implementation sequence

### Gate 1B — Batch 01: Source/provenance immutability

Goal: make future source/evidence identities lifetime-resolvable without changing advisory behavior.

Scope:

- make candidate source document content immutable/versioned;
- prove exact candidate source resolution by durable source version/hash;
- prove role `opportunityVersion` source snapshots cannot be silently rewritten under the same identity;
- establish shared source-snapshot resolver primitives needed by either deterministic or LLM extraction;
- add targeted proving tests.

Explicit non-goals:

```text
NO evaluation changes
NO policy/verdict changes
NO dossier-content changes
NO serving changes
NO EvidenceGraph implementation
```

### Gate 1B — Batch 02: Extraction provider boundary + common mechanical verifier

Goal: create a bounded experimental seam without choosing the winner in advance.

Scope:

- define provider interfaces/adapters for role and candidate semantic extraction;
- keep `adbfc37` deterministic extraction reproducible behind that boundary;
- define the LLM-backed provider boundary beside it;
- share mechanical validation where practical:
  - exact-source/span resolution;
  - closed-schema/ontology validation;
  - normalization;
  - deduplication;
  - deterministic metric normalization where reliable;
  - cache/input identity;
  - fail-closed rejection;
- ensure no experimental provider serves production truth yet.

### Gate 1B — Batch 03: LLM RoleIntelligence / CandidateProof experiment

Goal: implement the governing production hypothesis rather than assuming the deterministic baseline is final.

Role path under test:

```text
raw role source
  → LLM semantic extraction
  → mechanical source-span resolution
  → closed ontology / subject validation
  → normalization / dedup / rejection
  → RoleIntelligence contract
```

Candidate path under test:

```text
immutable candidate source
  → deterministic document/position/bullet structure where reliable
  → LLM proof decomposition / semantic classification
  → exact-span verification
  → deterministic metric normalization
  → CandidateProof contract
```

The LLM provider must be schema-bound, versioned/cached by exact inputs, observable and fail-closed.

### Gate 1B — Batch 04: Frozen + unseen/adversarial comparison

Goal: compare extraction architectures on generalization and provenance integrity, not only frozen-corpus recall.

The comparison must include at minimum:

- frozen 100-case regression corpus;
- unseen synthetic documents with unrelated roles/companies/vocabulary;
- formatting and punctuation/heading mutations;
- reordered sections;
- sparse documents;
- duplicated/ambiguous anchors;
- near-negative/adversarial cases;
- company-context vs role-context contamination;
- requirement-vs-responsibility ambiguity;
- reporting/P&L/team/decision-authority false-positive cases.

Measure both semantic quality and mechanical validity. Invalid/unresolvable source claims must count as failures even if the prose interpretation sounds plausible.

### Gate 1B — Batch 05: Extraction architecture decision

Goal: record an evidence-based decision separately for role extraction and candidate extraction.

Allowed outcomes include:

```text
DETERMINISTIC
LLM_FIRST
HYBRID
```

for each extraction family independently.

The written decision must state:

- benchmark evidence;
- unseen/adversarial evidence;
- provenance failure rate;
- precision/recall or equivalent task-quality evidence;
- latency/cost/operational implications where material;
- fail-closed/fallback behavior;
- why the selected architecture generalizes better than the alternatives.

No switch is justified merely because an LLM is more flexible, nor merely because deterministic code is easier to reproduce.

### Gate 1B — Batch 06: Canonical source-fact persistence/contracts

Goal: persist **the source-fact contract/implementation justified by the extraction decision**.

Scope:

- bind RoleIntelligence to exact canonical opportunity version/content hash;
- bind CandidateProof to immutable candidate source versions/hashes;
- persist versioned source-fact snapshots/propositions;
- preserve exact source resolvers and extraction/version fingerprints;
- keep current production evaluation/policy/dossier/serving behavior unchanged.

The persisted semantic contract may preserve useful V1 shapes even if the selected extraction provider changes. Contract reuse does not imply extractor implementation reuse.

---

## 5. Gate 1 exit

Gate 1 closes only when all original extraction-architecture criteria are satisfied.

Required exit evidence:

```text
source/provenance immutability proven
+ deterministic adbfc37 baseline reproducible
+ LLM path bounded behind provider interface
+ shared mechanical provenance validation demonstrated
+ frozen corpus comparison complete
+ unseen/adversarial comparison complete
+ written role-extraction architecture decision
+ written candidate-extraction architecture decision
+ selected canonical source-fact persistence implemented
+ no silent production evaluation/policy/dossier/serving rewiring
```

Until then the current execution gate remains **Gate 1 of 3**.

---

## 6. Corrected Gate 2 ownership

Only after Gate 1 certification:

```text
RoleIntelligence + CandidateProof
        ↓
Typed EvidenceGraph
        ↓
EvaluationSnapshot
        ↓
DecisionPolicyOutput
        ↓
Decision Hinges / Uncertainties
        ↓
PursuitStrategy
```

Gate 2 owns the Batch 06 work previously labelled:

- persistent typed EvidenceGraph;
- policy-independent EvaluationSnapshot;
- deterministic DecisionPolicyOutput;
- structured decision hinges;
- structured pursuit strategy.

The Batch 06 semantic findings for these components remain valid. Only their gate assignment changes.

### Gate 2 exit remains a hard supervisory boundary

Before Gate 3:

- every material judgment must trace to durable evidence/graph IDs;
- unknown must remain distinct from unsupported/contradicted;
- intrinsic evaluation must be intelligible without dossier prose;
- policy verdict and pursuit strategy must be deterministic for the same exact inputs;
- presentation heuristics must not be required for evaluation or policy truth.

---

## 7. Corrected Gate 3 ownership

Only after Gate 2 certification:

```text
Evaluation + Policy package
        ↓
EditorialIntelligenceContract / EditorialPlan vNext
        ↓
composition
        ↓
successor canonical dossier presentation
        ↓
dual-write / exact-input backfill
        ↓
serving cutover
        ↓
V1 retirement
```

Gate 3 therefore owns the Batch 06 work previously labelled:

- EditorialPlan / evolved `EditorialIntelligenceContract`;
- successor persisted dossier;
- dual-write/parity work;
- exact-input backfill;
- serving cutover;
- V1 retirement.

Batch 03's conclusion remains authoritative: evolve the existing V2 editorial seam rather than building a second parallel dossier-plan stack.

---

## 8. Immediate next executable work

The next production change is exactly:

```text
Gate 1B — Batch 01
Source/provenance immutability
```

It must not change:

```text
evaluation
policy
verdicts
dossier content
serving
```

After that, Gate 1 continues immediately into the extraction-provider/LLM comparison work. **EvidenceGraph does not begin until the extraction architecture decision and Gate 1 source-fact persistence are certified.**

---

## 9. Supersession rule

For execution sequencing and gate ownership:

```text
RADAR_TRANSITION_CONTROL.md
+ this Batch 06A amendment
```

supersede Batch 06's `Gate 1B` seven-batch allocation.

For forensic findings, contract ownership, reuse/retire analysis, identity invariants and vNext semantic design, Batches 01–06 remain valid unless explicitly contradicted here.

This amendment closes the governance drift without discarding the reconnaissance work.