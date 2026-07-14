# ADR 001: RADAR Canonical Knowledge Model

**Status:** Accepted  
**Date:** July 15, 2026  

## Context
RADAR is transitioning from a stateless scraper pipeline (reliant on flat files and local storage) into a true Executive Intelligence Platform. This requires a robust, queryable, and immutable Knowledge Graph that separates objective global data from subjective personal intelligence.

## Architectural Principles

These rules are non-negotiable invariants for all future development:

1. **RADAR never stores conclusions without preserving the reasoning chain that produced them.**
2. **Global knowledge is immutable:** Never personalize it.
3. **Personal intelligence is reproducible:** Given the same person, opportunity, model, and prompt, RADAR generates the exact same recommendation.
4. **Every recommendation must be explainable:** Never skip levels in the reasoning chain: `Recommendation → Assessment → Match → Claim → Fact → Evidence → Document → Source`.
5. **Every entity has a stable ID:** Never identify things by URL or name.
6. **Every derived object carries provenance:** Store the `Provenance` struct (schema, model, prompt, extractor version, timestamp).
7. **Nothing is overwritten. Everything is superseded:** Facts and Recommendations are Immutable. Claims are Versioned. Outcomes and Runs are Append-only.
8. **Engineering Boundary:** Repositories persist entities. Services orchestrate workflows. The Reasoning Engine derives intelligence. The UI never contains business logic.

---

## The Knowledge Graph Schema

### 1. Global Layer (Owned by the System)
These entities represent objective reality and system-level interpretations.

* **Source**: The origin of the intelligence (e.g., LinkedIn, Indeed, Company Careers, News).
* **Company**: Shared intelligence about the employer.
* **Opportunity**: The canonical job role.
  * *Identity Strategy*: Merged via fingerprint of `Company + Canonical Title + Location + Employment Type + Posting Window`.
  * *Lifecycle*: `Discovered → Normalized → Verified → Archived`
* **Document**: The specific payload from a Source (HTML, cleaned text, PDF).
  * *Lifecycle*: `Captured → Parsed → Validated → Superseded`
* **Evidence**: Raw extracted texts and quotes grounded in a specific Document.
* **Fact**: Objective observations tied to Evidence. Immutable.
* **Claim**: Subjective interpretations of Facts (e.g., "This is a heavy commercial role"). Versioned.
* **Signal (Future)**: Temporal intelligence (e.g., "Hiring Spike"). Reserved for Sprint 3.

### 2. User-Scoped Layer (Owned by the Person)
These entities represent intelligence relative to a specific person.

* **Person**: The individual candidate, coach, or recruiter.
* **CareerProfile**: Structured career history and skills.
* **ResumeVersion**: Variations of a CareerProfile (e.g., Board CV, Consulting CV).
* **PreferenceProfile**: Career preferences (remote, travel, comp, industry).
* **Match**: Structured multidimensional vector (Capability, Career Growth, Leadership Scope, Compensation, Industry Alignment, Location Fit, Lifestyle, Confidence).
* **Assessment**: Structured intelligence derived from Match.
* **Recommendation**: Narrative presentation generated from an Assessment (Summary, Reasons, Risks).
  * *Lifecycle*: `Generated → Presented → Acknowledged → Superseded`
* **Decision**: Actions (Pursue, Consider, Pass) taken by a Person, including the Reason.
  * *Lifecycle*: `Draft → Confirmed → Closed`
* **Outcome**: The final real-world result (e.g., "Rejected after interview") including `OutcomeSource`. Append-only.

---

## Domain Events

Every important action emits an event. Future capabilities (Analytics, Notifications, Planner, Memory) subscribe to events, not tables.

**Events:**
- `OpportunityDiscovered`
- `DocumentCaptured`
- `FactExtracted`
- `ClaimGenerated`
- `MatchComputed`
- `AssessmentGenerated`
- `RecommendationGenerated`
- `DecisionRecorded`
- `OutcomeRecorded`

---

## Explain Endpoint API
The defining feature of the reasoning engine is transparency. The platform exposes a first-class API to traverse the entire stack:
`GET /opportunity/{id}/explain/{person}`
