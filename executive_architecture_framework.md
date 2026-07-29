# RADAR V4 Executive Decision Architecture Framework
**Co-Authored by Chief AI Architect & User (Chief Product Architect)**

This framework represents the frozen conceptual and structural blueprint for **RADAR V4**. It shifts the platform's core matching engine away from reactive, ATS-style keyword matching and numerical score patches toward a robust, semantic **Executive Capability Ontology** and multi-engine decision pipeline.

---

# PART 1: The 12 Architectural Questions Answered

### 1. What exactly is RADAR trying to optimize?
> **One Answer Only**: **Maximize the expected long-term career value for the individual.**

RADAR does not exist to maximize application volume (like an ATS) or to find any job the candidate is *technically capable* of performing. It exists to protect and invest the candidate's limited, high-leverage career time into opportunities that match their executive operating level, strategic capacity, and lifestyle bounds.

---

### 2. Candidate Projection Schema
This is the canonical TypeScript schema representing what RADAR knows about the candidate's historical capability, current altitude, and preferences.

```typescript
interface CandidateProjection {
  // 1. Executive Demographics
  yearsOfExperience: number;
  currentOperatingLevel: OperatingLevel;
  currentWorkNature: WorkNature;
  
  // 2. Structural Scale Metrics (Historical maximums achieved)
  scale: {
    maxPLVolumeUSD: number;       // e.g. 5,000,000
    maxDirectReports: number;     // e.g. 15
    maxCrossFunctionalOrg: number;// e.g. 40 (GCC lead)
    geographicScope: "GLOBAL" | "REGIONAL" | "LOCAL";
  };
  
  // 3. Board & Governance Exposure
  governance: {
    boardExposure: boolean;      // Direct reporting / presentation to Board/MD
    regulatoryCompliance: boolean; // Direct ownership of regulatory bounds
  };

  // 4. Strategic Playbooks Developed (Yes/No with underlying evidence IDs)
  playbooks: {
    greenfieldGCC: boolean;      // Successfully built a center from scratch
    digitalTransformation: boolean; // Managed legacy-to-modern architecture migrations
    crisisTurnaround: boolean;   // Led recoveries during market downturns
    commercialScaling: boolean;  // Scaled portfolios by massive margins (>2x)
  };

  // 5. Capability Profile (Mapped directly to Executive Ontology)
  capabilities: Array<{
    capabilityId: string;        // e.g. "commercial_leadership"
    strength: "STRONG" | "MODERATE" | "WEAK";
    evidenceIds: string[];       // References to audited CV nodes
  }>;

  // 6. Real-Time Career Strategy & Directional Intent
  strategy: {
    targetTitles: string[];      // e.g. ["CMO", "CGO", "SVP"]
    targetIndustries: string[];  // e.g. ["Consumer Tech", "Auto", "Fintech"]
    minimumAcceptableLevel: OperatingLevel;
  };

  // 7. Lifestyle & Value Preferences
  lifestyle: {
    preferredLocations: string[]; // e.g. ["Gurugram", "Remote", "Singapore"]
    travelTolerance: "HIGH" | "MEDIUM" | "LOW";
    shiftTolerance: "DAY_ONLY" | "ANY";
    minCompensationUSD: number;
  };
}
```

---

### 3. Job Projection Schema
This is the canonical schema representing the normalized, structured extraction of any raw, unstructured job description.

```typescript
interface JobProjection {
  jobHash: string;
  title: string;
  company: string;
  
  // 1. Operating Scope Classification
  operatingLevel: OperatingLevel;
  workNature: WorkNature;
  
  // 2. Scale & Ownership Demands
  demands: {
    plAccountability: boolean;    // Role directly owns a budget / profit-loss book
    budgetVolumeUSD?: number;     // Extracted volume if explicit
    directReportsCount: number;   // Number of direct seats managed
    governanceRequired: boolean;  // Requires board exposure, MD alignment, or regulatory audits
  };

  // 3. Strategic Directives (What does this company need solved?)
  directives: {
    requiresGreenfield: boolean;  // Is this building a team/capability from scratch?
    requiresTransformation: boolean; // Is this migrating legacy systems or operations?
    requiresTurnaround: boolean;  // Is this recovering a failing portfolio?
  };

  // 4. Capability Requirements (Mapped to Executive Ontology)
  requiredCapabilities: Array<{
    capabilityId: string;         // e.g. "commercial_leadership"
    depthRequired: "EXECUTIVE" | "TACTICAL";
  }>;

  // 5. Operational Constraints
  operational: {
    location: string;
    isRemote: boolean;
    travelExpectation: "HIGH" | "MEDIUM" | "LOW";
    shiftHours: "STANDARD_DAY" | "AFTERNOON_NIGHT" | "US_OVERLAP";
    compensationRange?: {
      min?: number;
      max?: number;
    };
  };
}
```

---

### 4. Which dimensions are immutable?
The core executive capability ontology consists of **12 Immutable Dimensions**. Every capability must map back to one of these dimensions:

| Dimension | Description |
| :--- | :--- |
| **1. Leadership** | Building organizations, leading cross-functional teams, steering talent. |
| **2. Commercial** | Owning revenue outcomes, P&L responsibility, scaling portfolios. |
| **3. Strategy** | Defining market-entry, GTM frameworks, positioning models. |
| **4. Transformation**| Executing legacy migrations, structural reorganizations. |
| **5. Technology** | Designing enterprise architectures, managing MarTech stacks. |
| **6. Operations** | Governing delivery pipelines, day-to-day operational execution. |
| **7. Finance** | Managing capital budgets, P&L books, funding strategies. |
| **8. Governance** | Owning board alignments, surveillance, regulatory frameworks. |
| **9. Innovation** | Integrating AI, GenAI automation, exploring novel growth vectors. |
| **10. Brand** | Protecting corporate equity, integrated communication, public relations. |
| **11. People** | Mentoring, team structural design, hiring frameworks. |
| **12. Global** | Managing multi-market portfolios (APAC, Middle East, Europe, etc.). |

---

### 5. How do we define Operating Level?
The **Operating Level** represents the organizational altitude of the seat. It is calculated deterministically via a rules-based point system on the Job Projection:

| Operating Level | Rule / Criteria |
| :--- | :--- |
| **EXECUTIVE_LEADERSHIP** | Requires **at least 3** of: Direct Board/MD alignment, full P&L ownership ($1M+), organizational design power, >25 cross-functional seats, or global/regional geographic scope. |
| **STRATEGIC_LEADERSHIP** | Requires **at least 2** of: Functional strategy definition, department budget governance, multi-market delivery, or leading cross-functional pods. |
| **MANAGERIAL** | Focuses on team leadership and delivery execution: directs direct reports, runs operational processes, but lacks final P&L / strategy sign-off. |
| **TACTICAL** | Task and delivery execution: Scrum Master of a pod, executing pre-defined workflows, platform building. |
| **IC (Individual Contributor)**| Specialist executing discrete technical assignments (HTML/CSS editing, template QA, file loads). |

---

### 6. How do we define Work Nature?
The **Work Nature** is the active operating mode. It dictates whether the candidate will spend their time *designing* structures or *building* within them:

*   **EXECUTIVE_WORK**: High-leverage strategic activities. Defining CRM frameworks, owning commercial retainers, building organization capability, board alignment, governing capital budgets.
*   **TACTICAL_WORK**: Execution-level activities. Copy-pasting HTML/CSS, manually running list selections, template QA, daily stand-up backlog management, and purchase order administration.

---

### 7. Which signals belong to each Engine?
To prevent logic leaks and preserve architectural integrity, we segregate all signals into strict engine boundaries:

| Signal / Dimension | Engine 1: Opportunity Intelligence <br>*(Can you perform this?)* | Engine 2: Executive Growth <br>*(Does this advance you?)* | Engine 3: Decision Intelligence <br>*(Is this worth your life?)* |
| :--- | :---: | :---: | :---: |
| **Capability Match** | **✓** | | |
| **Technology Stack Fit**| **✓** | | |
| **Operating Level Fit** | | **✓** | |
| **Work Nature Fit** | | **✓** | |
| **Career Trajectory** | | **✓** | |
| **Compensation Match** | | | **✓** |
| **Lifestyle Constraints**| | | **✓** |
| **Work Shifts / Travel**| | | **✓** |

---

### 8. Which signals are hard gates?
To support non-linear decision-making, we define strict veto gates:

#### Hard Vetoes (Immediate PASS / Veto)
1.  **Operating Level Veto**: If Candidate Level is `EXECUTIVE_LEADERSHIP` and Job Level is `TACTICAL` or `IC` -> **PASS (Immediate Hard Veto)**.
2.  **Work Nature Veto**: If Job consists strictly of `TACTICAL_WORK` and Candidate's profile is strictly `EXECUTIVE_WORK` -> **PASS (Immediate Hard Veto)**.
3.  **Lifestyle Critical Mismatch**: If Candidate specifies `DAY_ONLY` shift preference and Job requires afternoon/night shifts (`US_OVERLAP`) -> **PASS (Immediate Hard Veto)**.

#### Soft Signals (Score Modifiers)
1.  **Salary Match**: If slightly below preferred threshold (within 10%), treat as a soft CONSIDER signal rather than an absolute veto.
2.  **Strategic Directives surplus**: If a candidate brings extra playbooks (e.g. greenfield scale) to a lateral role, it raises the growth priority score.

---

### 9. What is allowed to be inferred?
To eliminate LLM hallucination and ensure audit stability, we establish a strict **Inference Policy**:

> [!IMPORTANT]
> **Strict Inference Boundaries**
> *   **Allowed to Inferred**: Operating Level and Work Nature can be inferred by evaluating the density ratio of tactical vs. executive keywords in the JD.
> *   **STRICTLY FORBIDDEN to Infer**: Board reporting, P&L ownership volume, and regulatory compliance *cannot* be assumed unless explicitly stated in the JD text. If the JD is silent, these must be treated as **UNSTATED / MISSING**.

---

### 10. Which dimensions are candidate-specific?
These properties belong to the **Candidate's Intent Profile**, not the Job:
*   **Geographic preference**: (Remote vs. specific physical cities).
*   **Compensation threshold**: (Minimum acceptable annual base/retainer).
*   **Time & Shift constraints**: (Day-shift only vs. flexible hours).
*   **Travel tolerance**: (None vs. up to 25% vs. frequent international travel).
*   **Active Target Direction**: (The target trajectory: Forward C-suite track vs. Lateral stability).

---

### 11. Which dimensions evolve over time?
These belong in **Configuration (JSON payloads)** and should never be hardcoded into evaluation code:
*   **Domain-to-grade normalization maps** (e.g. mapping BFSI AVP to Managerial level, and Startup Head to Executive level).
*   **Enterprise MarTech stack mappings** (synonyms of platforms like Zeta, SFMC, Adobe Cloud).
*   **Candidate targets** (can be updated instantly in Settings without rebuilding code).

---

### 12. How do we evaluate success?
We track evaluation fidelity through programmatic **Retrospection Metrics**:

*   **User Selection Alignment**: Does the user agree with RADAR's vetoes?
*   **Interaction Funnel**: Percentage of `PURSUE` recommendations that result in the user submitting their profile.
*   **Interview Conversion Rate**: High suitability recommendations must convert into active conversations.
*   **Regret Rate**: Periodic feedback on accepted offers. If a user accepts a role but leaves/regrets it within 6 months, RADAR audits the mismatch retroactively to tune the Operating Level heuristics.

---

# PART 2: The Executive Capability Ontology
This is the unified conceptual dictionary that the entire RADAR platform shares.

```
                    ┌───────────────────────────────┐
                    │    EXECUTIVE CAPABILITY       │
                    └───────────────┬───────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
[ Evidence Anchors ]       [ Operating Mode ]         [ Downstream Signals ]
- Verified CV Quotes       - Strategic (Executive)    - Strategic Advantages
- Audited GCC Size        - Tactical (Hands-on)      - Career Trajectory
```

### Core Capability Directory (Sample)

#### 1. `commercial_leadership`
*   **Definition**: Ownership of business revenue outcomes, P&L metrics, client contract retainers, and pricing strategies.
*   **Evidence Anchors**: Budget volume ($), direct client accounts value, P&L oversight clauses.
*   **Related Signals**: Operating Level, Career Growth.

#### 2. `digital_transformation`
*   **Definition**: Strategic re-architecture, migration of legacy systems to modern cloud/CDP infrastructure, and organizational change management.
*   **Evidence Anchors**: Multi-market system migrations, legacy sunsetting timelines.
*   **Related Signals**: Strategic Advantage (Greenfield / Scale).

#### 3. `growth_marketing`
*   **Definition**: Multi-channel acquisition, customer journey optimization, budget allocation across high-performance channels, and ROI optimization.
*   **Evidence Anchors**: Attributed revenue growth ($), CAC reduction percentage (%), channel scale.
*   **Related Signals**: Work Nature, Capability Match.

---

# PART 3: The Decision Policy (How Verbs Resolve)

The final recommendation is determined through a clean, non-linear cascade check on the compiled gates:

| Operating Level Gate | Work Nature Gate | Trajectory Gate | Lifestyle Gate | **FINAL RECOMMENDATION** |
| :--- | :--- | :--- | :--- | :---: |
| **POOR** | **POOR** | **BACKWARD** | **POOR** | **PASS** <br>*(Zero-score hard veto with clear regression explanation)* |
| **GOOD** | **EXCELLENT** | **FORWARD** | **POOR** | **PASS** <br>*(Vetoed strictly on Lifestyle shift constraints)* |
| **EXCELLENT** | **EXCELLENT** | **FORWARD** | **EXCELLENT** | **PURSUE** <br>*(High score, premium target)* |
| **GOOD** | **GOOD** | **LATERAL** | **GOOD** | **CONSIDER** <br>*(Safe, stable lateral match)* |

---

# PART 4: Next Steps & Implementation Lock

I have completely paused any code changes to co-author this framework with you. 

Please review this **V4 Executive Decision Architecture**. Once you approve:
1.  We will implement this exact semantic model in `V3EvaluationEngine.ts` and `EvaluationAdapter.ts`.
2.  We will run our live score runner and observe the newly corrected, highly accurate, and incredibly explainable results!
