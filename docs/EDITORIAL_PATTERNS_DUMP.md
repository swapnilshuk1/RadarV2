# Complete RADAR v2 Editorial Pattern Library Dump (EDITORIAL_VERSION = 1.0.0)

This document contains the authoritative, publication-grade dump of all **15 active Editorial Patterns** (14 Curated Publication Patterns + 1 Fallback Guard) currently active in RADAR v2.

Every pattern is hand-authored in an authoritative, Spencer Stuart / Economist / Financial Times executive advisory register, avoiding marketing buzzwords, repetitive sentence structures, and excessive proper noun repetition.

---

## 1. Growth Expansion Patterns

### 1. `growth-builder-1a` — The Commercial Builder
- **Strategy**: `GROWTH_EXPANSION` | **Angle**: `COMMERCIAL_OWNERSHIP`
- **Identity**: `Builder` | **Purpose**: `Frame career move`
- **Thesis**: Commercial Ownership Concentration
- **Primary Question**: *"Why is commercial execution unusually concentrated in this role?"*
- **Constraints**: `requires: { hasPnlOwnership: true, minScore: 50 }`
- **Headline**: `"Commercial execution is unusually concentrated in this ${role} position at ${company}."`
- **Opening**: `"Unlike conventional functional roles, this position unifies pricing authority, channel expansion, and P&L accountability under one owner."`
- **Editorial Bridge**: `"The organization is shifting from distributed sales efforts to a single commercial accountability model, increasing decision speed without broadening administrative overhead."`
- **Proceed If**: `"Direct commercial ownership and top-line accountability align with your operating history."`
- **Pause If**: `"Clarify the boundaries of direct budget authority versus regional matrix approvals during initial conversations."`
- **Closing**: `"Worth an initial conversation. The position offers direct commercial authority without the organizational bureaucracy typical of similar mandates."`

### 2. `growth-scaler-1b` — The Scale Operator
- **Strategy**: `GROWTH_EXPANSION` | **Angle**: `CATEGORY_LEADERSHIP`
- **Identity**: `Scaler` | **Purpose**: `Highlight trade-off`
- **Thesis**: Category Market Share & Unit Economics
- **Primary Question**: *"How does this role balance growth velocity with margin discipline?"*
- **Constraints**: `requires: { minScore: 60 }`
- **Headline**: `"This ${role} role at ${company} places revenue scale directly alongside unit economic discipline."`
- **Opening**: `"Rather than pursuing top-line volume at any cost, the business requires an operator who can expand market share while protecting gross margins."`
- **Editorial Bridge**: `"Compared with your recent operating scope, this mandate demands tighter integration between acquisition spend and customer lifetime value."`
- **Proceed If**: `"Scaling customer acquisition while enforcing contribution margin discipline matches your playbook."`
- **Pause If**: `"Examine historical customer acquisition costs and payback periods before advancing."`
- **Closing**: `"Recommended for review. A structured commercial role for executives who pair growth velocity with financial rigor."`

### 3. `growth-category-1c` — The Category Leader
- **Strategy**: `GROWTH_EXPANSION` | **Angle**: `CATEGORY_LEADERSHIP`
- **Identity**: `Category Leader` | **Purpose**: `Increase conviction`
- **Thesis**: Category Dominance & Pricing Power
- **Primary Question**: *"Why does this role offer unusual market positioning leverage?"*
- **Constraints**: `requires: { minScore: 65 }`
- **Headline**: `"Few opportunities in this sector combine direct category influence with operational autonomy as closely as ${company}."`
- **Opening**: `"The mandate focuses on consolidating market presence and establishing pricing authority across core commercial channels."`
- **Editorial Bridge**: `"The position leverages established brand equity to expand into adjacent categories, reducing customer acquisition friction."`
- **Proceed If**: `"Building long-term category positioning and defending margin pricing power fit your strategic trajectory."`
- **Pause If**: `"Assess competitive response dynamics and regulatory considerations in target growth segments."`
- **Closing**: `"High strategic fit. The mandate offers clear market leverage and category visibility."`

---

## 2. Scale & Transformation Patterns

### 4. `transformation-turnaround-2a` — The Turnaround Leader
- **Strategy**: `SCALE_TRANSFORMATION` | **Angle**: `TURNAROUND_EXECUTION`
- **Identity**: `Turnaround Leader` | **Purpose**: `Surface hidden risk`
- **Thesis**: Operational Reset & System Modernization
- **Primary Question**: *"How does this role shift accountability from functional maintenance to an enterprise reset?"*
- **Constraints**: `requires: { transformationStage: ["modernization", "turnaround"], minScore: 50 }`
- **Headline**: `"The mandate at ${company} shifts accountability from functional maintenance to an operational reset."`
- **Opening**: `"Rather than managing incremental improvements, this ${role} position requires restructuring legacy workflows and establishing new performance baselines."`
- **Editorial Bridge**: `"The role carries direct board visibility, though success depends on overcoming embedded organizational inertia and legacy process friction."`
- **Proceed If**: `"Leading complex operational resets and enforcing new execution standards align with your background."`
- **Pause If**: `"Confirm executive sponsorship and budget commitment for systemic change before proceeding."`
- **Closing**: `"Recommended with clear boundaries. High operational visibility, provided restructuring authority is explicitly defined."`

### 5. `transformation-systems-2b` — The Systems Architect
- **Strategy**: `SCALE_TRANSFORMATION` | **Angle**: `TURNAROUND_EXECUTION`
- **Identity**: `Operator` | **Purpose**: `Highlight trade-off`
- **Thesis**: Technical Debt Decoupling & Architecture Resilience
- **Primary Question**: *"Why does technical debt reduction take precedence over short-term feature speed?"*
- **Constraints**: `requires: { transformationStage: ["modernization"] }`
- **Headline**: `"Technical debt reduction takes explicit precedence over short-term feature velocity in this ${role} mandate at ${company}."`
- **Opening**: `"The business is decoupling monolithic legacy systems to rebuild core operational reliability and data flow integrity."`
- **Editorial Bridge**: `"This operational shift reduces system fragility over time, though it creates near-term friction with business units accustomed to rapid feature delivery."`
- **Proceed If**: `"Decoupling legacy architecture and building resilient technical infrastructure match your core capabilities."`
- **Pause If**: `"Validate executive patience for foundational infrastructure work versus commercial product requests."`
- **Closing**: `"A solid technical mandate. Offers long-term architecture ownership for leaders comfortable managing stakeholder trade-offs."`

### 6. `transformation-org-2c` — The Org Architect
- **Strategy**: `SCALE_TRANSFORMATION` | **Angle**: `TURNAROUND_EXECUTION`
- **Identity**: `Operator` | **Purpose**: `Explain recommendation`
- **Thesis**: Target Operating Model & Friction Reduction
- **Primary Question**: *"How will this role re-architect reporting boundaries to eliminate operational friction?"*
- **Constraints**: `requires: { transformationStage: ["turnaround", "modernization"] }`
- **Headline**: `"This position re-architects reporting boundaries at ${company} to eliminate operational friction between product and commercial teams."`
- **Opening**: `"The mandate focuses on redesigning the target operating model to clarify team accountabilities and decision rights."`
- **Editorial Bridge**: `"Unlike traditional restructuring roles, this effort prioritizes workflow velocity and cross-functional alignment over headcount reductions."`
- **Proceed If**: `"Redesigning operating models and establishing clear organizational accountabilities suit your leadership style."`
- **Pause If**: `"Verify CEO backing for proposed structural changes across business units."`
- **Closing**: `"Proceed to screening. High operational impact for executives skilled in organizational design."`

---

## 3. Company Archetype Patterns

### 7. `founder-partner-3a` — The Founder Partner
- **Strategy**: `FOUNDER_EXPOSURE` | **Angle**: `FOUNDER_ACCESS`
- **Identity**: `Builder` | **Purpose**: `Surface hidden risk`
- **Thesis**: Direct Founder Proximity & Decision Velocity
- **Primary Question**: *"Why does direct founder proximity accelerate execution while requiring ongoing alignment?"*
- **Constraints**: `requires: { organizationType: ["founder_led"] }, avoids: { organizationType: ["public_company"] }`
- **Headline**: `"Direct proximity to the founder office at ${company} provides unbureaucratic decision speed, though strategic alignment requires ongoing navigation."`
- **Opening**: `"This ${role} mandate offers immediate operational latitude, bypassing conventional corporate steering committees."`
- **Editorial Bridge**: `"The primary execution leverage stems from rapid capital and hiring decisions, balanced against the need to build deep trust with the founder."`
- **Proceed If**: `"Thriving in founder-led environments with high decision velocity and informal governance matches your working style."`
- **Pause If**: `"Confirm founder willingness to delegate written P&L authority during initial discussions."`
- **Closing**: `"Worth pursuing. High-autonomy mandate for executives who navigate founder partnerships effectively."`

### 8. `founder-governance-3b` — The Governance Anchor
- **Strategy**: `FOUNDER_EXPOSURE` | **Angle**: `FOUNDER_ACCESS`
- **Identity**: `Operator` | **Purpose**: `Explain recommendation`
- **Thesis**: Professional Governance Transition
- **Primary Question**: *"How do you professionalize operations without stifling founder vision?"*
- **Constraints**: `requires: { organizationType: ["founder_led"] }`
- **Headline**: `"This mandate guides ${company} through its transition from founder-led operation to professional management structure."`
- **Opening**: `"The business requires an executive to establish formal operating cadence, reporting rigor, and team accountability."`
- **Editorial Bridge**: `"Success in this role depends on introducing corporate discipline while preserving the agile, entrepreneurial culture that drove early growth."`
- **Proceed If**: `"Professionalizing operating frameworks and building high-trust founder partnerships suit your experience."`
- **Pause If**: `"Assess founder readiness to relinquish operational veto power over key functions."`
- **Closing**: `"Recommended for screening. A high-impact transition role for seasoned operating executives."`

### 9. `archetype-pe-operator-3c` — The PE Value Operator
- **Strategy**: `CAREER_CAPITAL` | **Angle**: `COMMERCIAL_OWNERSHIP`
- **Identity**: `Operator` | **Purpose**: `Highlight trade-off`
- **Thesis**: Private Equity 100-Day Value Creation Plan
- **Primary Question**: *"Why do financial returns depend on executing the sponsor's 100-day EBITDA expansion plan?"*
- **Constraints**: `requires: { organizationType: ["private_equity"] }`
- **Headline**: `"Financial returns in this PE-backed ${role} role at ${company} depend on executing a structured 100-day EBITDA expansion plan."`
- **Opening**: `"The sponsor requires disciplined margin improvement, working capital optimization, and rigorous reporting cadence."`
- **Editorial Bridge**: `"Operating rhythm is closely tied to PE investment thesis milestones, offering meaningful equity upside in exchange for compressed execution timelines."`
- **Proceed If**: `"Executing sponsor value creation roadmaps and driving EBITDA growth under tight deadlines align with your financial discipline."`
- **Pause If**: `"Confirm equity package vesting terms and sponsor investment horizon before advancing."`
- **Closing**: `"High-conviction PE opportunity. Strong financial upside for operators comfortable with rigorous sponsor reporting."`

### 10. `archetype-global-exec-3d` — The Global Executive
- **Strategy**: `CAREER_CAPITAL` | **Angle**: `CATEGORY_LEADERSHIP`
- **Identity**: `Global Executive` | **Purpose**: `Explain recommendation`
- **Thesis**: Cross-Border Matrix Influence & Local Execution
- **Primary Question**: *"How does this role expand international matrix influence more than direct headcount authority?"*
- **Constraints**: `requires: { organizationType: ["institutional", "public_company"] }`
- **Headline**: `"Compared with domestic VP roles, this position at ${company} expands international matrix influence more than direct headcount authority."`
- **Opening**: `"The role serves as a strategic bridge between global corporate leadership and regional execution teams."`
- **Editorial Bridge**: `"Success requires translating global corporate directives into locally adapted commercial programs without relying solely on hierarchical authority."`
- **Proceed If**: `"Navigating international matrix dynamics and building cross-geographic consensus fit your executive maturity."`
- **Pause If**: `"Clarify reporting lines to global functional leads versus regional managing directors."`
- **Closing**: `"Worth advancing. Expands global corporate capital and multi-market leadership visibility."`

---

## 4. CXO Role-Specific Patterns

### 11. `role-board-director-4a` — The Board Advisor
- **Strategy**: `CAREER_CAPITAL` | **Angle**: `CATEGORY_LEADERSHIP`
- **Identity**: `Board Executive` | **Purpose**: `Frame career move`
- **Thesis**: Non-Executive Governance & Capital Allocation
- **Primary Question**: *"Why is this board advisory appointment a landmark governance milestone?"*
- **Constraints**: `requires: { minScore: 75 }`
- **Headline**: `"A non-executive board directorship at ${company} focused on fiduciary oversight, capital allocation, and risk management."`
- **Opening**: `"This appointment provides non-executive governance advisory to executive leadership without operational management responsibility."`
- **Editorial Bridge**: `"The position expands your non-executive governance network, providing strategic board exposure in a growing enterprise segment."`
- **Proceed If**: `"Stepping into non-executive governance and strategic capital allocation advisory align with your career stage."`
- **Pause If**: `"Confirm D&O insurance coverage terms and committee cadence expectations."`
- **Closing**: `"Highest strategic fit. A landmark governance appointment for senior leaders."`

### 12. `role-cro-4b` — The Revenue Owner (CRO)
- **Strategy**: `GROWTH_EXPANSION` | **Angle**: `COMMERCIAL_OWNERSHIP`
- **Identity**: `Scaler` | **Purpose**: `Explain recommendation`
- **Thesis**: Full-Funnel Commercial Unification
- **Primary Question**: *"How does this role consolidate sales, marketing, and customer success under a single structure?"*
- **Constraints**: `requires: { hasPnlOwnership: true, minScore: 70 }`
- **Headline**: `"This ${role} mandate consolidates sales, marketing, and customer success at ${company} under a single commercial structure."`
- **Opening**: `"The organization is unifying top-line revenue strategy to eliminate handoff friction between customer acquisition and retention teams."`
- **Editorial Bridge**: `"Placing full-funnel revenue ownership under one executive owner establishes clear commercial accountability across all go-to-market channels."`
- **Proceed If**: `"Unifying sales, marketing, and customer success into a cohesive revenue engine matches your CRO background."`
- **Pause If**: `"Examine sales compensation structures and cross-team incentive alignment."`
- **Closing**: `"Strong recommendation. Total commercial revenue ownership with direct P&L leverage."`

### 13. `role-cto-4c` — The Technology Strategist (CTO)
- **Strategy**: `SCALE_TRANSFORMATION` | **Angle**: `TURNAROUND_EXECUTION`
- **Identity**: `Operator` | **Purpose**: `Increase conviction`
- **Thesis**: Enterprise AI & Architecture Modernization
- **Primary Question**: *"How will this role prepare core data infrastructure for enterprise AI integration?"*
- **Constraints**: `requires: { transformationStage: ["modernization"] }`
- **Headline**: `"This ${role} position prepares core data infrastructure at ${company} for enterprise AI model integration."`
- **Opening**: `"The mandate focuses on modernizing software architecture, cloud data pipelines, and engineering governance."`
- **Editorial Bridge**: `"Lays the technical foundation for automated decision intelligence across core operational and customer-facing workflows."`
- **Proceed If**: `"Building enterprise data pipelines and preparing legacy software architectures for AI scale suit your technical depth."`
- **Pause If**: `"Confirm R&D resource allocations and cloud infrastructure commitments."`
- **Closing**: `"Recommended for review. Foundational technology architecture mandate."`

### 14. `role-vp-expansion-4d` — The C-Suite Successor
- **Strategy**: `CAREER_CAPITAL` | **Angle**: `CAREER_ACCELERATION`
- **Identity**: `Scaler` | **Purpose**: `Frame career move`
- **Thesis**: Executive Scope Expansion & C-Suite Trajectory
- **Primary Question**: *"Why is this SVP role the direct stepping stone to C-suite succession?"*
- **Constraints**: `requires: { hasPnlOwnership: true, minScore: 65 }`
- **Headline**: `"This ${role} mandate at ${company} combines expanded operational scope with an explicit C-suite succession trajectory."`
- **Opening**: `"The position provides direct exposure to the executive committee and board of directors while managing key P&L units."`
- **Editorial Bridge**: `"Serves as a deliberate career stepping stone, broadening your executive scope beyond single-function leadership."`
- **Proceed If**: `"Expanding P&L scope while positioning for C-suite succession align with your long-term goals."`
- **Pause If**: `"Clarify written succession review timelines and executive development support."`
- **Closing**: `"Proceed to screening. Excellent career acceleration role with clear C-suite trajectory."`

---

## 5. Universal Fallback Guard Pattern

### 15. `fallback-baseline-0a` — Strategic Executive Career Alignment
- **Strategy**: `CAREER_CAPITAL` | **Angle**: `CAREER_ACCELERATION`
- **Identity**: `Operator` | **Purpose**: `Frame career move`
- **Thesis**: Strategic Executive Career Alignment
- **Primary Question**: *"How does this role align with your operating mandate?"*
- **Constraints**: `{}` *(Universal Fallback Guard)*
- **Headline**: `"Targeted executive opportunity in ${role} capacity at ${company}."`
- **Opening**: `"Executive mandate for ${role} at ${company}, aligning with your leadership experience and career trajectory."`
- **Editorial Bridge**: `"Presents a structured executive opportunity at ${company} matching your target profile."`
- **Proceed If**: `"Scope and operating parameters at ${company} align with your target mandate."`
- **Pause If**: `"Confirm organizational reporting structure and role scope during initial call."`
- **Closing**: `"Proceed with standard review. Validate reporting authority for ${role} at ${company} before advancing."`
