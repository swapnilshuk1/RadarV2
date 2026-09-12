# Gate 1A Recon — Batch 05: Immutable Editorial Input, Provenance Durability, and V1 Retirement

**Branch:** `phase5/gate1-architecture-recon`  
**Parent recon commit:** `f4e1ae73d3ccc66e816cda3c44bf3738b9cca25f`  
**Scope:** documentation/recon only — no production code changes

## 1. Purpose

Batch 04 established two migration constraints:

1. Dossier V2 has a sound persisted/read boundary, but V1 remains a reachable compatibility read surface.
2. `EditorialIntelligenceContractBuilder` still depends on `EvaluationArtifact` / `artifact.opportunity`, so removing that dependency safely requires an explicit immutable editorial source contract rather than a local signature cleanup.

Batch 05 therefore answers, from current code and schema:

1. What exact canonical role/job artifact should replace `artifact.opportunity`?
2. Which role/candidate/evaluation evidence IDs are lifetime-stable and resolvable, versus merely deterministic or compositional?
3. Does current persistence preserve enough source truth for old dossiers to remain auditable after re-extraction/re-evaluation?
4. Which V1 states require rematerialization, unavailable behavior, or permanent retention?
5. What minimum vNext input contract is required before `EditorialIntelligenceContractBuilder` can become presentation-independent?

This batch does **not** define the final names of future public contracts and does not authorize production implementation. It narrows the authoritative ownership boundaries and the required migration prerequisites.

## 2. Files inspected

The inspection included the current branch versions of:

```text
src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder.ts
src/lib/intelligence/editorial/EditorialIntelligenceContract.ts
src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer.ts
src/lib/domain/dossier_presentation.ts
src/lib/domain/evaluation_payloads.ts
src/lib/intelligence/evaluation/PayloadMapper.ts
src/lib/domain/job_projection.ts
src/lib/domain/candidate_projection.ts
src/lib/intelligence/builders/JobProjectionBuilder.ts
src/lib/intelligence/extraction/RoleIntelligenceExtractorV1.ts
src/lib/intelligence/extraction/CandidateProofExtractorV1.ts
src/domain/evidence.ts
src/lib/intelligence/EvaluationWorker.ts
src/lib/intelligence/rematerialization/EvaluationRematerializer.ts
src/data/sqlite/repositories/SqliteDossierPresentationStore.ts
src/data/sqlite/repositories/SqliteOpportunityQueries.ts
src/data/sqlite/repositories/SqliteEvaluationContextStore.ts
src/data/sqlite/repositories/profile-projection-version.ts
src/data/sqlite/repositories/SqliteDocumentStore.ts
src/data/sqlite/repositories/SqliteIntelligenceStore.ts
src/lib/intelligence/knowledge/model.ts
src/lib/intelligence/knowledge/documents.ts
src/data/sqlite/migrations/010_candidate_documents_and_evidence.sql
src/data/sqlite/migrations/011_document_contents_and_intent.sql
src/data/sqlite/migrations/020_canonical_acquisition.sql
src/data/sqlite/migrations/033_opportunity_version_source_payload.sql
src/data/sqlite/migrations/034_acquisition_ingestion_lineage.sql
src/data/sqlite/migrations/038_opportunity_version_category_projection.sql
src/data/sqlite/migrations/044_materialized_dossier_presentations.sql
src/data/sqlite/migrations/045_intelligence_knowledge.sql
src/routes/opportunity.$jobHash.tsx
```

The inspection is against the actual `phase5/gate1-architecture-recon` branch, not the default-branch search index.

---

## 3. Executive conclusion

There is **no single existing object that can safely replace `artifact.opportunity`**.

The correct replacement is a small set of immutable, independently versioned inputs assembled from already-strong canonical identities plus richer durable reasoning artifacts:

```text
Role source snapshot / RoleIntelligence
+ Candidate proof snapshot
+ Role↔Candidate evidence relationships
+ Evaluation snapshot
+ Decision/pursuit policy output
        ↓
EditorialIntelligenceContract vNext
        ↓
EditorialPropositionComposer
        ↓
Canonical persisted dossier presentation
```

The strongest currently-existing role source identity is:

```text
canonicalJobId + opportunityVersion
```

backed by the exact `opportunity_versions` row. That row retains `raw_content`, a `content_hash`, canonical title/company/location metadata, and optional source-payload lineage. The current worker already pins every evaluation job to this exact pair before it evaluates or extracts presentation evidence.

However, **`opportunity_versions` is the source snapshot, not the finished semantic role contract**. The target editorial boundary should consume a canonical RoleIntelligence snapshot derived from that exact version, not reopen `raw_content` itself.

Similarly, the exact candidate evaluation input is already strongly pinned by the content-addressed `profileVersion`, but the editorial layer still depends on candidate-projection structures whose evidence IDs are not uniformly first-class, lifetime-resolvable proof identities.

The result is a clear migration principle:

> **Preserve the existing immutable identities; replace transient semantic joins with persisted, resolvable evidence and reasoning contracts.**

---

## 4. What should replace `artifact.opportunity`?

### 4.1 The source-of-source truth is `opportunity_versions`

Migration `020_canonical_acquisition.sql` makes `opportunity_versions` the immutable content-version identity beneath a canonical opportunity. It contains:

```text
id                  = opportunityVersion
canonical_job_id    = canonicalJobId
content_hash
job_title
company_name
location
employment_type
raw_content
created_at
```

and enforces uniqueness over:

```text
(canonical_job_id, content_hash)
(canonical_job_id, id)
```

Migration 033 adds:

```text
source_payload_key
source_media_type
document_extraction_state
```

while migration 034 records append-only acquisition lineage from source-card capture to the exact canonical job/version/content hash.

The worker then loads the exact row by:

```text
WHERE canonical_job_id = ? AND id = ?
```

using the identity already leased in the evaluation job.

This is the correct immutable source anchor.

### 4.2 But the editorial builder must not read `raw_content`

The current worker performs an important separation already:

```text
exact opportunity_versions.raw_content
        ↓
JobProjectionBuilder.extractPresentationEvidenceForPresentation(...)
        ↓
roleWorkEvidence + presentationQualificationEvidence
        ↓
EditorialIntelligenceContractBuilder
```

The builder's `EditorialIntelligenceContractOptions` explicitly says the builder never reads or reconstructs raw opportunity source itself.

That boundary should be strengthened, not reversed.

The future builder should therefore receive a canonical semantic role snapshot whose identity is bound to the exact `opportunityVersion`, with exact source evidence already extracted and verified upstream.

### 4.3 `JobProjection` is not the final replacement either

`JobProjection` contains useful grounded fields and exact source evidence, but Batch 02 already established that it also contains semantic heuristics and current-generation classification behavior.

It is therefore useful input/prior art, not the final owner of all role truth.

The future role-side editorial input should conceptually contain:

```text
RoleEditorialInput
  canonicalJobId
  opportunityVersion
  sourceContentHash
  canonical title/company/location/category metadata
  roleIntelligenceVersion / fingerprint
  role proposition registry
  qualification registry
  source-backed role evidence IDs
  source snapshot locator
```

The exact public type name should be chosen only during contract reconciliation.

### 4.4 Direct mapping of current `artifact.opportunity` reads

The current builder still reads these presentation-shaped values:

| Current read | Correct future owner |
| --- | --- |
| `opportunity.role` / `company` | canonical role source snapshot metadata |
| `opportunity.whyNow` | evaluation / pursuit-strategy reasoning, not a source fact |
| `recommendationResult.capabilityFit.matchedCapabilities` | evidence graph + capability assessment |
| `engineRecommendation.relativeDifferentiator` / `trajectoryUpside` | career-value assessment |
| `opportunity.primaryDriver` | evaluation driver |
| `opportunity.primaryRisk` / `hiringRisk` | evaluation risk |
| `opportunity.recommendedAction` | decision policy / pursuit strategy |
| `opportunity.positioning` | structured pursuit strategy, then editorial wording |
| fallback verdict/quality score in `engineRecommendation` | canonical evaluation only |

Moving these strings into a differently named DTO without changing ownership would preserve the same architectural defect.

---

## 5. Role evidence identity audit

### 5.1 Extraction V1 role atoms — strong local source identity

`RoleIntelligenceExtractorV1` defines role proposition IDs as:

```text
role_atom:<caseId>:<startOffset>_<endOffset>:<semanticType>
```

and enforces exact source spans.

This is the correct *shape* of a durable source fact identity: source identity + exact location + semantic type.

But `caseId` is a benchmark/extractor identity, not yet the production canonical `opportunityVersion` contract. For production, role proposition identity should bind directly to the immutable canonical opportunity version/source hash.

**Classification:** `REUSE_IDEA / EVOLVE_IDENTITY_SCOPE`

### 5.2 `rolework_*` and `qualification_*` — deterministic and version-bound, but not stored as a registry

`JobProjectionBuilder` currently creates presentation evidence IDs using:

```text
rolework_<sha256(version + normalized statement + occurrence ordinal)>
qualification_<sha256(version + normalized statement + occurrence ordinal)>
```

This has several good properties:

- it includes `opportunityVersion`;
- identity is derived from the canonical source occurrence rather than extraction-admission order;
- changing classifier admission does not renumber unrelated atoms;
- identical text occurrences are disambiguated by source occurrence ordinal.

These IDs are **deterministically reconstructible** from the pinned source snapshot.

They are not, however, independently **resolvable** after persistence because there is no canonical role-evidence table/registry keyed by those IDs. The V2 dossier persists the IDs and rendered proposition text, but not the complete evidence registry.

Therefore:

```text
stable identity?          YES, within the immutable opportunity version
persisted registry?       NO
read-time resolver?       NO
reconstructible?          YES, by replaying the presentation extractor
acceptable final state?   NO
```

Replaying extraction to explain a historical dossier would couple auditability to future extractor behavior. The final contract should resolve an ID against stored source evidence without requiring semantic re-extraction.

**Classification:** `REUSE_TRANSITIONALLY / PERSIST_REGISTRY_OR_FOLD_INTO_ROLE_INTELLIGENCE`

### 5.3 `jobcap_*` — source-backed but not version-scoped enough

The current capability evidence identity hashes:

```text
jobHash + normalized capability + normalized source quote
```

It does **not** include `opportunityVersion`.

That makes it useful evaluator provenance today, but weaker than the canonical opportunity-version identity because two content versions can legitimately share the same job hash and quote.

It cannot be the final lifetime role-evidence key.

**Classification:** `REPLACE_AS_CANONICAL_EVIDENCE_ID / KEEP_COMPATIBILITY_ONLY`

### 5.4 `capreq_*` — even weaker as a global provenance ID

Capability requirement evidence currently derives an ID from:

```text
capability + source quote
```

without job identity or opportunity version.

This is not globally addressable provenance and must not become a vNext canonical evidence identity.

**Classification:** `REPLACE_AS_CANONICAL_EVIDENCE_ID`

---

## 6. Candidate evidence identity audit

### 6.1 CandidateProof V1 has a strong source-addressing scheme

`CandidateProofExtractorV1` uses source-document and offset-based identities:

```text
claim:<sourceDocumentId>:<startOffset>_<endOffset>:<proofType>
bullet:<positionId>:<startOffset>_<endOffset>
pos:<sourceDocumentId>:<employer>:<startOffset>
```

It verifies exact source slicing before accepting a claim.

This is close to the durable production identity model we need.

### 6.2 Candidate source persistence is not yet fully immutable

The schema stores:

```text
candidate_documents.document_hash
document_contents.raw_text
document_contents.text_hash
evidence_graphs.document_id
extractor_version
prompt_version
model
```

and `EvidenceGraph` explicitly describes its extraction provenance as immutable.

However, `SqliteDocumentStore.saveDocumentContent()` currently performs:

```sql
ON CONFLICT(document_id) DO UPDATE SET
  raw_text = excluded.raw_text,
  text_hash = excluded.text_hash
```

That means the same `documentId` can point to different text over time.

Because CandidateProof IDs are based on `sourceDocumentId + offsets`, a content rewrite under the same `documentId` could make an old evidence ID resolve to different text.

This is a genuine provenance-durability defect.

The vNext invariant should be one of:

```text
A. document_contents is immutable once written; changed text creates a new document/version identity
```

or

```text
B. every candidate evidence ID includes an immutable content/version hash and resolver uses that exact version
```

The first option fits the current architecture more naturally.

**Classification:**

```text
CandidateProof identity shape          REUSE_WITH_NEW_SOURCE_VERSION_INVARIANT
candidate_documents metadata           REUSE
EvidenceGraph extraction metadata       REUSE
SqliteDocumentStore.saveDocumentContent REFACTOR_TO_IMMUTABLE_OR_VERSIONED
```

### 6.3 Candidate projection versioning itself is strong

`versionCandidateProjection()` / `deriveCandidateProjectionVersion()` content-address the complete projection, excluding only the version field itself.

`resolveExactCandidateProjectionForScope()`:

- verifies tenant/person scope;
- searches stored profile rows;
- requires exact `profileVersion` equality;
- rejects ambiguous same-version/different-content rows;
- has no "latest" fallback.

That is exactly the kind of identity discipline the vNext candidate input should preserve.

**Classification:** `REUSE_AS_IS`

### 6.4 Projection semantic fallback IDs are deterministic but not first-class proof IDs

Where candidate semantic evidence lacks `metadata.sourceId`, the editorial/evaluator path uses:

```text
candidate-projection:<profileVersion>:semantic:<index>
```

This correctly pins the exact projection version, but it is still an array-position identity. There is no first-class resolver contract for it outside deserializing that exact projection.

This is an acceptable migration reference but not the preferred final CandidateProof identity.

**Classification:** `TRANSITIONAL_ONLY`

---

## 7. Evaluation and editorial IDs: persisted truth vs compositional aliases

### 7.1 Canonical v4.3 evaluation identity is strong

The canonical evaluation persists:

```text
canonicalJobId
opportunityVersion
contextFingerprint
profileVersion
policyVersion
ontologyVersion / ontologyFingerprint
evaluationInputHash
```

and serving requires exact fingerprint parity.

This boundary should survive vNext.

### 7.2 Current canonical decision trace references evidence but does not own a resolvable graph

`CanonicalDecisionTraceV1` persists role/candidate evidence IDs, but Batch 01/02 already established that relationships are currently collapsed too aggressively and component evidence IDs may be empty.

Batch 05 adds another distinction:

> Persisting an evidence ID is not equivalent to persisting a resolver for that evidence ID.

The trace can therefore preserve exact references while the presentation audit path still cannot resolve every reference independently.

### 7.3 `canonical:*` IDs in the editorial builder are compositional aliases, not durable evaluation entity IDs

The current builder creates IDs such as:

```text
canonical:verdict
canonical:score
canonical:operating-level
canonical:work-nature
canonical:decision-authority
canonical:commercial-scope
canonical:capability:<name>
canonical:dimension:<key>
canonical:principal-risk
canonical:career-tradeoff
canonical:hinge:<index>
canonical:driver:strength:<index>
canonical:trace-relationship:<index>
```

These are useful inside one editorial contract, but they are generated by the editorial builder from current object ordering and are not stable persisted entities in canonical evaluation.

They must not be mistaken for lifetime canonical IDs merely because their names begin with `canonical:`.

The vNext evaluation/graph contract should assign stable IDs to:

```text
role-candidate relationship edges
assessment findings
decision drivers
decision risks
uncertainties
decision hinges
policy reasons / strategy directives
```

The editorial contract should reference those IDs instead of manufacturing canonical-looking aliases.

**Classification:** `REPLACE_AS_CANONICAL_IDENTITY / RETAIN_ONLY_AS_INTERNAL_COMPATIBILITY_WHERE_NEEDED`

---

## 8. Source snapshot durability — what is strong and what is not

### 8.1 Role source snapshot: strong

Current role source retention is substantially adequate:

```text
opportunityVersion
content_hash
raw_content
canonicalJobId
source portal/id/url lineage
optional source_payload_key
```

The worker evaluates by exact `canonicalJobId + opportunityVersion`, and the source content used for presentation extraction comes from that same row.

Even if extraction algorithms change later, the original JD text needed to re-audit a historical evaluation remains available from the version record.

### 8.2 Candidate source snapshot: mixed

The candidate side records strong provenance metadata, but `document_contents` can be overwritten under the same document identity.

Therefore the current system can prove:

```text
which candidate projection version was evaluated
which document/evidence graph was referenced
what document hash metadata was recorded
```

but strict historical proof resolution is weaker than it should be if document text was ever rewritten in place.

### 8.3 Evaluation context: strong

Evaluation contexts and search-plan snapshots are deliberately immutable and pin:

```text
profileVersion
policyVersion
ontologyVersion
ontologyFingerprint
search plan snapshot
```

The active pointer can change; the referenced context cannot.

### 8.4 Presentation: strong identity, incomplete provenance registry

`materialized_dossier_presentations` stores one presentation per exact:

```text
tenant
person
canonicalJobId
opportunityVersion
evaluationContextFingerprint
presentationVersion
```

and records `source_evaluation_fingerprint`.

`SqliteDossierPresentationStore` validates the embedded presentation identity and evaluation fingerprint on read.

However, the row stores only `presentation_json`. `CanonicalDossierPresentationV2` contains the composition and proposition reference arrays, not the full editorial evidence registry.

So a historical dossier remains renderable, but not every proposition ref is independently dereferenceable from its persisted presentation artifact.

### 8.5 Net auditability finding

| Historical question | Current answer |
| --- | --- |
| Which exact job version was evaluated? | **Strongly preserved** |
| Is the exact JD source retained? | **Yes, via `opportunity_versions.raw_content`** |
| Which exact candidate projection was evaluated? | **Strongly preserved by `profileVersion`** |
| Is candidate source provenance recorded? | **Yes** |
| Is candidate raw text strictly immutable under its document ID? | **No** |
| Can every role/candidate evidence ID be resolved without replaying extraction? | **No** |
| Can the exact rendered V2 dossier be replayed/displayed? | **Yes** |
| Can every V2 proposition be traced all the way to stored source evidence today? | **Not reliably** |

Therefore current persistence is sufficient for serving correctness but **not yet sufficient for the target end-to-end provenance invariant**:

```text
Dossier proposition
→ editorial judgment
→ evaluation finding / graph edge
→ role/candidate evidence ID
→ immutable source span
```

---

## 9. The new intelligence knowledge store is useful prior art, not yet canonical authority

Migration 045 and `SqliteIntelligenceStore` introduce a promising content-addressed model:

```text
intelligence_sources
intelligence_source_documents
intelligence_claims
intelligence_claim_edges
```

The store explicitly rejects immutable source/claim collisions, validates source document content hashes, and can snapshot claims with resolved provenance.

This has several properties we want in the future evidence registry.

But the migration itself labels this as **additive shadow knowledge**, and the canonical evaluation/presentation path inspected in Batches 01–05 does not use it as its authoritative evidence resolver.

Therefore:

```text
knowledge model/store = useful implementation prior art
knowledge model/store ≠ automatically the new canonical RoleIntelligence/CandidateProof store
```

Contract reconciliation must decide whether to evolve this store, adapt existing extraction persistence, or create a narrower canonical evidence registry.

Do not create duplicate evidence platforms accidentally.

---

## 10. V1 retirement inventory

### 10.1 New worker output no longer creates V1

The current `EvaluationWorker`:

```text
builds canonical v4.3 evaluation
builds CanonicalDossierPresentationV2
writes materialized_evaluations
writes materialized_dossier_presentations through SqliteDossierPresentationStore
```

`buildCanonicalEvaluatedPayload()` does not construct a V1 dossier presentation.

`CanonicalEvaluatedPayloadV4_3` still *permits* an optional embedded `dossierPresentation` V1 for historical compatibility, and `SqliteOpportunityQueries.getDossier()` still attaches that V1 if it is valid and fingerprint-matched.

This means the live V1 population is bounded conceptually to historical/pre-existing payloads or other legacy writers, not normal current worker output.

### 10.2 Route precedence is already suitable for cutover

The route order is:

```text
V2 presentation
→ unavailable state
→ V1 presentation
→ minimal canonical evaluated fallback
```

Therefore once V2 coverage is complete, removing the V1 route branch does not require changing canonical evaluation truth.

### 10.3 V1 state matrix

| Current stored state | Batch 05 disposition |
| --- | --- |
| canonical evaluated v4.3 + valid V2 | **No action; V1 can be ignored/removed** |
| canonical evaluated v4.3 + embedded V1 + no V2, exact canonical inputs available | **Rematerialize V2 from canonical inputs; do not translate V1 prose into V2 truth** |
| canonical evaluated v4.3 + no V2 and role/candidate source input missing | **Serve minimal canonical evaluation / explicit presentation unavailable; do not retain V1 as authority** |
| invalid/non-canonical evaluation payload | **Existing fail-closed `INVALID`; do not salvage recommendation from V1** |
| `SPARSE_SPEC` / `NOT_EVALUABLE` with source presentation evidence | **Materialize unavailable V2 where supported** |
| acquisition pending/failed/expired | **No advisory dossier; preserve unavailable state** |
| unmaterialized active candidate | **Queue/rematerialize evaluation under exact active context** |

### 10.4 Permanent V1 retention is not required

The project is pre-production and the agreed architecture does not require old sample/legacy dossier compatibility.

Therefore no V1 presentation needs permanent retention solely for backward compatibility.

The only legitimate cutover constraint is application integrity:

```text
all currently servable active records must either
A. have a valid V2 presentation,
B. have an explicit supported unavailable V2 state, or
C. safely fall back to canonical evaluation-only serving
```

before the V1 branch is deleted.

### 10.5 Do not use the historical `EvaluationRematerializer` as the vNext cutover mechanism

The old rematerializer is itself legacy-era code. It targets `candidate_evaluations`, uses older intrinsic payload conventions, calls the old engine path, and can fall back to the static `candidateProfile` if it cannot resolve a profile.

That is incompatible with the current exact-context invariant established by Gate 1.

It should not be rehabilitated into the authoritative V1→vNext migration engine.

Instead, reuse the newer control-plane pattern:

```text
immutable evaluation context
+ exact search-plan candidate opportunityVersion
+ exact profileVersion
+ queued EvaluationWorker materialization
+ coverage manifest
+ explicit activation/cutover
```

`SqliteEvaluationContextStore.getRematerialisationManifest()` already demonstrates the correct coverage-gating pattern, although today it counts canonical evaluation coverage rather than dossier/provenance coverage.

The cutover should extend this pattern with explicit presentation/evidence coverage rather than rely on the old rematerializer.

---

## 11. Minimum vNext input required before the editorial builder can be presentation-independent

The exact public names are deferred, but the minimum semantic contract is now clear.

### 11.1 Role-side input

Must provide:

```text
canonicalJobId
opportunityVersion
source content hash
source snapshot locator
canonical title
canonical company
canonical location / relevant metadata
role-intelligence schema/extractor version
role-intelligence fingerprint or snapshot identity
role proposition registry with stable IDs
qualification registry with stable IDs
exact source spans / quotes for source-backed role facts
role-intrinsic materiality where available
```

The editorial builder must not reopen `raw_content`.

### 11.2 Candidate-side input

Must provide:

```text
personId
profileVersion
CandidateProof snapshot/version identity
source document IDs + immutable document hashes
stable candidate proof IDs
candidate proof registry / resolver
source span or exact source quote for source-backed candidate facts
```

An array-index fallback inside a projection can remain migration compatibility, but not final canonical proof identity.

### 11.3 Role-candidate evidence graph input

Must provide stable graph-edge identity plus:

```text
roleEvidenceId
candidateEvidenceIds
relationship
  DIRECT
  ADJACENT
  TRANSFERABLE
  UNSUPPORTED
  CONTRADICTED
  UNKNOWN
confidence
reason / structured relationship basis
graph version
```

The editorial builder must never redo candidate-role matching.

### 11.4 Evaluation snapshot input

At minimum:

```text
evaluation identity / fingerprint
context fingerprint
policy/ontology/profile versions
fitScore
evidenceCompleteness
decisionConfidence
identity assessment
capability assessment
career-value assessment
lifestyle/friction assessment
stable decision driver IDs
stable decision risk IDs
uncertainties
structured decision hinges
stable references to evidence graph edges / source evidence
```

Not all of these are needed for every dossier section, but they must exist before editorial planning if RADAR intends to assert them.

### 11.5 Decision / pursuit policy input

At minimum:

```text
verdict
policyVersion
triggeredRuleIds
structured policy reasons
pursuit posture
recommended action
effort level / tailoring depth / networking intensity where applicable
dependencies / stop conditions / required diligence
priority positioning directives
structured hinge consequences
```

The editorial layer may phrase these outputs; it should not create them.

### 11.6 Provenance registry available to the persisted plan/presentation

The current V2 presentation retains reference IDs but not the complete resolver registry.

vNext needs one of two durable patterns:

```text
A. Persist the editorial plan with a normalized provenance registry
```

or

```text
B. Persist only stable IDs, but guarantee a canonical evidence/graph/evaluation resolver whose referenced rows are immutable for the lifetime of the dossier
```

Pattern B avoids duplicating large evidence blobs and is preferable if resolver durability can be guaranteed.

---

## 12. Semantic work that must move out of `EditorialIntelligenceContractBuilder`

Batch 03 found that the V2 editorial architecture is structurally useful. Batch 05 now identifies the exact remaining semantic leaks.

### Must move upstream

```text
deriveFunctionalAdjacencyRisk(...)
```

This is evaluation work: it compares role work with candidate evidence and creates a capability-risk conclusion.

```text
decisionHinges(...)
```

The builder currently invents decision questions from role outcomes, qualifications, principal risk, and career tradeoff. Since a hinge represents "what could change the decision", the underlying hinge must be evaluation/policy output. The composer may reword it, but the semantic hinge should not originate in presentation.

The same applies to current opportunity-derived:

```text
primaryDriver
primaryRisk
hiringRisk
recommendedAction
matchedCapabilities
careerTradeoff
trajectoryUpside
```

### May remain editorial expression

`buildGroundedCareerCase(...)` may continue to produce prose **only if** the underlying career-value judgment/tradeoff and selected role evidence are already authoritative upstream.

`buildGroundedPositioningAngles(...)` may continue to word/assemble positioning **only if** the pursuit strategy has already selected the valid positioning themes and evidence dependencies.

The distinction is:

```text
selecting what is true / important / decision-changing → upstream intelligence
expressing the selected truth clearly                 → editorial composition
```

---

## 13. Provenance durability invariants required for implementation

Before implementation is considered complete, the following should become testable invariants.

### Role evidence invariant

For every persisted role evidence ID:

```text
resolve(id)
→ exact canonicalJobId/opportunityVersion
→ immutable source content hash
→ exact source span/quote
```

No semantic extractor replay is required merely to resolve the source.

### Candidate evidence invariant

For every persisted candidate proof ID:

```text
resolve(id)
→ immutable candidate source document version/hash
→ exact source span/quote
```

Re-uploading or reprocessing a CV may create a new source version; it may not mutate the meaning of an existing proof ID.

### Graph invariant

Every graph edge resolves both sides and has a stable graph/edge identity.

### Evaluation invariant

Every driver/risk/uncertainty/hinge referenced by a dossier is an actual persisted evaluation/policy entity, not an index-created editorial alias.

### Presentation invariant

A dossier can be audited after newer extraction/evaluation versions are deployed without recomputing historical semantic truth under the newer algorithms.

That means historical audit uses the **historical stored evidence/reasoning snapshot**, not "rerun latest code and hope it produces the same result."

---

## 14. Reuse / refactor / retirement classification — Batch 05

| Component | Classification | Reason |
| --- | --- | --- |
| `canonicalJobId + opportunityVersion` identity | `REUSE_AS_IS` | Correct immutable role-source lineage. |
| `opportunity_versions.raw_content/content_hash` | `REUSE_AS_SOURCE_SNAPSHOT` | Strong exact source retention; semantic consumers should sit downstream. |
| acquisition source-payload + ingestion lineage | `REUSE_AS_IS` | Valuable source provenance and audit trail. |
| RoleIntelligence V1 exact-span ID idea | `REUSE_WITH_PRODUCTION_ID_EVOLUTION` | Correct exact-span provenance shape; bind production IDs to canonical opportunity version. |
| `rolework_*` / `qualification_*` IDs | `REUSE_TRANSITIONALLY` | Deterministic/version-bound but lack a persisted resolver registry. |
| `jobcap_*` / `capreq_*` as canonical IDs | `REPLACE` | Not sufficiently opportunity-version scoped/addressable. |
| CandidateProof V1 IDs | `REUSE_WITH_SOURCE_IMMUTABILITY` | Strong document+offset identity once document content cannot mutate in place. |
| `document_contents` update-in-place behavior | `REFACTOR_SUBSTANTIALLY` | Breaks lifetime evidence-ID semantics. |
| content-addressed `profileVersion` + exact resolver | `REUSE_AS_IS` | Strong exact candidate evaluation identity. |
| `candidate-projection:<profileVersion>:semantic:<index>` | `TRANSITIONAL_ONLY` | Deterministic but array-position based and not first-class proof identity. |
| canonical v4.3 identity/fingerprint fields | `REUSE_IN_SUCCESSOR` | Strong provenance boundary; semantic payload is too narrow. |
| `CanonicalDecisionTraceV1` | `REPLACE/EVOLVE_SUBSTANTIALLY` | Useful references but not the future graph; relationships/driver evidence are too lossy. |
| builder-created `canonical:*` IDs | `REPLACE_AS_CANONICAL_IDENTITY` | Compositional aliases, not durable evaluation entities. |
| `SqliteIntelligenceStore` / knowledge model | `REUSE_AS_PRIOR_ART / RECONCILE` | Strong immutable source/claim ideas, but currently shadow and not canonical serving truth. |
| `SqliteDossierPresentationStore` | `REUSE_WITH_VERSIONED_EVOLUTION` | Strong identity/fingerprint persistence boundary. |
| `SqliteEvaluationContextStore` rematerialization coverage pattern | `REUSE_AND_EXTEND` | Correct control-plane cutover model; add presentation/provenance coverage. |
| historical `EvaluationRematerializer` | `REMOVE_FROM_TARGET_CUTOVER_PATH` | Legacy candidate/static fallback and older payload assumptions violate current exact-context rules. |
| V1 embedded presentation support | `RETIRE` | Historical compatibility only; current worker does not need it. |
| V1 route branch | `RETIRE_AFTER_COVERAGE_GATE` | Safe to remove after active-state V2/evaluation fallback coverage is proven. |
| `artifact.opportunity` editorial authority | `RETIRE` | Carries presentation-derived semantic decisions that belong to canonical upstream owners. |

---

## 15. Direct answers to the five Batch 05 questions

### 15.1 What exact canonical role/job artifact should replace `artifact.opportunity`?

**No single current artifact is sufficient.**

The immutable source anchor should be the exact `opportunity_versions` identity `(canonicalJobId, opportunityVersion, contentHash)`, but the editorial builder should consume a **versioned canonical RoleIntelligence/editorial-role snapshot derived from that source**, not the raw row itself.

Title/company/location/source metadata can come directly from the canonical version identity. Responsibilities, requirements and other semantic role propositions should come from the canonical RoleIntelligence/evidence registry.

### 15.2 Which evidence IDs are already lifetime-stable/resolvable?

**Strong / close to target:**

- candidate CandidateProof IDs, provided source document content becomes immutable;
- content-addressed candidate `profileVersion`;
- role `rolework_*` / `qualification_*` IDs are deterministic and opportunity-version-bound.

**But not fully resolver-complete:**

- rolework/qualification IDs are not stored in an independent canonical evidence registry;
- candidate projection semantic index IDs require the exact projection object;
- `jobcap_*` / `capreq_*` are not strong enough as global versioned provenance;
- editorial `canonical:*` IDs are compositional aliases, not canonical persisted entities.

Therefore the system does **not yet have one lifetime-resolvable evidence namespace spanning role → candidate → graph → evaluation → dossier**.

### 15.3 Does current schema preserve source snapshots strongly enough for historical audit?

**Role source: yes, substantially.**

**Candidate source: not strictly enough.** Candidate document text can currently be updated in place under the same `documentId`.

**Dossier refs: not fully.** The rendered V2 presentation is durable, but all referenced semantic/evidence IDs are not independently resolvable from persisted canonical registries.

So historical serving is strong; complete historical explanation provenance is not yet strong enough.

### 15.4 Which V1 rows/states require backfill/rematerialization/permanent retention?

No V1 state requires permanent retention for product compatibility.

- valid evaluated records with exact canonical inputs should rematerialize V2;
- unsupported/unavailable records should remain explicitly unavailable or evaluation-only;
- invalid/noncanonical records should remain fail-closed and should not be salvaged from V1 prose;
- new/unmaterialized active records should go through the current exact-context worker;
- V1 should be removed after an explicit coverage gate proves every active record has a safe non-V1 serving outcome.

### 15.5 What exact vNext contract fields are required before the builder can become presentation-independent?

At minimum:

```text
Role input
  exact canonical role/source identity
  role intelligence snapshot/version
  stable role evidence registry

Candidate input
  exact profile/proof snapshot identity
  immutable candidate source refs
  stable candidate proof registry

Evidence graph
  stable edge IDs
  typed relationships
  role/candidate evidence refs

Evaluation
  exact evaluation identity
  assessments
  fit/evidence-completeness/decision-confidence
  stable drivers/risks/uncertainties/hinges

Policy / pursuit strategy
  verdict
  triggered rules
  recommended action
  structured pursuit posture
  dependencies/stop conditions
  structured hinge effects
```

Only after those inputs exist can the editorial contract become a pure reviewed-explanation plan rather than a transitional intelligence layer.

---

## 16. Target boundary after Batches 01–05

The architecture is now specific enough to state the intended runtime boundary:

```text
Immutable opportunity version
  + persisted RoleIntelligence snapshot
        ↓
Immutable candidate source version(s)
  + persisted CandidateProof snapshot
        ↓
Persisted RoleCandidateEvidenceGraph
        ↓
Persisted EvaluationSnapshot
        ↓
Versioned DecisionPolicy / PursuitStrategy
        ↓
EditorialIntelligenceContract vNext
        ↓
EditorialPropositionComposer
        ↓
Canonical dossier presentation
        ↓
Presentation store
        ↓
Serving validation
        ↓
UI
```

The dossier path should never need:

```text
present(...)
legacy Opportunity presenter state
raw JD reinterpretation
raw resume reinterpretation
browser-side candidate matching
historical V1 prose as semantic input
```

to reconstruct intelligence.

---

## 17. No implementation authorization in this batch

This batch does **not** authorize:

- changing `document_contents` yet;
- introducing a new DB evidence table yet;
- deleting `artifact.opportunity` yet;
- deleting V1 route/rendering yet;
- changing canonical v4.3 yet;
- renaming `EditorialIntelligenceContract` yet;
- replacing Extraction V1 yet;
- adopting the shadow intelligence store as canonical by default;
- rematerializing sample data yet;
- changing production code.

The recon is now sufficient to reconcile the authoritative contracts and produce a controlled implementation sequence.

## 18. Next small batch

**Gate 1A — Batch 06: authoritative contract reconciliation + exact implementation sequence**

Batch 06 should map each current authoritative type into the target ownership model and produce the implementation dependency graph, including:

```text
current type / store
→ semantics worth preserving
→ semantics that must move owners
→ vNext contract field
→ persistence requirement
→ migration dependency
→ tests / gate proving safe cutover
```

It should specifically reconcile:

```text
opportunity_versions / role source snapshot
RoleIntelligenceExtractorV1 output
JobProjection source-evidence types
CandidateProofExtractorV1 output
CandidateProjection
CanonicalDecisionTraceV1
canonical v4.3 evaluation
DecisionPolicy output
EditorialIntelligenceContract v2
CanonicalDossierPresentationV2
```

and then define the smallest ordered production implementation batches.

That is the point after which Gate 1 implementation can begin without creating a second parallel intelligence architecture.