# RADAR v2 — Editorial and Functional Audit

Date: 02 Sep 2026  
Scope: Read-only review of the current working tree and the remediation state at `498c95f`.

## Decision

The remediation is not yet release-safe. The targeted contract suites pass, but several runtime paths can still produce unsupported executive claims, and the deployed distributed-storage contract is not demonstrated.

## Critical findings

### P1 — Low-evidence editorial synthesis is not blocked

`AdvisoryConstitution.validateDataSufficiency()` correctly rejects missing or short descriptions, but no caller invokes it. `Context.tsx` and `EvidenceDrawer.tsx` call `getWhyThisRoleExistsParagraph()` directly. Its sparse branch still says sparse data suggests a “stealth-mandate” and that founder-led processes reached a “structural ceiling”. Those are hypotheses presented as facts, contrary to the constitution’s low-information rule.

`BriefCompositionEngine` and `EditorialEngine` likewise emit defaults such as “proven”, “multi-million budgets”, “established team oversight”, and “high shortlisting probability” when the opportunity has no dimensions or recommendation result. A missing evaluation therefore receives persuasive prose instead of an evidence-limited state.

### P1 — Certainty and provenance can be fabricated by heuristics

`EditorialContextBuilder` defaults a missing score to `50`, infers P&L ownership from titles such as `VP`, `CMO`, or `COO`, and labels transformation/mandate fields as title-derived. These values feed pattern selection and certainty language. A title is not evidence of P&L authority, reporting line, or business scale.

### P1 — Pattern-diversity guarantee can be bypassed

`EditorialPatternSelector` falls back from the strict 40% skeleton filter to unshown/all valid patterns when the filtered pool is empty. In addition, the principal routes call `BriefCompositionEngine.compose(..., { bypassHistory: true })`, disabling session history and skeleton accounting entirely. The declared diversity invariant is therefore not enforced on production render paths.

### P1 — Static editorial validation does not validate runtime output

`EditorialValidator.validatePatternDefinition()` checks concrete anchors using dummy values (`VP Growth`, `Acme Corp`, `Bengaluru`). A pattern can pass while its actual opportunity rendering contains no concrete anchor. Runtime checks for risk-first ordering, evidence provenance, frozen landmarks, consequence, and certainty matching are absent.

### P1 — Distributed BlobStore remains configuration-dependent in production

The remote PM2 process is online on `498c95f`, but its environment did not expose `RADAR_DEPLOYMENT_MODE`, `BLOB_STORAGE_ENDPOINT`, or `BLOB_STORAGE_BUCKET`. Without those variables `getBlobStore()` selects the local filesystem backend. The unstaged guard and smoke cleanup improvements are useful, but they do not establish remote object storage for the deployed process.

### P2 — LinkedIn fast-path company extraction remains weakly verified

The fast HTTP detail path passes the matched description element’s HTML to extraction, not necessarily the full page/top-card container. The new company-selector test supplies a full document, so it can pass without proving that the real fast path contains the company node. Unresolved companies are persisted as `Confidential / Unknown`, which can collapse unrelated postings and split acquisition lineage before post-detail resolution.

### P2 — UI design-system violations remain

Editorial surfaces contain prohibited arbitrary opacity and pixel classes, including `text-[9px]`, `text-[10px]`, `border-border/40`, `bg-surface-raised/20`, and `text-ink-muted/85`. These violate the registered token/class contract in `AGENTS.md`. `MarkdownRenderer` also trims lines before checking for indented bullets, making its nested-bullet branch unreachable.

## Verification performed

- Remediation suites: 34/34 passing.
- Editorial suites: 40/40 passing, plus editorial boundary/sanitation checks 9/9 passing.
- `npx tsc --noEmit`: passed.
- `npm run build`: produced the client/SSR build output without an observed error.
- Direct sparse-input check reproduced unsupported “stealth-mandate” and founder-ceiling claims.
- Production PM2 process was online, but the required remote BlobStore environment was not present.

## Release recommendation

Block approval until low-evidence rendering is fail-closed, heuristic provenance cannot elevate certainty, pattern history is enforced (or the invariant is withdrawn), and distributed deployment explicitly fails when remote storage is absent. Add adversarial editorial tests for empty/short descriptions, unevaluated opportunities, missing dimensions, and title-only P&L signals.
