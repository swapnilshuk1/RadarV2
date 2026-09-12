# Gate 1A Governance Drift Postmortem

Status: **CLOSED WITH PREVENTIVE CONTROLS**  
Scope: process/governance only — no production semantics changed

## 1. Incident summary

Gate 1A reconnaissance produced strong code-grounded findings, but the Batch 06 implementation sequence drifted from the governing three-gate control plan in two ways:

1. it omitted the still-open deterministic-vs-LLM/hybrid extraction experiment from Gate 1; and
2. it relabeled work belonging to Gates 2 and 3 as a single long `Gate 1B` implementation sequence.

The recon findings themselves were not invalidated. The defect was supervisory: locally reasonable next steps were allowed to supersede the governing execution plan without an explicit gate-decision update.

The correction is recorded in `GATE1A_RECON_BATCH_06A_CONTROL_RECONCILIATION.md` and `docs/RADAR_TRANSITION_CONTROL.md`.

## 2. Why the drift happened

### Cause A — local-next-step chaining replaced control-plan reauthorization

Each reconnaissance document ended with a plausible "next batch". Over successive batches, the latest document became the practical source of sequencing truth.

That is useful for local continuity, but unsafe for governance. By Batch 06, the sequence had become:

```text
latest recon finding
→ infer next component
→ infer next component
→ publish migration sequence
```

instead of:

```text
latest recon finding
→ re-read governing control record
→ reconcile finding against current gate
→ authorize only work inside that gate
```

The result was architectural momentum overriding the explicit three-gate supervisory contract.

### Cause B — contract reuse was conflated with implementation selection

Recon showed that `RoleIntelligenceOutputV1` and `CandidateProofOutputV1` contain useful source-grounded contract semantics.

That correctly supports:

> preserve/evolve these contracts.

It does **not** support:

> the current deterministic extractor is therefore the selected production extraction architecture.

Batch 06 crossed that distinction when it described source-fact persistence as if extraction implementation selection were already settled.

The original control plan explicitly kept deterministic vs LLM-first vs hybrid extraction open pending a side-by-side experiment. That decision had never been closed.

### Cause C — gate labels were treated as organizational labels rather than authority boundaries

The Batch 06 order itself was mostly dependency-sensible, but the label `Gate 1B` expanded to include:

```text
EvidenceGraph
EvaluationSnapshot
DecisionPolicyOutput
EditorialPlan
successor dossier
serving cutover
```

Those are not merely batch names. The three gates are stop/certification boundaries with different authoritative owners and exit criteria.

Renaming all work as Gate 1B effectively removed the intended stop points.

### Cause D — the control record was human-readable but not executable

`RADAR_TRANSITION_CONTROL.md` already said agents must reread it and update it when gate decisions change. Nothing mechanically enforced that requirement.

There was no machine-readable record of:

- active gate;
- active implementation batch;
- extraction-decision status;
- gate-exit certification status;
- allowed batch scope;
- forbidden future-gate areas.

A locally coherent document could therefore drift without any automated failure.

### Cause E — no scope guard existed on changed files

Before this postmortem, nothing failed if a Gate 1 change touched policy, editorial composition or serving code.

Review could catch it, but only after the change existed.

### Contributing factor — tool interruption increased reliance on summaries

Batch 04 experienced repository traversal interruptions. The repository was recovered correctly, but interruptions increase the risk that subsequent work follows the latest summary rather than re-establishing the governing control state from source.

This was not the root cause, but it reinforces the need for a machine-readable control surface independent of conversational continuity.

## 3. Preventive controls now required

The transition now uses four layers of supervision.

### Layer 1 — human governing record

`docs/RADAR_TRANSITION_CONTROL.md` remains the architectural authority.

It defines:

- three-gate ownership;
- constitutional invariants;
- extraction-decision requirements;
- exit criteria;
- current next action.

### Layer 2 — machine-readable transition state

`docs/transition/RADAR_TRANSITION_STATE.json` records:

- active gate;
- active batch;
- current working branch;
- Gate 1A completion state;
- extraction architecture decision status;
- Gate 1 / Gate 2 exit certification references;
- gate-entry commit;
- control revision.

This state cannot replace the human control record; it exists so automation can detect disagreement with it.

### Layer 3 — locked current-batch scope manifest

`docs/transition/CURRENT_BATCH.json` declares the only implementation scope currently authorized.

For Gate 1B Batch 01 it states:

```text
source/provenance immutability only
```

and explicitly excludes:

```text
evaluation
policy
verdict semantics
EvidenceGraph
editorial/dossier behavior
serving/UI behavior
```

The manifest is intentionally narrower than the whole gate.

### Layer 4 — executable verifier

`scripts/transition/verify-transition-control.mjs` runs locally and in CI.

It fails when:

1. machine state and batch manifest disagree;
2. the control document no longer contains the declared gate/branch/open-extraction state;
3. Gate 2 is selected before the extraction architecture decision and Gate 1 exit certification exist;
4. Gate 3 is selected before Gate 2 exit certification exists;
5. files outside the current batch allowlist are changed;
6. Gate 1 changes touch hard-forbidden Gate 2 / Gate 3 semantic paths;
7. the active batch scope revision is inconsistent.

The verifier is deliberately cheap. It uses Node + Git only and does not need application dependencies or the full test harness.

## 4. Hard gate-transition rules

The following rules are now mechanical rather than advisory.

### Gate 1B → Gate 2

A transition is invalid unless all are true:

```text
extractionArchitectureDecision.status = DECIDED
extractionArchitectureDecision.decisionRecord != null
gateExitCertifications.gate1 != null
```

The written decision must cover role extraction and candidate extraction separately, even if both choose the same architecture.

### Gate 2 → Gate 3

A transition is invalid unless:

```text
gateExitCertifications.gate2 != null
```

### Current Gate 1B path restriction

While Gate 1B is active, the verifier hard-blocks changes under the authoritative Gate 2 / Gate 3 implementation areas, including current evaluation/policy/editorial/dossier/serving paths.

If implementation reveals that one of those files truly must change to complete a Gate 1 invariant, the correct action is **not** to bypass the verifier. The batch/control scope must first be explicitly amended and reviewed.

## 5. Batch-start protocol

Before any implementation batch begins:

1. read `docs/RADAR_TRANSITION_CONTROL.md`;
2. read `docs/transition/RADAR_TRANSITION_STATE.json`;
3. read `docs/transition/CURRENT_BATCH.json`;
4. run `npm run transition:check`;
5. state in the implementation report:
   - active gate;
   - active batch;
   - permitted scope;
   - explicitly forbidden downstream systems;
   - exit proof required for this batch.

No production edit should precede this preflight.

## 6. Batch-completion protocol

Before claiming a batch complete:

1. run `npm run transition:check`;
2. run only the targeted technical verification required by the batch;
3. inspect the actual diff against the batch scope;
4. record what changed and what intentionally did not change;
5. do not advance the active batch/gate in machine state until exit evidence exists;
6. if a gate changes, update the human control record and machine state in the same governance change.

`npm run certify` now invokes the transition check first, so a certification attempt cannot silently certify a cross-gate diff.

## 7. What this mechanism is designed to prevent

It specifically prevents repeats of the Gate 1A drift pattern:

```text
"this contract looks reusable"
     ≠
"this implementation architecture is selected"

"this component logically comes next"
     ≠
"this component belongs to the current gate"

"the code is green"
     ≠
"the gate is authorized to advance"
```

## 8. What remains a human judgment

Automation cannot decide whether an extraction comparison is intellectually convincing, whether dossier quality is good enough, or whether a policy model is the right product policy.

The guardrail only guarantees that those decisions cannot be skipped silently.

The human supervisor still decides whether the evidence satisfies each gate exit.

## 9. Disposition

The Gate 1A reconnaissance remains accepted.

The process defect is considered addressed when all of the following are present and passing:

- corrected `RADAR_TRANSITION_CONTROL.md`;
- `RADAR_TRANSITION_STATE.json`;
- locked `CURRENT_BATCH.json`;
- `verify-transition-control.mjs`;
- `npm run transition:check`;
- lightweight transition-control CI workflow;
- certification preflight integration.

The next authorized production work remains:

> **Gate 1B — Batch 01: Source/provenance immutability only.**
