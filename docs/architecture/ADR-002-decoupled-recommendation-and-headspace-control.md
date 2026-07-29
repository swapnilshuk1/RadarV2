# ADR 002: RADAR Decoupled Recommendation Engine & Headspace Controls

**Status:** Accepted  
**Date:** July 22, 2026  

## Context
As RADAR transitions to a live, multi-portal executive job scanning platform, we must solve two major cognitive and UX challenges:
1. **The Signal-Noise Disconnect**: A role may be a perfect executive fit (structurally aligned to title, salary, hybrid work, direct CEO reporting) but have low specific keyword competency match in raw job descriptions (due to sparse JD text). Conversely, a highly matched skill role might be structurally out-of-bounds.
2. **Cognitive Overload (Bandwidth Saturation)**: Presenting an infinite feed of "high priority" opportunities dilutes executive focus. We must protect the candidate's monthly capacity and calendar.

## Architectural Decision

We implement a **Decoupled Two-Engine Evaluation & Saturation Architecture** that operates on independent mathematical models and self-limiting structural rules.

```
       [Raw Job Description Snapshot]
                     |
         +-----------+-----------+
         |                       |
         v                       v
[Engine A: Structural Fit]  [Engine B: Skill Fit]
  - Priority Pipeline         - Capability Match Scorer
  - Matches CareerValue       - Maps profile skills
    & ShortlistingPotential     to JD keywords
  - Calculates Priority [0,1] - Calculates Suitability [0,100]
         |                       |
         v                       |
[Headspace Saturation Squeeze]   |
  - Downgrades PURSUE to         |
    CONSIDER if saturated        |
         |                       |
         +-----------+-----------+
                     |
                     v
       [Presenter: presented Opportunity DTO]
```

### 1. Engine A: Structural Priority Pipeline
* **Responsibility**: Calculates structural suitability and assigns the primary **Decision Tag** (`PURSUE` or `CONSIDER`).
* **Core File**: [src/lib/intelligence/priority.ts](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/priority.ts)
* **Mathematical Formula**:
  $$\text{Priority} = \frac{\text{CareerValue} \times \text{ShortlistingPotential}}{\text{PursuitFriction}}$$
* **Variables**:
  * $\text{CareerValue}$: Matches level, mandate, and commercial accountability with candidate ambition ([src/lib/intelligence/priority.ts#L47-L50](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/priority.ts#L47-L50)).
  * $\text{ShortlistingPotential}$: Jaccard similarity index across all canonical dimensions ([src/lib/intelligence/priority.ts#L53](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/priority.ts#L53)).
  * $\text{PursuitFriction}$: Multiplicative friction penalty from location mismatch, work-model conflict, and market reporting complexity ([src/lib/intelligence/priority.ts#L55-L65](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/priority.ts#L55-L65)).
* **Decision Bands**: Wires priority to categorical bands:
  * $\text{Priority} \ge 0.55 \rightarrow \text{PURSUE}$
  * $\text{Priority} \ge 0.30 \rightarrow \text{CONSIDER}$
  * $\text{Priority} < 0.30 \rightarrow \text{PASS}$

### 2. Engine B: Capability Match Engine
* **Responsibility**: Computes the **Pursuit Potential Score** (displayed as a percentage out of 100 on the job card).
* **Core File**: [src/lib/recommendation/CapabilityRecommendationScorer.ts](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/recommendation/CapabilityRecommendationScorer.ts)
* **Axiom**: Evaluates continuous capability scores against weights configured in [config/policies/recommendation-policy.json](file:///C:/Users/swapn/Downloads/radar-local-v2/config/policies/recommendation-policy.json). This assesses deep skills matching (e.g. `cap_crm_strategy`, `cap_business_turnaround`, `cap_executive_growth_scale`) rather than structural attributes.

---

## Bandwidth Capacity Controls (Headspace Saturation)

To maintain cognitive bandwidth and focus, the system restricts the candidate to a self-defined monthly limit.
* **Core File**: [src/lib/intelligence/headspace-filter.ts](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/headspace-filter.ts)
* **Capacity Limit**: Configured as `headspaceCapacityPerMonth` in `candidate-profile.json` (defaults to `5` active pursuits).
* **Asymmetric Downgrade Rule**:
  ```ts
  if (headspace.saturated && verb === "PURSUE") {
    return {
      finalVerb: "CONSIDER",
      downgraded: true,
      reason: `You are at capacity (${headspace.activePursuits}/${headspace.capacityPerMonth} active pursuits). Priority remains high — reassess when a pursuit closes.`
    };
  }
  ```
  If the active pursuits count equals or exceeds monthly capacity:
  1. The workspace becomes **Saturated**.
  2. Any newly scraped job that normally evaluates as `PURSUE` ($\ge 0.55$ priority) is **automatically downgraded to `CONSIDER`**.
  3. This ensures the user is not distracted by new "must-pursue" options when their calendar is already committed.

---

## Database Schema & Storage Specifications

RADAR isolates transactional, high-frequency crawling queues from primary decision states:

### 1. Primary Knowledge Store (`radar.sqlite`)
* **Core File Connection**: Wiped and read by [src/lib/intelligence/scrape-server.ts](file:///C:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/scrape-server.ts).
* **Purpose**: Persists deduplicated opportunity records, structured dimensions, and candidate evaluations. This SQLite database ensures that data is readily available for the local dashboard and remains persistent across reloads.

### 2. Enrichment Queue Store (`.radar/queue.db`)
* **Core File Connection**: Created and managed by [scripts/scraper/persist/queue.ts](file:///C:/Users/swapn/Downloads/radar-local-v2/scripts/scraper/persist/queue.ts).
* **Purpose**: An atomic transactional queue database using **SQLite WAL mode** and **mutual-exclusion leases**. 
* **Worker Mutual-Exclusion (Mutes Race Conditions)**:
  When an enrichment worker starts, it leases a job and locks it with a custom UUID lease owner:
  ```sql
  UPDATE enrichment_jobs 
  SET status = 'LEASED', lease_owner = ?, lease_expires_at = ? 
  WHERE id = (
    SELECT id FROM enrichment_jobs 
    WHERE status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
    ORDER BY (business_priority + execution_priority) DESC, created_at ASC 
    LIMIT 1
  );
  ```
  This prevents multiple parallel enrichment workers (or scraper processes) from attempting to call the Gemini API on the same raw job HTML concurrently.

---

## Consequences & Core Invariants
1. **Consistency**: Changes to the candidate profile automatically propagate through `runPipeline()` on the next dashboard reload.
2. **Bandwidth Preservation**: The user's `PURSUE` lane is kept elite and active, while non-pursued roles with high scores are safely parked in `CONSIDER`.
3. **Data Integrity**: Clean schema migrations are executed automatically on database initialization.
