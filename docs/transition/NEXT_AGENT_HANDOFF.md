# RADAR Transition — Canonical Next-Agent Handoff

Status: **ACTIVE**

This file is the mandatory entry point for any new coding or review agent joining the active RADAR transition work.

Do not infer the next task from the newest recon note, from commit messages, from a prior chat, or from architectural intuition. The machine-readable transition state and current-batch manifest are authoritative.

## Mandatory read order

Read these files in this exact order before changing code:

1. `AGENTS.md`
2. `docs/transition/NEXT_AGENT_HANDOFF.md`
3. `docs/RADAR_TRANSITION_CONTROL.md`
4. `docs/transition/RADAR_TRANSITION_STATE.json`
5. `docs/transition/CURRENT_BATCH.json`
6. `docs/transition/AGENT_CHANGE_ACK_PROTOCOL.md`
7. `docs/transition/IMPLEMENTATION_LEDGER.json`
8. `docs/transition/IMPLEMENTATION_ACK_TEMPLATE.json`
9. `docs/gate1/GATE1A_GOVERNANCE_DRIFT_POSTMORTEM.md`
10. `docs/gate1/GATE1A_RECON_BATCH_06A_CONTROL_RECONCILIATION.md`
11. `docs/gate1/GATE1A_RECON_BATCH_01_EVALUATION_MATERIALIZATION.md`
12. `docs/gate1/GATE1A_RECON_BATCH_02_ASSESSMENT_POLICY_SEMANTICS.md`
13. `docs/gate1/GATE1A_RECON_BATCH_03_EDITORIAL_PROPOSITION_PIPELINE.md`
14. `docs/gate1/GATE1A_RECON_BATCH_04_SERVING_READ_PATH_AND_LEGACY_COEXISTENCE.md`
15. `docs/gate1/GATE1A_RECON_BATCH_05_EDITORIAL_INPUT_PROVENANCE_AND_V1_RETIREMENT.md`
16. `docs/gate1/GATE1A_RECON_BATCH_06_CONTRACT_RECONCILIATION_AND_IMPLEMENTATION_SEQUENCE.md`

If any of these files is missing, contradictory, or cannot be read, stop and report that before implementation.

## Mandatory preflight

Before editing implementation code:

```bash
npm run transition:check
```

Then state explicitly in your working notes:

- the active gate from `docs/transition/RADAR_TRANSITION_STATE.json`;
- the active batch from `docs/transition/CURRENT_BATCH.json`;
- the current `scopeRevision`;
- the `mustNotChange` list;
- the `allowedPathPrefixes` relevant to your intended edits, including every test file you intend to change or create;
- any still-open decision recorded in `docs/transition/RADAR_TRANSITION_STATE.json`.

Do not continue if your intended implementation **or test** edit is outside the current batch.

## Source-of-truth hierarchy

When documents appear to disagree, use this hierarchy:

```text
docs/RADAR_TRANSITION_CONTROL.md
        ↓
docs/transition/RADAR_TRANSITION_STATE.json
        ↓
docs/transition/CURRENT_BATCH.json
        ↓
docs/gate1/GATE1A_RECON_BATCH_06A_CONTROL_RECONCILIATION.md
        ↓
Gate 1A recon documents
        ↓
older planning notes / prior chat summaries / agent reports
```

`docs/gate1/GATE1A_RECON_BATCH_06_CONTRACT_RECONCILIATION_AND_IMPLEMENTATION_SEQUENCE.md` remains valuable architecture recon, but its execution sequence is governed by `docs/gate1/GATE1A_RECON_BATCH_06A_CONTROL_RECONCILIATION.md` and the current transition state.

## Execution rules

1. Inspect actual code before making claims about behavior.
2. Execute only the batch authorized by `docs/transition/CURRENT_BATCH.json`.
3. Do not widen scope because a later architecture step appears convenient.
4. If a real dependency requires an out-of-scope path or semantic owner, stop before making that edit and update the governing control/state/batch authorization first.
5. Do not treat a reusable contract as proof that its current implementation is the selected future architecture.
6. Do not enter a later gate while an earlier gate's exit conditions remain open.
7. Preserve existing historical contracts unless the current batch explicitly authorizes migration.
8. Do not use read-time fallbacks or presentation recomputation to hide missing canonical truth.
9. Tests are governed changes: there is no blanket `tests/` exemption.
10. `npm run transition:check` must fail if governed work remains uncommitted; do not report completion from a dirty governed worktree.

## Commit and acknowledgement protocol

Every governed implementation/test/documentation commit must follow:

```text
implementation/edit
→ narrow verification
→ implementation commit
→ copy `docs/transition/IMPLEMENTATION_ACK_TEMPLATE.json`
→ add exact commit SHA + actual evidence to `docs/transition/IMPLEMENTATION_LEDGER.json`
→ commit the ledger acknowledgement
→ run `npm run transition:check`
→ only then report completion
```

Use `docs/transition/AGENT_CHANGE_ACK_PROTOCOL.md` for the update rules and `docs/transition/IMPLEMENTATION_ACK_TEMPLATE.json` for the acknowledgement shape.

Do not add an implementation-ledger acknowledgement before the implementation commit exists; acknowledgements refer to exact commit SHAs.

The control check must be green at handoff.

## When to update which control file

Do not turn `docs/RADAR_TRANSITION_CONTROL.md` into a diary.

Use:

- `docs/transition/IMPLEMENTATION_LEDGER.json` after every governed committed change;
- `docs/transition/CURRENT_BATCH.json` and `docs/transition/RADAR_TRANSITION_STATE.json` when batch scope/authorization changes;
- `docs/RADAR_TRANSITION_CONTROL.md` when a gate, architectural decision, invariant, exit criterion, or governing sequence changes.

## Required completion report

A new agent must not report work complete without providing:

- implementation commit SHA(s);
- implementation-ledger acknowledgement commit SHA;
- current branch HEAD;
- exact verification commands and results;
- confirmation that `npm run transition:check` passed after acknowledgement;
- confirmation that there are no uncommitted governed changes;
- any unresolved issue that remains inside the active batch;
- whether the active batch is still open or is ready for explicit closure/certification.

## Canonical bootstrap prompt

A user may give the following prompt verbatim to any new agent:

> Work on the RADAR transition in repository `swapnilshuk1/RadarV2`. Use the currently checked-out transition branch and do not infer scope from prior chats, commit messages, or the newest recon note. Before doing anything else, read these files in order: `AGENTS.md`, `docs/transition/NEXT_AGENT_HANDOFF.md`, `docs/RADAR_TRANSITION_CONTROL.md`, `docs/transition/RADAR_TRANSITION_STATE.json`, `docs/transition/CURRENT_BATCH.json`, `docs/transition/AGENT_CHANGE_ACK_PROTOCOL.md`, `docs/transition/IMPLEMENTATION_LEDGER.json`, `docs/transition/IMPLEMENTATION_ACK_TEMPLATE.json`, `docs/gate1/GATE1A_GOVERNANCE_DRIFT_POSTMORTEM.md`, `docs/gate1/GATE1A_RECON_BATCH_06A_CONTROL_RECONCILIATION.md`, `docs/gate1/GATE1A_RECON_BATCH_01_EVALUATION_MATERIALIZATION.md`, `docs/gate1/GATE1A_RECON_BATCH_02_ASSESSMENT_POLICY_SEMANTICS.md`, `docs/gate1/GATE1A_RECON_BATCH_03_EDITORIAL_PROPOSITION_PIPELINE.md`, `docs/gate1/GATE1A_RECON_BATCH_04_SERVING_READ_PATH_AND_LEGACY_COEXISTENCE.md`, `docs/gate1/GATE1A_RECON_BATCH_05_EDITORIAL_INPUT_PROVENANCE_AND_V1_RETIREMENT.md`, and `docs/gate1/GATE1A_RECON_BATCH_06_CONTRACT_RECONCILIATION_AND_IMPLEMENTATION_SEQUENCE.md`. Then run `npm run transition:check`. Treat `docs/RADAR_TRANSITION_CONTROL.md`, `docs/transition/RADAR_TRANSITION_STATE.json`, and `docs/transition/CURRENT_BATCH.json` as the governing authorization. State the active gate, active batch, scope revision, `mustNotChange` constraints, authorized implementation/test paths relevant to your intended work, and every still-open decision before editing code. Inspect the actual repository code relevant to the current authorized batch and execute only that batch. Do not cross into a later gate, modify an unlisted test path, or widen semantic ownership without first updating the governing control/state/batch authorization. After each governed implementation/test/documentation commit, use `docs/transition/IMPLEMENTATION_ACK_TEMPLATE.json` to add the exact commit SHA and actual verification evidence to `docs/transition/IMPLEMENTATION_LEDGER.json`, commit that acknowledgement, and rerun `npm run transition:check`. Do not declare completion unless the check passes and there are no uncommitted governed changes. Report the implementation commit SHA(s), ledger acknowledgement commit SHA, final branch HEAD, exact verification results, unresolved issues inside the active batch, and whether the current batch is ready for explicit closure. Do not modify production behavior outside the scope authorized by `docs/transition/CURRENT_BATCH.json`.

## Server-side protection note

Repository-local enforcement detects and blocks accidental process drift when the transition check is run and when its CI status is required.

For protection against intentional or accidental weakening of the guard itself, protected integration branches should require:

- pull requests;
- the `Transition Control` status check;
- Code Owner review for `AGENTS.md`, `docs/RADAR_TRANSITION_CONTROL.md`, `docs/transition/`, `scripts/transition/`, `.github/workflows/transition-control.yml`, and `.github/CODEOWNERS`;
- no force pushes.

`.github/CODEOWNERS` records the intended ownership. GitHub branch/ruleset configuration is the server-side enforcement layer and must be configured with repository administration privileges.

At the time this handoff mechanism was installed, `phase5/gate1-architecture-recon` was not branch-protected. A future agent must not claim the in-repository mechanism is tamper-proof unless repository protection is separately verified.
