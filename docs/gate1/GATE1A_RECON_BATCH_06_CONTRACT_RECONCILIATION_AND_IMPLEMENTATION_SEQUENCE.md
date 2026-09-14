# Gate 1A Recon — Batch 06: Authoritative Contract Reconciliation and Exact Implementation Sequence

**Branch:** `phase5/gate1-architecture-recon`  
**Parent recon commit:** `edb84ea92190b3c6d430fb845da0c267e626ab89`  
**Scope:** documentation/recon only — no production code changes

## 1. Purpose

Batch 05 established the provenance and cutover prerequisites for replacing presentation-shaped semantic authority. It ended with one explicit instruction: stop expanding the inventory and reconcile the future architecture against the authoritative contracts that exist now.

Batch 06 therefore reconciles these ten current contracts/boundaries:

1. `opportunity_versions` / source snapshot identity;
2. `RoleIntelligenceOutputV1`;
3. `JobProjection` role evidence;
4. `CandidateProofOutputV1`;
5. `CandidateProjection`;
6. `CanonicalDecisionTraceV1`;
7. canonical v4.3 evaluation payload;
8. `DecisionPolicyEngine`;
9. `EditorialIntelligenceContract`;
10. `CanonicalDossierPresentationV2`.

For each one this batch records:

- semantics to retain;
- semantics that must move to another owner;
- minimum vNext shape;
- persistence/versioning requirement;
- migration dependency;
- proving test/gate.

The output is an internally consistent contract-reconciliation matrix plus the smallest safe ordered production implementation batches.

This batch does **not** implement those contracts.

---

## 2. Files inspected

The reconciliation was performed against the current branch implementations, including:

```text
src/data/sqlite/migrations/010_candidate_documents_and_evidence.sql
src/data/sqlite/migrations/011_document_contents_and_intent.sql
src/data/sqlite/migrations/020_canonical_acquisition.sql
src/data/sqlite/migrations/033_opportunity_version_source_payload.sql
src/data/sqlite/migrations/034_acquisition_ingestion_lineage.sql
src/data/sqlite/migrations/038_opportunity_version_category_projection.sql
src/data/sqlite/migrations/044_materialized_dossier_presentations.sql
src/data/sqlite/migrations/045_intelligence_knowledge.sql

src/data/sqlite/repositories/SqliteDocumentStore.ts
src/data/sqlite/repositories/SqliteDossierPresentationStore.ts
src/data/sqlite/repositories/SqliteEvaluationContextStore.ts
src/data/sqlite/repositories/SqliteOpportunityQueries.ts
src/data/sqlite/repositories/profile-projection-version.ts

src/lib/domain/job_projection.ts
src/lib/domain/candidate_projection.ts
src/lib/domain/evaluation_context.ts
src/lib/domain/evaluation_fingerprint.ts
src/lib/domain/evaluation_payloads.ts
src/lib/domain/dossier_presentation.ts
src/lib/domain/semantic.ts

src/lib/intelligence/extraction/RoleIntelligenceExtractorV1.ts
src/lib/intelligence/extraction/CandidateProofExtractorV1.ts
src/lib/intelligence/builders/JobProjectionBuilder.ts
src/lib/intelligence/policy/QualityScoreCalculator.ts
src/lib/intelligence/policy/DecisionPolicyEngine.ts
src/lib/intelligence/record.ts
src/lib/intelligence/engine.ts
src/lib/intelligence/evaluation/PayloadMapper.ts
src/lib/intelligence/editorial/EditorialIntelligenceContract.ts
src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder.ts
src/lib/intelligence/editorial/EditorialPropositionComposer.ts
src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer.ts
src/lib/intelligence/EvaluationWorker.ts
src/lib/intelligence/rematerialization/EvaluationRematerializer.ts

src/routes/opportunity.$jobHash.tsx
```

The conclusions below are based on the actual `phase5/gate1-architecture-recon` branch, not on stale architectural intent or default-branch search results.

---

## 3. Reconciliation result in one sentence

The target architecture can be reached without discarding RADAR's strongest existing boundaries, but only if semantic ownership is split before the current presentation/evaluation compatibility objects are retired:

```text
immutable source snapshots
        ↓
source interpretation
        ↓
typed role ↔ candidate relationships
        ↓
policy-independent evaluation
        ↓
deterministic decision / pursuit policy
        ↓
editorial explanation plan
        ↓
proposition composition / wording
        ↓
versioned persisted dossier
        ↓
validated serving
```

The core ownership rule is:

```text
Source stores own source identity and immutable bytes/text.
RoleIntelligence / CandidateProof own extracted source facts.
EvidenceGraph owns role↔candidate relationship classification.
Evaluation owns assessment truth, fit, risk, uncertainty, and confidence.
DecisionPolicy owns recommendation semantics and pursuit policy.
Editorial plan owns what to explain, not what is true.
Composer owns wording/synthesis, explicitly labelled as inference.
Presentation persistence owns a derived, versioned artifact.
Serving owns validation/selection only.
UI owns rendering only.
```

No later layer may recreate an earlier layer's semantic authority.

---

## 4. Identity contracts that should not be casually redesigned

Batch 06 found that the most valuable parts of the current architecture are the immutable identity boundaries. They should be carried forward unless a proving test demonstrates a defect.

### 4.1 Role source identity

The canonical role source identity is:

```text
canonicalJobId + opportunityVersion
```

with `content_hash` on the exact `opportunity_versions` row.

Every future role proposition, role snapshot, evidence edge, evaluation and dossier must remain traceable to this exact version rather than to a floating `jobHash` or current posting.

### 4.2 Candidate evaluation identity

The current content-addressed candidate input boundary is:

```text
profileVersion
```

resolved under exact `(tenantId, personId)` scope with no latest-profile fallback.

That discipline should remain. A vNext evaluation must never silently substitute a newer candidate profile for the one pinned in the evaluation context.

### 4.3 Evaluation context identity

The current context fingerprint binds:

```text
tenantId
personId
searchPlanSnapshotId
ontologyVersion
ontologyFingerprint
policyVersion
profileVersion
```

This is a strong immutable control-plane contract.

### 4.4 Evaluation identity

The current canonical evaluation identity is derived from:

```text
canonicalJobId
opportunityVersion
evaluationContextFingerprint
```

This remains the correct idempotency identity for one evaluation of one exact role version under one exact context.

### 4.5 Presentation identity

The current persisted presentation store binds:

```text
tenantId
personId
canonicalJobId
opportunityVersion
evaluationContextFingerprint
presentationVersion
```

and separately validates the exact source evaluation fingerprint.

That separation — evaluation truth vs derived presentation — is architecturally correct and should survive vNext.

---

## 5. Contract-reconciliation matrix

| Current contract / store | Retain | Move to another owner | Minimum vNext shape | Persistence / versioning requirement | Migration dependency | Proving gate |
| --- | --- | --- | --- | --- | --- | --- |
| `opportunity_versions` + acquisition lineage | exact canonical job/version identity, source content hash, source metadata, source-payload lineage | semantic role interpretation; requirement classification; editorial role claims | `RoleSourceSnapshotRef` keyed by canonical job/version/content hash | existing version row remains source anchor; referenced source rows must be append-only in practice and covered by immutability tests | none; this is the root | same job/version always resolves to identical canonical source bytes/text + hash |
| `RoleIntelligenceOutputV1` | exact source spans, section/subject, role semantic type, requirement materiality/dimension, normalized source claim, extraction confidence/method | benchmark `caseId` identity; any future candidate-specific consequence | `RoleIntelligenceSnapshotVNext` bound to opportunityVersion/contentHash with stable proposition IDs | immutable persisted snapshot, versioned by extractor/schema and fingerprint | source snapshot immutability | every proposition resolves verbatim to exact source snapshot; no candidate input accepted |
| `JobProjection` role evidence | evaluator-specific role projection, grounded capability requirements, exact scoring input auditability | source-fact registry to RoleIntelligence; presentation-only role work/qualification augmentation out of scoring projection; broad semantic ownership out of builder heuristics | `EvaluationRoleProjection` referencing a RoleIntelligence fingerprint plus exact projection fingerprint | exact scored projection must remain replayable/resolvable until RoleIntelligence fully replaces its source authority | RoleIntelligence canonicalization | scorer parity on frozen corpus; presentation evidence removal cannot change intrinsic score/verdict |
| `CandidateProofOutputV1` | source-document + offset proof identity, exact text spans, metrics/entities, work-history structure | no fit judgment, no role relationship, no policy semantics | immutable `CandidateProofSnapshotVNext` per source document/version, optionally aggregated by a candidate proof-set fingerprint | candidate source text must become immutable/versioned; proof snapshot persisted with extractor version + source hash | candidate document immutability | old proof ID always resolves to same exact source text after later uploads/re-extractions |
| `CandidateProjection` | exact `profileVersion`, evaluator-specific candidate interpretation, hard gates/calibration needed by scoring | raw source-proof ownership to CandidateProof; editorial source authority out of projection; relationship classification out of semantic arrays | `EvaluationCandidateProjection` / existing projection with explicit proof snapshot refs and content-addressed profileVersion | existing exact profile resolution retained; add proof snapshot fingerprint/ref when canonical proof store exists | CandidateProof durability | exact profileVersion resolves uniquely; scoring parity before/after proof-ref wiring |
| `CanonicalDecisionTraceV1` | concept of persisted evaluator-produced relationships/components; exact evidence ID references where available | relationship registry to EvidenceGraph; stable assessment/risk/driver entities to EvaluationSnapshot; compositional ordering IDs out | `EvidenceGraphVNext` + `EvaluationSnapshotVNext` | do not mutate V1 semantics in place; preserve for historical v4.3; write successor artifacts forward-only | durable role/candidate evidence IDs | every relationship resolves both sides; relation vocabulary preserves unsupported/unknown/contradicted distinctions; assessment IDs stable |
| canonical v4.3 payload | identity/provenance fields, exact context/profile/policy/ontology binding, fail-closed validation, materialization discipline | `jobProjection` as long-term source authority; thin trace as full explanation model; final semantic ownership split into evaluation + policy refs | `CanonicalEvaluationPayloadVNext` containing exact identity + source/proof/graph/evaluation/policy references or embedded immutable snapshots | clean versioned successor; v4.3 remains immutable historical contract | Role/Candidate evidence durability + graph + evaluation/policy contracts | v4.3 unchanged; vNext identity consistency; serving never adapts old payload into new semantic claims |
| `DecisionPolicyEngine` | deterministic decision gates, thresholds/rules, final PURSUE/CONSIDER/PASS semantics, triggered rule IDs, pursuit-friction decisions, tailoring effort where policy-like | `QualityScoreCalculator` output ownership to Evaluation; source extraction/gating out; assessment drivers/risks to Evaluation; free-form differentiator/trajectory prose out | `DecisionPolicyOutputVNext` consuming EvaluationSnapshot + explicit pursuit constraints and producing verdict, rule reasons, structured hinges/strategy | versioned policy output fingerprinted against evaluation + policy version; no free-form semantic fallback as authority | EvaluationSnapshot | golden policy parity; counterfactual hinge tests; changing prose cannot change verdict |
| `EditorialIntelligenceContract` V2 | dedicated pre-composition boundary, explicit source/candidate/canonical provenance separation, synthesis-input concept | role/candidate facts become refs to source registries; fit relations to graph; risks/tradeoffs/why-now to Evaluation; hinges/action/effort/stop conditions to Policy; semantic derivation such as adjacency risk out | `EditorialPlanVNext` containing only resolved display facts + stable upstream refs + explanation directives | versioned derived plan; recomputable from immutable upstream artifacts; persisted if needed for audit/dual-write | all semantic owners above | builder accepts no `EvaluationArtifact` and reads no `artifact.opportunity`; deleting presenter fields cannot change plan truth |
| `CanonicalDossierPresentationV2` | persisted derived artifact, identity binding, evaluated/unavailable coherence, proposition fact-vs-inference distinction, proposition refs, section support graph | no new semantic authority; no source/evaluation/policy recomputation | `CanonicalDossierPresentationV3` only if needed for safe dual-write/cutover and stronger upstream fingerprints; otherwise V2 semantics remain model | successor version recommended for coexistence during migration because store keys active presentation by `schemaVersion`; retain V2 read compatibility until cutover | EditorialPlanVNext | V2/V3 can coexist; all proposition refs resolve; read path validates exact evaluation/policy lineage; zero runtime recomposition |

The rest of this document explains the matrix in enough detail to implement it without reopening architectural ownership questions.

---

## 6. Current `opportunity_versions` → `RoleSourceSnapshotRef`

### 6.1 What is already correct

`opportunity_versions` is already the correct source-of-source boundary for a role. An evaluation job is pinned to one exact row, and the worker loads by exact `(canonical_job_id, id)`.

The source contract therefore does not need a new global role identity.

### 6.2 Minimum future source reference

Working shape:

```text
RoleSourceSnapshotRef {
  canonicalJobId
  opportunityVersion
  contentHash

  title
  companyName
  location?
  employmentType?
  categoryIds[]

  sourcePayloadKey?
  sourceMediaType?
  documentExtractionState?
}
```

This is a source locator/identity record, not an intelligence object.

### 6.3 Explicit prohibition

It must not contain:

```text
candidate fit
career value
risk
recommendation
positioning
verdict
```

### 6.4 Durability requirement

Rows referenced by durable evidence IDs must behave as immutable snapshots. The current schema's version/content-hash uniqueness is strong, but write-path tests should prove that the source bytes/text for an existing version are never rewritten underneath the same identity.

A new semantic architecture should not depend on an undocumented convention here.

---

## 7. `RoleIntelligenceOutputV1` → `RoleIntelligenceSnapshotVNext`

### 7.1 Semantics to retain

The strongest parts of V1 are:

- exact source offsets;
- exact source text;
- explicit role/company/recruiting-process subject;
- section provenance;
- semantic type;
- requirement materiality and dimension;
- action/ownership details;
- normalized source claim;
- extraction confidence/method;
- no candidate input.

These are proper extraction-layer semantics.

### 7.2 Identity change required

The benchmark-oriented identity:

```text
role_atom:<caseId>:<start>_<end>:<semanticType>
```

must become production-source scoped.

A minimum production proposition identity should bind:

```text
canonicalJobId
opportunityVersion
sourceContentHash
startOffset
endOffset
semanticType
```

The exact serialization/hash format is an implementation detail; the invariants are not.

### 7.3 Minimum future shape

```text
RoleIntelligenceSnapshotVNext {
  schemaVersion
  extractorVersion
  fingerprint
  source: RoleSourceSnapshotRef

  propositions[] {
    id
    exactText
    startOffset
    endOffset
    section
    subject
    semanticType?
    confidence
    extractionMethod
    normalizedClaim?
    requirement?
    actionRole?
  }
}
```

### 7.4 Persistence requirement

Persist the snapshot or an equivalent immutable proposition registry. A historical proposition ID must resolve without replaying a future extractor version.

### 7.5 What does **not** belong here

RoleIntelligence does not decide whether a candidate satisfies a requirement. It does not decide whether a role is attractive. It does not emit PURSUE/CONSIDER/PASS.

---

## 8. `JobProjection` → evaluator projection, not canonical source truth

`JobProjection` remains useful, but its target responsibility is narrower than its current implementation.

### 8.1 Retain

Retain the evaluator-facing normalized representation required by the assessment engines, including:

- executive identity;
- operating level;
- work nature;
- decision authority;
- commercial scope;
- capability requirements;
- explicit/inferred capabilities;
- grounded dimensions;
- exact projection fingerprint/version.

### 8.2 Move out

Move these ownerships out of `JobProjection` as canonical truth:

- exact employer source facts → `RoleIntelligenceSnapshotVNext`;
- presentation-only role work → role intelligence / editorial resolution;
- presentation qualification evidence → role intelligence / editorial resolution;
- long-lived role evidence IDs → canonical role proposition registry.

### 8.3 Minimum evaluator projection contract

The existing `JobProjection` may initially remain the physical scoring type, but vNext should make its dependency explicit:

```text
EvaluationRoleProjection {
  projectionVersion
  projectionFingerprint
  roleIntelligenceFingerprint
  sourceVersion: opportunityVersion

  ...normalized fields required by assessment engines...
}
```

### 8.4 Migration rule

Do not rewrite all scoring engines and source extraction in the same patch.

First make RoleIntelligence durable; then adapt `JobProjectionBuilder` to consume that immutable snapshot while proving score/verdict parity. Only after parity should duplicated source extraction inside the builder be retired.

---

## 9. `CandidateProofOutputV1` → immutable candidate proof registry

### 9.1 Semantics to retain

CandidateProof V1 already has the right factual boundary:

- exact source-document identity;
- exact offset-backed claims;
- exact parent bullet lineage;
- work history positions;
- metrics with structured comparator/value semantics;
- source-grounded entities;
- proof types;
- self-summary vs work-history distinction;
- extractor audit counts.

### 9.2 Source immutability blocker

These IDs are only lifetime-safe if the referenced source document content cannot change under the same identity.

Current `document_contents` writes can update `raw_text`/`text_hash` for the same `documentId`. That must be fixed before CandidateProof becomes canonical evidence.

### 9.3 Minimum future shape

Per immutable source document:

```text
CandidateProofSnapshotVNext {
  schemaVersion
  extractorVersion
  fingerprint

  personId
  sourceDocumentId
  sourceDocumentHash
  sourceTextHash

  positions[]
  claims[] {
    id
    exactText
    startOffset
    endOffset
    parentBulletRef
    evidenceClass
    proofTypes[]
    metrics[]
    groundedEntities[]
  }

  education[]
}
```

For candidates with multiple authoritative documents, evaluation may consume a separate proof-set reference:

```text
CandidateProofSetRef {
  fingerprint
  proofSnapshotIds[]
}
```

The proof set must not silently mean "latest documents".

---

## 10. `CandidateProjection` → exact evaluator input, not source-proof store

### 10.1 Semantics to retain

The current projection remains the correct place for evaluator-oriented candidate interpretation such as:

- operating scale;
- P&L/revenue ownership;
- people/geographic scope;
- career history;
- hard-gate state;
- inferred capabilities used by scoring;
- mobility/intent context;
- calibration/confidence;
- exact `profileVersion`.

### 10.2 Strong current invariant

`profileVersion` is content-addressed and exact profile resolution has no chronological fallback.

This should remain unchanged.

### 10.3 Move out

The projection must stop being the only place an editorial or evidence consumer can recover candidate proof.

In particular:

- raw source proof belongs to CandidateProof;
- candidate↔role relationship belongs to EvidenceGraph;
- candidate proof IDs should resolve independently of array position wherever possible.

### 10.4 Minimum evolution

The existing physical type can remain while adding explicit lineage:

```text
EvaluationCandidateProjection {
  profileVersion
  candidateProofSetFingerprint
  ...existing evaluator-facing fields...
}
```

The goal is not to duplicate CandidateProof inside CandidateProjection. The goal is to make every evaluator claim traceable back to a durable proof snapshot.

---

## 11. `CanonicalDecisionTraceV1` → split into EvidenceGraph and EvaluationSnapshot

This is the most important contract split in Batch 06.

### 11.1 What V1 gets right

The trace already recognizes two distinct things:

1. role↔candidate relationships;
2. evaluation components such as strengths/constraints.

It also carries job and candidate evidence IDs.

### 11.2 What V1 cannot safely become

The type permits:

```text
MATCH | ADJACENT | GAP | UNKNOWN
```

but the current mapper writes every accepted evaluator mapping as:

```text
relationship: MATCH
```

and the current strength/constraint components are persisted with empty evidence ID arrays.

Therefore V1 is useful migration evidence, but it is not a complete canonical evidence graph or a complete evaluation explanation contract.

### 11.3 Minimum EvidenceGraph contract

Working shape:

```text
EvidenceGraphVNext {
  schemaVersion
  fingerprint

  roleIntelligenceFingerprint
  candidateProofSetFingerprint
  candidateProfileVersion

  relationships[] {
    id
    roleEvidenceIds[]
    candidateEvidenceIds[]
    roleCapabilityKey?
    candidateCapabilityKey?

    relationship:
      DIRECT
      | ADJACENT
      | TRANSFERABLE
      | UNSUPPORTED
      | CONTRADICTED
      | UNKNOWN

    confidence
    basisVersion
  }
}
```

### 11.4 Relationship semantics

The relationship layer owns correspondence, not consequence:

```text
DIRECT        candidate evidence directly satisfies the role proposition/capability
ADJACENT      evidence is closely related but not equivalent
TRANSFERABLE  evidence supports a generalized transferable capability rather than the same operating fact
UNSUPPORTED   the canonical proof corpus was sufficient to check, but no satisfying proof was found
CONTRADICTED  candidate evidence positively conflicts with the role proposition/requirement
UNKNOWN       source/proof evidence is insufficient or ambiguous to classify support honestly
```

`UNSUPPORTED` and `UNKNOWN` must remain distinct.

### 11.5 Stable relationship identity

A relationship ID must be based on immutable endpoint identities and relationship schema/version, not an array index.

Changing presentation order must never change relationship identity.

---

## 12. EvaluationSnapshotVNext

The current engine already has standalone assessment engines before policy. Batch 06 makes that conceptual boundary durable.

### 12.1 Evaluation owns

Evaluation owns candidate-role judgment independent of the final pursuit policy:

- fit / intrinsic quality;
- evidence completeness;
- evaluation confidence;
- capability/identity/career/opportunity/lifestyle assessments;
- strengths;
- constraints;
- risks;
- uncertainty;
- assessment-level unknowns;
- evidence-backed career tradeoffs;
- evidence-backed why-this-role/why-now conclusions where they are genuine assessment facts.

### 12.2 Current score semantics

The live code confirms that `QualityScoreCalculator` computes the current Model C intrinsic `qualityScore` and that `DecisionPolicyEngine` uses it when deciding the verdict. The engine then persists that same scalar in `RecommendationRecord`.

Therefore the migration should preserve the existing score formula first and move its **ownership/location**, not silently redefine its meaning.

### 12.3 Minimum future shape

```text
EvaluationSnapshotVNext {
  schemaVersion
  fingerprint

  evaluationIdentity {
    canonicalJobId
    opportunityVersion
    evaluationContextFingerprint
    profileVersion
  }

  roleIntelligenceFingerprint
  candidateProofSetFingerprint
  evidenceGraphFingerprint
  evaluationRoleProjectionFingerprint
  evaluationCandidateProjectionVersion

  state:
    EVALUATED
    | SPARSE_SPEC
    | NOT_EVALUABLE
    | ...explicit canonical unavailable states...

  qualityScore: number | null
  evidenceCompleteness: number | structured-state
  decisionConfidence: number | structured-state

  assessments[] {
    id
    dimension
    state
    score?
    relationshipIds[]
    evidenceIds[]
    confidence
  }

  strengths[] { id, assessmentIds[], relationshipIds[], evidenceIds[] }
  constraints[] { id, assessmentIds[], relationshipIds[], evidenceIds[] }
  risks[] { id, code, severity, assessmentIds[], relationshipIds[], evidenceIds[] }
  unknowns[] { id, code, assessmentIds[], relationshipIds[], evidenceIds[] }
}
```

The exact scoring substructure can evolve later. The critical requirement is that risk/driver/unknown identities become stable, evidence-backed entities before editorial composition.

### 12.4 What evaluation does not own

Evaluation does not emit the final pursuit action merely because a score exists.

A high-quality role may still be a policy-level CONSIDER/PASS because of hard requirements, shortlisting probability, pursuit friction, or user intent. That distinction already exists in the current policy code and should become explicit in persistence.

---

## 13. `DecisionPolicyEngine` → `DecisionPolicyOutputVNext`

### 13.1 Semantics to retain

Retain:

- deterministic PURSUE / CONSIDER / PASS ownership;
- rule IDs;
- hard vetoes and decision thresholds;
- shortlisting and pursuit-friction decision gates;
- explicit policy version;
- policy-like tailoring effort;
- deterministic fail-closed behavior.

### 13.2 Semantics to move upstream

These are evaluation concerns and should not be canonically owned by policy:

- intrinsic quality-score calculation;
- evidence sufficiency assessment;
- identity/capability/career assessment construction;
- evidence relationship classification;
- source claim permission inference.

Policy may consume these results, but should not recreate them.

### 13.3 Semantics to move downstream or structure

Current free-form strings such as:

```text
relativeDifferentiator
trajectoryUpside
```

should not remain the durable semantic API between policy and editorial.

If they represent real evaluation facts, persist those facts in EvaluationSnapshot. If they are pursuit guidance, emit structured policy strategy. If they are wording, generate them editorially.

### 13.4 Minimum future policy input

```text
DecisionPolicyInputVNext {
  evaluationFingerprint
  evaluationSnapshot

  careerIntentSnapshotRef
  pursuitConstraints {
    locationPreference?
    workModelPreference?
    travelTolerance?
    compensationFloor?
    activePursuitLoad?
  }

  policyVersion
}
```

### 13.5 Minimum future policy output

```text
DecisionPolicyOutputVNext {
  schemaVersion
  fingerprint
  policyVersion
  evaluationFingerprint

  verdict: PURSUE | CONSIDER | PASS
  triggeredRuleIds[]

  reasons[] {
    id
    code
    effect: SUPPORT | DOWNGRADE | VETO | LIMIT
    assessmentIds[]
    relationshipIds[]
    evidenceIds[]
  }

  decisionHinges[] {
    id
    code
    question
    ifResolvedPositive?: verdict/effect
    ifResolvedNegative?: verdict/effect
    sourceAssessmentIds[]
    sourceRelationshipIds[]
  }

  pursuitStrategy {
    effort: LOW | MODERATE | HIGH
    recommendedActionCode
    diligenceRequirementCodes[]
    stopConditionCodes[]
    positioningDirectives[]
  }
}
```

Free-form wording is not required here. Stable codes and source references are.

### 13.6 Decision hinges

A hinge belongs here when it is genuinely decision-changing or policy-relevant.

The current editorial builder's `decisionHinges(...)` can ask useful questions, but it creates them after evaluation/policy from presentation material. vNext should persist the semantic hinge upstream and let editorial choose wording.

---

## 14. canonical v4.3 → clean successor, not semantic mutation

### 14.1 What v4.3 gets right

The canonical v4.3 payload is strong on:

- exact role version identity;
- exact tenant/person/context;
- exact `profileVersion`;
- policy/ontology provenance;
- immutable evaluation fingerprint;
- fail-closed schema validation;
- explicit unavailable state;
- exact scored `jobProjection` retention;
- materialized relational read model.

These properties should be preserved.

### 14.2 Why v4.3 should not be progressively overloaded

Its evaluated contract is intentionally thin:

```text
decision
score
diligenceStatus
jobProjection
decisionTrace?
```

Adding durable RoleIntelligence, CandidateProof, EvidenceGraph, assessment entities, policy output and editorial planning directly into the meaning of `v4.3-intrinsic` would turn the existing historical contract into a moving target.

### 14.3 Minimum successor shape

Working shape:

```text
CanonicalEvaluationPayloadVNext {
  schemaVersion
  evaluationContractVersion

  canonicalJobId
  opportunityVersion
  jobHash
  evaluatedAt

  contextFingerprint
  tenantId
  personId
  profileVersion
  policyVersion
  ontologyVersion
  ontologyFingerprint

  evaluationInputHash

  roleSourceRef
  roleIntelligenceFingerprint
  candidateProofSetFingerprint
  evidenceGraphFingerprint
  evaluationSnapshot
  decisionPolicyOutput

  // compatibility/read scalars, derived exactly from authoritative nested outputs
  evaluationState
  decision
  qualityScore
}
```

The exact choice between embedding immutable child snapshots and referencing separately persisted snapshots can be decided during implementation. The invariants are:

1. every reference resolves for the lifetime of the evaluation;
2. no read path has to rerun semantic extraction to explain the stored evaluation;
3. the compatibility `decision` and `qualityScore` scalars exactly equal their authoritative nested owners;
4. v4.3 historical payloads are never reinterpreted as though they contained vNext detail.

---

## 15. `EditorialIntelligenceContract` V2 → `EditorialPlanVNext`

The V2 contract is a valuable architectural seam but currently contains too much upstream meaning.

### 15.1 Retain

Retain the idea of a dedicated, versioned contract between canonical semantic truth and prose composition.

Retain:

- explicit distinction among employer facts, candidate facts, canonical signals and RADAR inference;
- synthesis inputs;
- provenance refs;
- bounded source statements;
- an editorial-only contract consumed by the composer.

### 15.2 Move upstream

Current V2 fields move as follows:

| Current V2 field/semantic | Future owner |
| --- | --- |
| `publishedRoleWork` | RoleIntelligence |
| `roleContext` | RoleIntelligence |
| `qualificationRequirements` | RoleIntelligence |
| `candidateCapabilities` / `candidatePrecedents` | CandidateProof / candidate evaluation snapshot |
| `candidateFitEvidence` | EvidenceGraph |
| `capabilityMatches` | EvidenceGraph / Evaluation |
| `principalRisk` | EvaluationSnapshot |
| `careerTradeoff` | EvaluationSnapshot |
| `whyNow` | EvaluationSnapshot when it is an assessment; otherwise editorial synthesis clearly labelled as inference |
| `decisionDrivers` | EvaluationSnapshot + Policy reason refs |
| `decisionHinges` | DecisionPolicyOutput |
| `recommendedAction` | DecisionPolicyOutput pursuit strategy |
| `positioningAngles` | structured pursuit strategy upstream; prose realization editorial |
| `verdict` | DecisionPolicyOutput |
| `qualityScore` | EvaluationSnapshot |
| `careerCase` | editorial synthesis only, supported by upstream refs |

### 15.3 Explicit functions that change owner

Current presentation-side derivation such as functional adjacency risk must not survive as semantic authority in vNext.

If a role is materially more operating-delivery-heavy than the candidate's strongest precedent, that relationship must originate from EvidenceGraph/Evaluation. Editorial may explain it; it may not decide it.

Likewise, a decision hinge must originate from Evaluation/Policy if it can change the recommendation.

### 15.4 Minimum future editorial plan

```text
EditorialPlanVNext {
  schemaVersion
  fingerprint

  identity {
    canonicalJobId
    opportunityVersion
    evaluationFingerprint
    evaluationSnapshotFingerprint
    policyOutputFingerprint
  }

  roleFactRefs[]
  candidateFactRefs[]
  relationshipRefs[]
  assessmentRefs[]
  policyReasonRefs[]
  decisionHingeRefs[]

  explanationDirectives[] {
    section
    purpose
    priority
    allowedSourceRefs[]
    allowedInferenceKinds[]
  }

  resolvedDisplayFacts[]? {
    sourceId
    textSnapshot
  }
}
```

`resolvedDisplayFacts` is optional but useful for durable presentation audit. If persisted, it is a display snapshot tied to stable source IDs, not a new semantic fact.

### 15.5 New builder signature invariant

The vNext builder must not accept:

```text
EvaluationArtifact
Presented / Opportunity presentation object
artifact.opportunity
```

It should accept only explicit immutable semantic inputs or their exact persisted snapshots.

---

## 16. `CanonicalDossierPresentationV2` → preserve semantics, version for cutover

### 16.1 What V2 gets right

V2 already provides:

- exact identity tuple;
- exact evaluation fingerprint;
- explicit evaluated vs unavailable state;
- source-fact vs candidate-fact vs RADAR-inference vs verdict proposition kinds;
- proposition-level provenance references;
- section support relationships;
- clear statement that editorial text is synthesis, not source/evaluation truth;
- persisted read path with no request-time advisory recomputation.

This is excellent prior art and should be retained.

### 16.2 Why a successor version is still recommended

`materialized_dossier_presentations` treats `schemaVersion` as the persisted presentation version in its primary key.

A safe migration benefits from old and new presentation artifacts coexisting for the same evaluation while parity/audit coverage is established.

Therefore a clean successor such as:

```text
schemaVersion: dossier-v3
editorialVersion: editorial-composition-v3
```

is safer than silently changing the semantics of existing `dossier-v2` rows.

The final name/version number can be chosen in implementation, but dual-write/cutover requires a distinct persisted version identity if both generations are to coexist.

### 16.3 Minimum successor additions

In addition to current V2 identity/evaluation fields, the successor should expose enough lineage to prove which semantic plan generated it:

```text
evaluationSnapshotFingerprint
policyOutputFingerprint
editorialPlanFingerprint
```

Every proposition source/reference must remain lifetime-resolvable.

### 16.4 What the dossier still must never contain as authority

A dossier presentation remains a derived cache. It is not a canonical source of:

- role facts;
- candidate facts;
- fit relationships;
- risk classification;
- recommendation policy.

If its prose conflicts with upstream truth, the presentation is stale/invalid and should be regenerated — upstream truth should not be changed to match the prose.

---

## 17. `RecommendationRecord` and `EvaluationArtifact`: transitional compatibility shells

Although not one of the ten requested matrix rows, the reconciliation cannot be implemented safely without classifying these two bridge objects.

### 17.1 `RecommendationRecord`

The record currently bundles:

- intrinsic score;
- final policy verb;
- veto state;
- policy rule IDs;
- decision drivers/risks;
- free-form differentiator/upside strings;
- evidence mapping;
- confidence;
- trace/pipeline;
- diligence state.

That made sense as the old engine public contract, but it spans Evaluation and Policy ownership in the target design.

**Classification:** `TRANSITIONAL_COMPATIBILITY_CONTRACT`

Do not delete it first. Instead create EvaluationSnapshot + DecisionPolicyOutput from the same execution, prove parity, then adapt downstream compatibility consumers.

### 17.2 `EvaluationArtifact`

The current intrinsic path still packages:

```text
record
opportunity/presented object
jobProjection
```

The presence of `opportunity` is exactly why the editorial builder can reach backward into presentation-shaped state.

**Classification:** `TRANSITIONAL_EXECUTION_BUNDLE`

It may remain internal during migration, but it must stop being the canonical input to editorial materialization.

---

## 18. Exact semantic ownership of score, confidence and verdict

This distinction is important enough to state explicitly.

### 18.1 Intrinsic quality score

The live implementation labels `QualityScoreCalculator` as the authoritative Model C intrinsic quality score calculator. The policy engine calculates it before applying verdict gates, and returned verdicts carry the same scalar.

Therefore:

```text
EvaluationSnapshot owns qualityScore.
DecisionPolicy consumes qualityScore.
DecisionPolicy does not own the meaning of qualityScore.
```

The initial vNext migration should preserve the existing formula exactly.

### 18.2 Evidence completeness

Evidence completeness is not the same as fit.

A role can appear high fit on known facts while one critical requirement remains unknown. vNext therefore needs a separate completeness state/metric rather than encoding all uncertainty into the score.

### 18.3 Decision confidence

Decision confidence is not the same as score or completeness.

It should be derived from assessment confidence, evidence coverage and stability, then persisted by EvaluationSnapshot.

### 18.4 Final recommendation

The final:

```text
PURSUE | CONSIDER | PASS
```

belongs to deterministic DecisionPolicy.

This preserves the current architectural direction while making the ownership explicit and auditable.

---

## 19. Unavailable vs evaluated-PASS must remain explicit

Current compatibility code sometimes carries a policy verb alongside a null quality score during early exclusion/failure paths, while canonical v4.3 correctly refuses to materialize an evaluated recommendation without a finite 0–100 score.

The target contract should make this boundary explicit rather than infer it from whichever field happens to be populated:

```text
Evaluation state decides whether a canonical evaluation exists.
Policy verdict exists only for a valid policy-decision input.
Unavailable / not-evaluable is not a synonym for PASS.
PASS is not a fallback for missing evidence.
```

This should become a proving test in the EvaluationSnapshot/Policy migration.

---

## 20. Persistence topology for vNext

The target does not require embedding every blob inside every dossier.

A minimal durable topology is:

```text
opportunity_versions
  └─ exact role source snapshot

role_intelligence_snapshots / role_propositions
  └─ immutable role facts keyed to opportunityVersion/contentHash

candidate document versions
  └─ immutable source text/hash

candidate_proof_snapshots / candidate_proof_claims
  └─ immutable candidate facts

candidate profile projection
  └─ exact profileVersion used by evaluator

role_candidate_evidence_graphs
  └─ exact role/candidate source refs + typed relationship IDs

evaluation snapshots
  └─ policy-independent assessments, risks, unknowns, quality/confidence

decision policy outputs
  └─ verdict, rule reasons, hinges, pursuit strategy

canonical evaluation payload/materialized_evaluations
  └─ atomic evaluation identity + compatibility read scalars + refs/snapshots

editorial plans
  └─ optional persisted explanation plan / lineage

materialized_dossier_presentations
  └─ derived, versioned prose/proposition artifact
```

Physical table names are intentionally not mandated here. The ownership and resolution invariants are.

---

## 21. Historical compatibility rules

### 21.1 v4.3

Historical v4.3 remains valid as v4.3.

Do not synthesize missing EvidenceGraph/EvaluationSnapshot/Policy detail from its score or prose.

Where v4.3 has a valid `decisionTrace`, expose only what that trace actually contains.

### 21.2 V1 dossier

V1 remains compatibility-only until every reachable row is classified and cut over.

### 21.3 V2 dossier

Existing V2 remains a valid persisted derivative of its source evaluation.

Do not reinterpret V2's compositional IDs as new canonical semantic entity IDs.

### 21.4 Missing vNext detail

For historical records that cannot be safely rematerialized:

```text
serve historical canonical truth as historical truth
or
serve explicit unavailable/minimal-evaluation behavior
```

Never invent vNext detail at read time.

---

## 22. Smallest safe ordered implementation sequence

The following sequence is deliberately ordered so that each batch creates the durable authority required by the next one.

### Gate 1B — Implementation Batch 01: Source/provenance immutability

**Goal:** make every future canonical evidence ID lifetime-resolvable before creating richer semantic contracts.

Work:

1. make candidate document content immutable/versioned;
2. add explicit tests that referenced `opportunity_versions` content cannot be silently rewritten under the same version identity;
3. introduce resolver contracts for exact role/candidate source snapshots;
4. preserve all existing evaluation/serving behavior.

Do **not** change scoring, policy, editorial output or UI.

**Exit gate:**

```text
same evidence ID / source snapshot ref
→ same exact source text for lifetime
```

and no current canonical decision changes.

---

### Gate 1B — Implementation Batch 02: Canonical RoleIntelligence + CandidateProof persistence

**Goal:** productionize the already-proven extraction contracts as immutable source-fact registries.

Work:

1. bind RoleIntelligence identity to exact canonical opportunity version/content hash;
2. persist versioned RoleIntelligence snapshots/propositions;
3. persist CandidateProof snapshots against immutable document versions;
4. provide exact evidence resolvers;
5. initially leave `JobProjection` / `CandidateProjection` scoring behavior unchanged.

**Exit gate:**

- 100% accepted role propositions source-resolve exactly;
- 100% accepted candidate proof claims source-resolve exactly;
- candidate-independent RoleIntelligence proven by API/type boundary;
- no score/verdict drift.

---

### Gate 1B — Implementation Batch 03: Typed persistent EvidenceGraph shadow path

**Goal:** establish the canonical relationship owner without disturbing policy or presentation.

Work:

1. build EvidenceGraph from canonical RoleIntelligence + CandidateProof/evaluator candidate snapshot;
2. assign stable relationship IDs;
3. implement the six-state relationship vocabulary;
4. shadow-write graph beside current evaluator mappings;
5. compare with current capability matching but do not force false parity where current mapping is only `MATCH`.

**Exit gate:**

- every graph edge resolves durable endpoint evidence;
- no source-free `DIRECT/ADJACENT/TRANSFERABLE/CONTRADICTED` edge;
- `UNSUPPORTED` vs `UNKNOWN` tests;
- graph construction does not consume verdict/policy output;
- graph is candidate-specific and role-version-specific.

---

### Gate 1B — Implementation Batch 04: EvaluationSnapshot successor

**Goal:** persist policy-independent assessment truth and uncertainty.

Work:

1. move/encapsulate intrinsic quality score ownership in EvaluationSnapshot while preserving the current Model C calculation exactly;
2. materialize stable assessment, risk, strength, constraint and unknown IDs;
3. bind every material assessment where possible to EvidenceGraph relationships/evidence;
4. persist separate evidence-completeness and decision-confidence semantics;
5. keep current `RecommendationRecord` as compatibility output during dual-run.

**Exit gate:**

- score parity with current `QualityScoreCalculator` on the frozen/current harness;
- no policy verb required to construct EvaluationSnapshot;
- missing evidence cannot become PASS;
- risk/driver IDs stable under presentation reorder/rewording;
- exact context/profile/role identity preserved.

---

### Gate 1B — Implementation Batch 05: Deterministic DecisionPolicyOutput + pursuit strategy

**Goal:** make final recommendation semantics an explicit versioned policy artifact.

Work:

1. refactor DecisionPolicy to consume EvaluationSnapshot rather than constructing upstream assessment semantics;
2. persist verdict + triggered rule IDs + structured reasons;
3. persist genuine decision hinges/counterfactual consequences;
4. persist structured pursuit strategy: effort, action code, diligence, stop conditions, positioning directives;
5. preserve current verdict behavior unless a separately-approved defect correction is proven.

**Exit gate:**

- golden verdict parity across current evaluated corpus;
- changing editorial wording cannot affect policy result;
- changing a hinge input exercises the documented counterfactual effect;
- verdict is deterministic for the same evaluation + policy + pursuit constraints;
- policy never reads presenter state.

---

### Gate 1B — Implementation Batch 06: EditorialPlan vNext + presentation-independent composition

**Goal:** remove hidden semantic authority from `artifact.opportunity` and current V2 editorial derivations.

Work:

1. introduce explicit `EditorialPlanVNext` input assembled only from canonical persisted source/evidence/evaluation/policy truth;
2. remove `EvaluationArtifact` / `artifact.opportunity` from the new builder API;
3. move functional-adjacency risk and decision-hinge semantics entirely upstream;
4. adapt composer to realize prose/propositions from structured inputs;
5. dual-write a successor dossier presentation version suitable for parity comparison.

**Exit gate:**

- no vNext editorial code imports/accepts `EvaluationArtifact` or presentation-shaped Opportunity as semantic input;
- every factual proposition resolves to canonical source evidence;
- every inference names supporting upstream refs;
- verdict/score/action are copied from canonical owners, never recomputed;
- changing/removing legacy presenter strings does not change vNext semantic content.

---

### Gate 1B — Implementation Batch 07: Backfill, serving cutover, V1 retirement

**Goal:** make the new path the only canonical path after coverage is proven.

Work:

1. inventory every reachable active V1/V2/historical state;
2. rematerialize eligible records through exact opportunityVersion + exact context + exact profileVersion pipeline;
3. do not use legacy rematerializer fallbacks that substitute static candidate data;
4. classify non-rematerializable records into explicit historical/unavailable behavior;
5. prove V2/new-version coverage through a manifest before switching reads;
6. cut serving to the successor canonical presentation;
7. remove V1 route/materializer/BriefCompositionEngine dependencies only after reachability is zero or explicitly quarantined.

**Exit gate:**

- 100% of reachable active dossier records classified;
- every newly served advisory claim comes from successor canonical artifacts;
- zero request-time advisory recomputation;
- no static/default candidate fallback;
- V1 serving branch unreachable and then removed;
- protected/user decision data unchanged.

---

## 23. Why this sequence is minimal

Several tempting shortcuts are unsafe.

### 23.1 Do not start by deleting `artifact.opportunity`

Without durable RoleIntelligence/CandidateProof/EvidenceGraph/Evaluation/Policy inputs, the missing authority would simply move into another ad hoc lookup.

### 23.2 Do not start by rewriting the dossier

The dossier is downstream. Improving prose before upstream semantic ownership is durable creates another generation of presentation-owned truth.

### 23.3 Do not build the EvidenceGraph before source IDs are durable

A graph with lifetime-unstable endpoints is not durable provenance.

### 23.4 Do not change policy and evaluation in the same unobserved cutover

Evaluation-policy separation requires parity evidence. Dual-run the new snapshots/output while preserving current decisions until the contracts are proven.

### 23.5 Do not retire V1 before backfill coverage

V1 retirement is a cutover problem, not a type-deletion problem.

---

## 24. Reuse / retire classification after Batch 06

| Component | Classification |
| --- | --- |
| canonical opportunity/job version identity | `REUSE_AS_IS` |
| acquisition ingestion lineage | `REUSE_AS_IS` |
| evaluation context / fingerprint identity | `REUSE_AS_IS` |
| exact candidate projection version resolution | `REUSE_AS_IS` |
| RoleIntelligence V1 extraction semantics | `REUSE_WITH_PRODUCTION_IDENTITY_AND_PERSISTENCE` |
| CandidateProof V1 extraction semantics | `REUSE_WITH_IMMUTABLE_SOURCE_VERSIONING_AND_PERSISTENCE` |
| JobProjection | `REUSE_AS_EVALUATOR_ADAPTER / REDUCE_SEMANTIC_OWNERSHIP` |
| CandidateProjection | `REUSE_AS_EVALUATOR_INPUT / ADD_PROOF_LINEAGE` |
| current EvidenceMatch | `TRANSITIONAL_INPUT_TO_EVIDENCE_GRAPH` |
| CanonicalDecisionTraceV1 | `HISTORICAL_COMPATIBILITY / SPLIT_FORWARD` |
| RecommendationRecord | `TRANSITIONAL_COMPATIBILITY_CONTRACT` |
| EvaluationArtifact | `TRANSITIONAL_EXECUTION_BUNDLE` |
| canonical v4.3 payload | `PRESERVE_HISTORICALLY / SUCCESSOR_FORWARD` |
| DecisionPolicy rule logic | `REUSE_WITH_OWNERSHIP_REFACTOR` |
| current free-form policy differentiator/upside strings | `RETIRE_AS_CANONICAL_API` |
| EditorialIntelligenceContract V2 pattern | `REUSE_BOUNDARY / REPLACE_SEMANTIC_CONTENT_WITH_REFS` |
| EditorialPropositionComposer | `REUSE_WITH_STRICTER_INPUT_CONTRACT` |
| CanonicalDossierPresentationV2 | `REUSE_HISTORICALLY / VERSIONED_SUCCESSOR_FOR_DUAL_WRITE` |
| SqliteDossierPresentationStore boundary | `REUSE_WITH_VERSIONED_EVOLUTION` |
| canonical dossier read validation | `REUSE_WITH_VERSIONED_EVOLUTION` |
| V1 dossier serving/materializer | `COMPATIBILITY_ONLY / RETIRE_AFTER_CUTOVER` |
| legacy EvaluationRematerializer static-profile fallback | `DO_NOT_USE_FOR_VNEXT_CUTOVER` |

---

## 25. Gate 1A architectural decisions now closed by recon

After Batches 01–06, the following questions no longer need to be rediscovered during implementation.

### 25.1 Who owns the final recommendation?

**DecisionPolicy.**

The evaluator supplies intrinsic assessment truth/score/confidence; policy owns PURSUE/CONSIDER/PASS and pursuit consequences.

### 25.2 Who owns role↔candidate relationship classification?

**EvidenceGraph.**

Extraction owns endpoints; graph owns correspondence; evaluation owns consequence.

### 25.3 Should relationship states distinguish unsupported from unknown and contradiction?

**Yes.**

The vNext graph needs:

```text
DIRECT
ADJACENT
TRANSFERABLE
UNSUPPORTED
CONTRADICTED
UNKNOWN
```

### 25.4 Is v4.3 the right place to add all new semantic detail?

**No.**

Preserve v4.3 as the proven historical contract and introduce a clean versioned successor.

### 25.5 Is `artifact.opportunity` removable by signature cleanup?

**No.**

It becomes removable only after the immutable editorial input can be assembled from canonical source/evidence/evaluation/policy artifacts.

### 25.6 Does CandidateProjection replace CandidateProof?

**No.**

CandidateProof is the source-fact registry. CandidateProjection is the evaluator-oriented interpretation pinned by `profileVersion`.

### 25.7 Does JobProjection replace RoleIntelligence?

**No.**

RoleIntelligence owns exact extracted role facts. JobProjection is an evaluator adapter/normalized interpretation.

### 25.8 Can the composer still infer prose?

**Yes, but explicitly as presentation inference.**

It may synthesize wording from supported propositions. It may not create a new risk, fit relationship, verdict, source fact or policy action.

### 25.9 Must old evaluations/dossiers be rewritten immediately?

**No.**

Historical artifacts remain valid under their historical schemas. Rematerialize only through exact inputs where safe; otherwise preserve explicit historical/minimal behavior.

### 25.10 Can V1 be retired permanently?

**Yes, after coverage/cutover proof.**

There is no target-architecture reason to preserve it indefinitely.

---

## 26. Whole-system target after reconciliation

```text
CANONICAL SOURCE PLANE

opportunity_versions
  canonicalJobId + opportunityVersion + contentHash
        │
        └────→ RoleIntelligenceSnapshot
                  exact role proposition IDs
                  requirement/source facts

immutable candidate document versions
        │
        └────→ CandidateProofSnapshot(s)
                  exact candidate proof IDs


SEMANTIC RELATIONSHIP PLANE

RoleIntelligence + CandidateProof
        ↓
EvidenceGraph
  stable edge IDs
  DIRECT / ADJACENT / TRANSFERABLE /
  UNSUPPORTED / CONTRADICTED / UNKNOWN


EVALUATION PLANE

EvidenceGraph
+ exact EvaluationRoleProjection
+ exact CandidateProjection/profileVersion
        ↓
EvaluationSnapshot
  qualityScore
  evidenceCompleteness
  decisionConfidence
  assessments
  strengths / constraints
  risks / unknowns


POLICY PLANE

EvaluationSnapshot
+ career intent / pursuit constraints
+ policyVersion
        ↓
DecisionPolicyOutput
  PURSUE / CONSIDER / PASS
  triggered rules
  reasons
  decision hinges
  pursuit strategy


EDITORIAL PLANE

Role facts
+ Candidate facts
+ EvidenceGraph
+ EvaluationSnapshot
+ DecisionPolicyOutput
        ↓
EditorialPlan
        ↓
EditorialPropositionComposer
        ↓
CanonicalDossierPresentation successor


PERSISTENCE / SERVING PLANE

canonical evaluation payload successor
+ materialized evaluation scalars
+ versioned dossier presentation
        ↓
validated serving read model
        ↓
UI rendering only
```

---

## 27. No production implementation in Batch 06

This batch changes no production code, schema, tests, data or serving behavior.

It does **not** authorize an unscoped rewrite.

It does establish an internally consistent sequence under which implementation can proceed in small gated batches:

```text
1. source/provenance immutability
2. canonical source-fact persistence
3. persistent typed EvidenceGraph
4. EvaluationSnapshot
5. DecisionPolicyOutput / pursuit strategy
6. EditorialPlan + successor dossier
7. backfill/cutover/V1 retirement
```

Each batch has a proving gate and should be committed independently.

---

## 28. Next step

Gate 1A architecture recon is now sufficiently reconciled to stop discovering the same ownership boundaries.

The next step, when explicitly authorized, is:

**Gate 1B — Implementation Batch 01: Source/provenance immutability.**

That first implementation batch should be deliberately narrow: harden immutable source versioning/resolution and add proving tests **without changing evaluation, policy, dossier content or serving behavior**.
