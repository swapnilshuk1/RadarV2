# RADAR Agent Change Acknowledgement Protocol

Status: **ACTIVE**

This protocol supplements `docs/RADAR_TRANSITION_CONTROL.md`. It exists to prevent a locally valid sequence of edits from drifting away from the currently authorized gate, batch, or unresolved architectural decisions.

## 1. What must be updated, and when

There are three different update frequencies. They must not be conflated.

### A. After every completed non-governance commit

Update:

```text
docs/transition/IMPLEMENTATION_LEDGER.json
```

with an acknowledgement entry for the exact commit SHA.

This is mandatory even when the commit is fully inside the existing gate/batch scope.

The acknowledgement records:

- exact commit SHA;
- active gate;
- active batch;
- batch scope revision;
- concise change summary;
- invariants checked;
- verification actually performed;
- whether any scope/gate/decision change was required.

An agent may not declare completion while a non-governance commit is unacknowledged.

### B. When batch scope or authorization changes

Update together:

```text
docs/transition/CURRENT_BATCH.json
docs/transition/RADAR_TRANSITION_STATE.json
```

and increment the relevant revision.

Examples:

- an implementation needs a path outside the current allowlist;
- a test needs to be created or edited outside an explicitly authorized test path;
- the batch objective changes;
- a `mustNotChange` item must be relaxed;
- completion evidence changes materially;
- the active batch changes.

This update must happen **before** implementation continues outside the old scope.

### C. When gate, architecture decision, or governing invariant changes

Update:

```text
docs/RADAR_TRANSITION_CONTROL.md
docs/transition/RADAR_TRANSITION_STATE.json
docs/transition/CURRENT_BATCH.json
```

as applicable, and update the Decision Log in the control document.

Examples:

- extraction architecture changes from `OPEN` to `DECIDED`;
- Gate 1 closes and Gate 2 opens;
- a gate exit criterion changes;
- a new architectural invariant is adopted;
- the three-gate ownership changes.

## 2. What counts as a governance-only commit

The implementation-ledger requirement does not apply to commits that modify only the transition-control mechanism itself.

Governance-only paths are:

```text
AGENTS.md
docs/RADAR_TRANSITION_CONTROL.md
docs/transition/
docs/gate1/GATE1A_GOVERNANCE_DRIFT_POSTMORTEM.md
scripts/transition/
.github/workflows/transition-control.yml
.github/CODEOWNERS
```

Any commit touching any other path is a governed change and must receive an implementation-ledger acknowledgement.

Tests are governed changes and receive **no blanket scope exemption**. A test file must be explicitly authorized by `docs/transition/CURRENT_BATCH.json` just like production code. Documentation outside the paths above is also a governed change. This is intentional: an agent should not be able to alter implementation claims, tests, or other project state without an explicit handoff record.

## 3. Agent execution protocol

Every implementation agent must follow this sequence:

```text
1. Read RADAR_TRANSITION_CONTROL.md.
2. Read RADAR_TRANSITION_STATE.json.
3. Read CURRENT_BATCH.json.
4. Run npm run transition:check before implementation.
5. State current gate, batch, allowed scope, and must-not-change semantics.
6. Make only authorized edits.
7. Run the narrow required verification.
8. Commit the implementation change.
9. Add an IMPLEMENTATION_LEDGER acknowledgement for that exact commit SHA.
10. Run npm run transition:check again.
11. Only then report the implementation as complete.
```

If step 6 exposes a real need outside scope, stop at that point. Do not first make the out-of-scope edit and justify it afterward.

## 4. Commit-level acknowledgement versus literal keystroke logging

The control system enforces **every committed agent change / handoff**, not every editor keystroke.

Literal per-keystroke control-document mutation would create noise, merge conflicts, and circular bookkeeping without improving architectural safety. The durable unit of engineering truth is the commit.

Therefore:

```text
uncommitted local work
  → may be incomplete while the agent is actively working
  → transition:check FAILS until governed edits are committed

committed governed change
  → MUST be acknowledged before the branch can return green

agent completion/handoff
  → forbidden while governed work is dirty or any governed commit is unacknowledged
```

This means an agent may perform normal local editing between checks, but there is no valid completion/handoff state in which governed changes are uncommitted or unacknowledged.

## 5. Main control document is not a progress diary

`RADAR_TRANSITION_CONTROL.md` must remain a governing control surface, not a chronological edit log.

Do not update it merely because a repository file changed.

Update it only when the change affects:

- gate state;
- gate ownership;
- an architectural decision;
- an invariant;
- an exit criterion;
- the authorized implementation sequence.

Routine within-batch implementation evidence belongs in `IMPLEMENTATION_LEDGER.json` and the eventual batch closure/certification record.

## 6. Mechanical enforcement

`scripts/transition/verify-transition-control.mjs` must fail when:

- any governed commit after ledger enforcement began lacks an acknowledgement entry;
- an acknowledgement references a commit that is not in branch history;
- an acknowledgement for the active batch records the wrong gate, batch, or scope revision;
- current state/batch revisions disagree;
- any changed implementation or test path exceeds the batch allowlist;
- any governed worktree or staged change remains uncommitted at transition-check time;
- a later gate is entered without its prerequisite certification/decision.

The GitHub Actions `Transition Control` workflow runs this check on transition-branch pushes and pull requests.

`npm run certify` also executes the transition check before the normal certification suite.

## 7. Guardrail self-modification

In-repository checks cannot cryptographically prevent an agent with repository write access from weakening the checks themselves.

Therefore `.github/CODEOWNERS` marks transition-control files, including `AGENTS.md`, as owned by `@swapnilshuk1`.

For strong server-side enforcement, GitHub branch/ruleset protection should require:

- pull requests for protected integration branches;
- the `Transition Control` status check;
- Code Owner review for changes to transition-control files;
- no force pushes / no branch deletion.

Without server-side branch protection, the mechanism strongly detects accidental drift but cannot be described as tamper-proof.

## 8. Current interpretation

At the start of Gate 1B Batch 01:

- Gate 1A is complete;
- extraction architecture remains `OPEN`;
- only source/provenance immutability work is authorized;
- EvidenceGraph is not authorized;
- evaluation/policy/dossier/serving/UI semantic changes are not authorized;
- only the provenance/lineage test surfaces explicitly named in `docs/transition/CURRENT_BATCH.json` are authorized;
- every future governed commit must be acknowledged before agent completion.
