/**
 * assemble-gate1b-batch06-blind-materials.ts
 *
 * Implements Gate 1B Batch 06 Step 3A:
 * Packages blind materials for Primary Certification Population and Secondary Remediation Holdout:
 * - Primary: 50 roles (30 natural Indian executive JDs from Turso DB + 20 adversarial) + 16 resumes
 * - Secondary: 25 roles (15 natural Indian executive JDs from Turso DB + 10 adversarial) + 8 resumes
 *
 * Strictly adheres to Scope Revision 3 invariants:
 * - Assigns opaque IDs (PRIMARY_ROLE_XX, PRIMARY_CANDIDATE_XX, SECONDARY_ROLE_XX, SECONDARY_CANDIDATE_XX)
 * - Computes SHA-256 hashes of all source documents
 * - Produces population manifests
 * - Produces 100% BLANK annotation templates (ZERO pre-filled types, polarity, applicability, or boundaries)
 * - Produces external human reviewer instructions
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getDatabaseAdapter } from "../../src/data/database";

const rootDir = process.cwd();
const batch06Dir = path.join(rootDir, "audit-reports/gate1b-batch06");
const matPrimaryDir = path.join(batch06Dir, "materials/primary");
const matSecondaryDir = path.join(batch06Dir, "materials/secondary");
const annPrimaryDir = path.join(batch06Dir, "annotation/primary");
const annSecondaryDir = path.join(batch06Dir, "annotation/secondary");

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Adversarial Roles Definitions
// ============================================================================

const PRIMARY_ADVERSARIAL_ROLES = [
  {
    opaqueId: "PRIMARY_ROLE_31",
    scenario: "Budget ownership without P&L ownership",
    highRiskStressDimension: "PNL_OWNERSHIP",
    rawText: `SENIOR DIRECTOR, GLOBAL MARKETING OPERATIONS
Company: CloudPoint Global Solutions
Location: Bengaluru, India (Hybrid)

ABOUT THE ROLE:
We are seeking an experienced Senior Director of Global Marketing Operations to lead operational planning, MarTech stack consolidation, and fiscal budget governance.
In this role, you will manage an annual marketing program budget of $6,500,000 across digital acquisition, agency retainers, and tooling.
NOTE ON FISCAL ACCOUNTABILITY: While you hold full signatory authority over marketing operational expenses and vendor disbursements, company P&L ownership and business unit bottom-line profit/loss reside strictly with the Chief Operating Officer and Business Unit General Managers. You will not carry commercial P&L accountability.

KEY RESPONSIBILITIES:
- Oversee allocation and monthly pacing of the $6.5M marketing department operational budget.
- Establish vendor SLA monitoring and negotiate enterprise software licensing agreements.
- Report quarterly variance analysis to the Finance Director.

REQUIREMENTS:
- 14+ years in B2B technology operations.
- Demonstrated experience managing marketing budgets exceeding $5M.`
  },
  {
    opaqueId: "PRIMARY_ROLE_32",
    scenario: "Reporting line to VP; explicit non-reporting to CEO/Board",
    highRiskStressDimension: "REPORTING_LINE",
    rawText: `HEAD OF CUSTOMER LIFECYCLE & RETENTION
Company: Vistara FinTech Labs
Location: Mumbai, India (On-site)

ORGANIZATIONAL STRUCTURE:
This position reports directly and exclusively to the Vice President of Growth. 
CLARIFICATION ON EXECUTIVE VISIBILITY: This role does not report to the Chief Executive Officer and does not present to the Board of Directors. All executive reporting is routed through the VP of Growth during monthly executive committee reviews.

ROLE SUMMARY:
You will design customer retention journeys, cohort engagement strategies, and automated lifecycle communication workflows across mobile and web banking channels.

RESPONSIBILITIES:
- Build automated retention triggers across SMS, WhatsApp, and email using MoEngage and Braze.
- Analyze cohort churn rates and present retention insights to the VP of Growth.
- Partner with product managers to reduce day-30 user drop-off across savings account products.

QUALIFICATIONS:
- 10-15 years experience in customer lifecycle management in consumer banking or fintech.`
  },
  {
    opaqueId: "PRIMARY_ROLE_33",
    scenario: "Matrix leadership without direct people management",
    highRiskStressDimension: "PEOPLE_LEADERSHIP",
    rawText: `PRINCIPAL ENTERPRISE ARCHITECT - CLOUD TRANSFORMATION
Company: Nexus Enterprise Systems
Location: Hyderabad, India (Hybrid)

ROLE CONTEXT:
Nexus Enterprise Systems is looking for a Principal Enterprise Architect to steer our global microservices migration.
PEOPLE MANAGEMENT SPECIFICATION: This is a dedicated Individual Contributor (IC) leadership position. You will lead cross-functional transformation squads through matrix influence and architectural authority. This position carries ZERO direct line-management reports and has no supervisory responsibility for hiring, performance appraisals, or payroll approvals.

KEY DELIVERABLES:
- Define target-state microservices architectures and domain boundaries for core policy administration systems.
- Influence and guide technical decisions across 14 agile engineering pods without direct management authority.
- Establish architectural principles and review Architecture Decision Records (ADRs).

EXPERIENCE:
- 16+ years of distributed systems engineering.
- Deep expertise in AWS, Kubernetes, and event-driven architecture.`
  },
  {
    opaqueId: "PRIMARY_ROLE_34",
    scenario: "Candidate requirement of P&L vs role scope (No role P&L)",
    highRiskStressDimension: "PNL_OWNERSHIP",
    rawText: `STRATEGIC ADVISOR - MARKET EXPANSION (CONTRACT)
Company: Apex Consumer Brands
Location: Gurugram, India (Remote)

THE POSITION:
Apex Consumer Brands is engaging a Strategic Advisor for 9 months to evaluate market-entry opportunities in Southeast Asia.

CANDIDATE QUALIFICATION REQUIREMENTS:
- The ideal candidate must have previously managed a full business unit P&L exceeding ₹100 Cr in an executive operating capacity.
- 18+ years of commercial leadership in FMCG or retail consumer products.

ROLE SCOPE AND BOUNDARIES:
In this advisory engagement, you will formulate research models, assess regulatory environments, and provide strategic recommendations to executive leadership. This role does not operate or manage any P&L, carries no revenue quota, and has no direct balance sheet ownership. The engagement is strictly consultative and advisory.`
  },
  {
    opaqueId: "PRIMARY_ROLE_35",
    scenario: "Company revenue scale stated; candidate carries zero revenue quota",
    highRiskStressDimension: "REVENUE_ACCOUNTABILITY",
    rawText: `GLOBAL DIRECTOR OF TECHNICAL CUSTOMER SUPPORT
Company: InfiniScale SaaS Technologies
Location: Pune, India (On-site)

COMPANY OVERVIEW:
InfiniScale is a global SaaS unicorn generating $180,000,000 in Annual Recurring Revenue (ARR) across North America, EMEA, and APAC markets.

ROLE MANDATE:
We are hiring a Global Director of Technical Customer Support to elevate our Tier-3 technical support operations.
COMMERCIAL QUOTA CLARIFICATION: While our company delivers $180M in ARR, this support leadership role carries zero personal sales quota, zero commercial revenue targets, and zero pipeline generation accountability. Performance is assessed strictly against SLA response times, First Contact Resolution (FCR), and Customer Satisfaction (CSAT).

RESPONSIBILITIES:
- Lead a global 24/7 technical support engineering group of 60 support engineers across India and Poland.
- Maintain 99.5% compliance with enterprise Tier-1 support SLAs.
- Reduce average ticket resolution time by 25% through improved troubleshooting automation.`
  },
  {
    opaqueId: "PRIMARY_ROLE_36",
    scenario: "Conditional decision authority requiring CFO/Legal sign-off",
    highRiskStressDimension: "DECISION_AUTHORITY",
    rawText: `PROCUREMENT DIRECTOR - INDIRECT SPEND
Company: Sterling Healthcare Global
Location: Bengaluru, India (Hybrid)

PURPOSE:
Manage indirect procurement, facilities contracts, and technology vendor agreements across Indian hospital operations.

SIGNATORY AUTHORITY LIMITS:
The Procurement Director is authorized to independently approve procurement orders and service requisitions up to ₹25 Lakhs ($30,000).
CONDITIONAL GOVERNANCE: Any contract, master service agreement, or purchase commitment exceeding ₹25 Lakhs requires mandatory formal counter-signature and written approval from the Chief Financial Officer and General Counsel. The role cannot independently bind the company to major multi-year commitments without CFO sign-off.

PRIMARY DUTIES:
- Negotiate indirect supplier contracts and run competitive RFP processes.
- Implement automated e-procurement workflows via SAP Ariba.
- Maintain vendor audit scorecards and risk compliance documentation.`
  },
  {
    opaqueId: "PRIMARY_ROLE_37",
    scenario: "Founder proximity negation in regional subsidiary",
    highRiskStressDimension: "FOUNDER_CEO_PROXIMITY",
    rawText: `REGIONAL COMMERCIAL OPERATIONS HEAD - INDIA
Company: Nordic Wind Energy Systems (India Pvt Ltd)
Location: Chennai, India (On-site)

ROLE OVERVIEW:
Lead commercial operations, grid tender submissions, and contract tracking for Nordic Wind's subsidiary in India.

GOVERNANCE AND REPORTING ALIGNMENT:
This position reports to the Managing Director of India Operations.
FOUNDER INTERACTION BOUNDARY: Nordic Wind Energy Systems was founded in Denmark in 1982. The founders have exited operational leadership, and there is zero direct interaction or alignment with company founders. Furthermore, all strategic escalations are resolved through the APAC regional committee, with no direct access to the European Global CEO.

ESSENTIAL DUTIES:
- Coordinate tender preparation for state electricity board auctions.
- Track milestone billings and performance bank guarantee releases.
- Ensure compliance with central renewable energy regulatory guidelines.`
  },
  {
    opaqueId: "PRIMARY_ROLE_38",
    scenario: "Work condition / contract duration and travel boundaries",
    highRiskStressDimension: "WORK_CONDITION",
    rawText: `INTERIM PROGRAM DIRECTOR - SAP S/4HANA MIGRATION
Company: Titan Manufacturing Conglomerate
Location: Bengaluru, India (On-site)

ENGAGEMENT TERMS AND CONSTRAINTS:
- Term: Fixed-term 8-month independent contract engagement.
- Location: 100% on-site at the Peenya Corporate Office in Bengaluru.
- Travel Policy: Zero international travel is permitted or required under this project scope. Domestic travel between manufacturing plants in Hosur and Pune is limited to scheduled quarterly cutovers.
- Employment Status: Independent professional contractor; not eligible for standard corporate executive employee stock options or annual bonus schemes.

RESPONSIBILITIES:
- Direct system integrator workstreams to ensure on-time delivery of SAP S/4HANA cutover.
- Coordinate data migration validation across finance, supply chain, and plant maintenance modules.`
  },
  {
    opaqueId: "PRIMARY_ROLE_39",
    scenario: "Recruiting process and interview stages",
    highRiskStressDimension: "RECRUITING_PROCESS",
    rawText: `EXECUTIVE RECRUITMENT SPECIFICATION: VP DATA SCIENCE
Company: FinEdge Analytics India
Location: Gurugram, India (Hybrid)

HIRING PROCESS & PROTOCOL:
Stage 1: Initial 45-minute confidential telephone interview with Talent Acquisition Partner.
Stage 2: 60-minute technical architecture discussion with Chief Data Officer.
Stage 3: Offline executive case study presentation (take-home strategic brief evaluating credit default predictive modeling).
Stage 4: Culture and leadership panel with Managing Director and HR Head.
Background Verification: Candidate must provide 3 professional reference contacts from previous direct managers prior to offer issuance.

ROLE HIGHLIGHT:
Direct the 25-person quantitative modeling team building machine learning scoring engines for micro-lending products.`
  },
  {
    opaqueId: "PRIMARY_ROLE_40",
    scenario: "People scale distortion (Massive company size, small team scope)",
    highRiskStressDimension: "PEOPLE_SCALE",
    rawText: `DIRECTOR OF INTERNAL COMMUNICATIONS
Company: Tata Global Enterprises
Location: Mumbai, India (On-site)

ORGANIZATIONAL CONTEXT:
Tata Global Enterprises operates across 85 countries with over 600,000 employees globally.

TEAM SIZE & SUPERVISORY SPAN:
Within this enterprise, the Director of Internal Communications leads a focused central editorial team of 4 direct reports (2 Senior Copywriters, 1 Multimedia Specialist, 1 Intranet Content Administrator).
Candidates should not conflate total enterprise employee scale (600k) with direct departmental span of control (4 FTEs).

DUTIES:
- Author executive town hall talking points and quarterly employee newsletters.
- Manage leadership communication distribution lists and internal intranet portal announcements.`
  },
  {
    opaqueId: "PRIMARY_ROLE_41",
    scenario: "Profitability accountability negation (Top-line focus only)",
    highRiskStressDimension: "PROFITABILITY_ACCOUNTABILITY",
    rawText: `VICE PRESIDENT - USER ACQUISITION & GROWTH
Company: QuickRide Mobility
Location: Bengaluru, India (Hybrid)

MANDATE:
Aggressively accelerate monthly active rider acquisitions across Tier-1 and Tier-2 Indian metropolitan markets.

FINANCIAL ACCOUNTABILITY DIVISION:
The VP of User Acquisition is evaluated solely on gross registered user volume, CAC efficiency, and ride conversion rates.
PROFITABILITY EXCLUSION: Unit margin economics, fleet maintenance profitability, and overall corporate EBITDA targets are managed by the Chief Financial Officer and COO. This role does not hold gross margin, net margin, or profitability accountability.

KEY TARGETS:
- Scale monthly active riders from 2.5M to 5.0M within 12 months.
- Maintain blended CAC below ₹180 across paid digital search and referral channels.`
  },
  {
    opaqueId: "PRIMARY_ROLE_42",
    scenario: "Governance / Board exposure negation",
    highRiskStressDimension: "BOARD_EXPOSURE",
    rawText: `HEAD OF FINANCIAL PLANNING & ANALYSIS (FP&A)
Company: HealthSpring Diagnostics
Location: Hyderabad, India (Hybrid)

ROLE RESPONSIBILITIES:
- Consolidate monthly management information system (MIS) reports for internal business heads.
- Model annual financial budgets and scenario analyses for diagnostic centers.
- Partner with accounting teams during monthly ledger closings.

GOVERNANCE EXCLUSION:
This position reports directly to the Vice President of Finance.
BOARD INTERFACE LIMITATION: The Head of FP&A does not attend meetings of the Board of Directors, does not present to the Audit Committee, and has no direct exposure to external board members. All board presentations are delivered exclusively by the Chief Financial Officer.`
  },
  {
    opaqueId: "PRIMARY_ROLE_43",
    scenario: "Decision authority negation (Advisory only; decision rests with CMO)",
    highRiskStressDimension: "DECISION_AUTHORITY",
    rawText: `SENIOR MEDIA PLANNING LEAD
Company: FMCG Brands Consolidated
Location: New Delhi, India (On-site)

SCOPE OF WORK:
Analyze audience reach, TRP metrics, and digital impression share to formulate annual media planning recommendations.

AUTHORITY BOUNDARY:
This is an advisory and analytical position. The Senior Media Planning Lead formulates media mix recommendations and presents optimization options.
FINAL SIGN-OFF: The role does NOT hold authority to execute media contracts, sign insertion orders, or finalize agency fee schedules. All binding media spend and commitments are approved solely by the Chief Marketing Officer.`
  },
  {
    opaqueId: "PRIMARY_ROLE_44",
    scenario: "Greenfield vs Brownfield (Maintenance only, no zero-to-one build)",
    highRiskStressDimension: "GREENFIELD_BUILD",
    rawText: `DIRECTOR OF CORE APPLICATIONS & SUSTENANCE ENGINEERING
Company: LegacyCore Banking Software
Location: Chennai, India (On-site)

ENGINEERING MANDATE:
Maintain, patch, and support our core COBOL/Java banking platform installed across 40 regional rural banks.

SCOPE BOUNDARY:
This is a legacy sustenance and maintenance mandate. This role does NOT involve greenfield architecture, zero-to-one platform builds, or next-generation product innovation. All engineering activity focuses strictly on regulatory compliance updates, defect remediation, and batch job stabilization.`
  },
  {
    opaqueId: "PRIMARY_ROLE_45",
    scenario: "Commercial accountability negation (Technical pre-sales only)",
    highRiskStressDimension: "COMMERCIAL_ACCOUNTABILITY",
    rawText: `HEAD OF PRE-SALES SOLUTIONS ARCHITECTURE
Company: CyberShield Enterprise Security
Location: Gurugram, India (Hybrid)

FUNCTION:
Lead a team of 8 Solutions Architects providing deep technical architecture validation, threat vector simulations, and POC demonstrations to prospective enterprise clients.

COMMERCIAL EXCLUSION:
This is an entirely technical pre-sales engineering role. The Head of Solutions Architecture does NOT carry sales quota, does not negotiate commercial pricing terms, and does not hold contract closing responsibility. Commercial quota and deal revenue accountability belong exclusively to the Regional Sales Directors.`
  },
  {
    opaqueId: "PRIMARY_ROLE_46",
    scenario: "Channel scope negation (Organic SEO only, paid channels excluded)",
    highRiskStressDimension: "CHANNEL_SCOPE",
    rawText: `HEAD OF ORGANIC SEARCH & SEO
Company: IndiaMart Retail Directory
Location: Noida, India (On-site)

CHANNEL RESPONSIBILITY:
Take full ownership of technical SEO, internal link architecture, site speed optimization, and programmatic content indexing across 15M product listing URLs.

EXCLUSIONS:
Performance paid marketing (Google Ads, Meta Ads), affiliate advertising networks, influencer collaborations, and offline television campaigns are managed by separate specialist directors and are completely outside this role's mandate.`
  },
  {
    opaqueId: "PRIMARY_ROLE_47",
    scenario: "Geographic territory restriction",
    highRiskStressDimension: "GEOGRAPHIC_SCOPE",
    rawText: `REGIONAL LOGISTICS DIRECTOR - SOUTH ZONE
Company: FastTrack Express Courier
Location: Bengaluru, India (On-site)

TERRITORY MANDATE:
Manage line-haul logistics, sorting hubs, and last-mile delivery networks exclusively within the Southern Indian States (Karnataka, Tamil Nadu, Kerala, Andhra Pradesh, and Telangana).

GEOGRAPHIC BOUNDARY:
North, East, and Western logistics corridors, as well as cross-border international freight operations, are managed by regional counterparts and fall entirely outside this role's purview.`
  },
  {
    opaqueId: "PRIMARY_ROLE_48",
    scenario: "Conditional equity grant requiring Board remuneration committee approval",
    highRiskStressDimension: "WORK_CONDITION",
    rawText: `VP PRODUCT MANAGEMENT - WEALTH TECH
Company: FinGrow Asset Platforms
Location: Mumbai, India (Hybrid)

COMPENSATION STRUCTURE:
- Fixed Annual Gross Salary: ₹75,00,000 per annum.
- Performance Bonus: Up to 25% based on annual KPI achievement.
- EQUITY CONDITION: A proposed grant of 15,000 Employee Stock Options is subject to formal evaluation and affirmative approval by the Board Nomination and Remuneration Committee at the Q3 board meeting. The grant is not guaranteed upon signing.`
  },
  {
    opaqueId: "PRIMARY_ROLE_49",
    scenario: "Structural repetition and noise (Testing proposal deduplication)",
    highRiskStressDimension: "RESPONSIBILITY",
    rawText: `CHIEF OF STAFF - OPERATIONS
Company: Apex Alpha Holdings
Location: Mumbai, India (On-site)

CORE MANDATE:
Support the Managing Director across strategic planning initiatives.
Support the Managing Director across strategic planning initiatives.
Coordinate quarterly executive performance reviews across business units.
Coordinate quarterly executive performance reviews across business units.
Track milestone progress on special enterprise projects.
Track milestone progress on special enterprise projects.`
  },
  {
    opaqueId: "PRIMARY_ROLE_50",
    scenario: "Mixed polarity complex boundaries (Positive sprint backlog vs negative HR/appraisals)",
    highRiskStressDimension: "PEOPLE_LEADERSHIP",
    rawText: `AGILE TRANSFORMATION COACH & SCRUM LEADER
Company: ZenTech Solutions
Location: Pune, India (Hybrid)

WHAT YOU WILL DO:
- Facilitate enterprise agile ceremonies, PI planning sessions, and cross-functional backlog refinement for 8 development squads.
- Train product owners and tech leads in agile velocity tracking and user story estimation.

WHAT YOU WILL NOT DO:
- You will NOT conduct annual employee performance appraisals, manage salary reviews, or handle formal disciplinary proceedings.
- You will NOT approve employee leaves or manage direct hiring pipelines. Direct people administration remains with functional chapter leads.`
  }
];

const SECONDARY_ADVERSARIAL_ROLES = [
  {
    opaqueId: "SECONDARY_ROLE_16",
    scenario: "Agency media budget management vs corporate business P&L",
    highRiskStressDimension: "PNL_OWNERSHIP",
    rawText: `GROUP MEDIA DIRECTOR
Company: Omnicom Brand Networks
Location: Gurugram, India (Hybrid)

PURPOSE:
Direct client media planning and digital ad buying across television, OTT, and programmatic networks for two Tier-1 automotive brands.
BUDGET NOTE: Manage an annual media buying budget allocation of ₹45 Cr. This represents client media billing volume; the role does not manage Omnicom's agency corporate P&L or hold company profit accountability.`
  },
  {
    opaqueId: "SECONDARY_ROLE_17",
    scenario: "Dotted-line stakeholder coordination vs direct reporting line",
    highRiskStressDimension: "REPORTING_LINE",
    rawText: `DIRECTOR OF IT CYBERSECURITY OPERATIONS
Company: Metro Rail Infrastructure Corp
Location: New Delhi, India (On-site)

REPORTING STRUCTURE:
This position reports administratively and directly to the Chief General Manager of Information Technology.
STAKEHOLDER COORDINATION: You will coordinate closely with the Chief Technology Officer on critical incident response; however, formal direct reporting, performance reviews, and salary approvals are held exclusively by the Chief General Manager of IT.`
  },
  {
    opaqueId: "SECONDARY_ROLE_18",
    scenario: "Mandatory qualification vs Preferred preference distinction",
    highRiskStressDimension: "CANDIDATE_REQUIREMENT",
    rawText: `HEAD OF ENTERPRISE SALES - CLOUD
Company: SkyLogic Platforms India
Location: Bengaluru, India (Hybrid)

MANDATORY REQUIREMENTS:
- Minimum 12 years of enterprise software sales experience in the Indian market.
- Verifiable track record of closing $1M+ ACV cloud contracts.

PREFERRED QUALIFICATIONS:
- Prior sales leadership experience in a NASDAQ-listed SaaS entity is preferred but not required.
- Engineering degree in Computer Science is advantageous.`
  },
  {
    opaqueId: "SECONDARY_ROLE_19",
    scenario: "Enterprise valuation stated vs candidate role scope",
    highRiskStressDimension: "COMPANY_CONTEXT",
    rawText: `HEAD OF DEVELOPER RELATIONS
Company: HyperChain Labs
Location: Bengaluru, India (Remote)

ABOUT HYPERCHAIN:
HyperChain is a venture-backed infrastructure protocol valued at $750M following a Series B funding round led by global tier-1 venture firms.

YOUR MISSION:
Drive developer adoption of our open-source SDK through hackathons, technical documentation, and community discord channels.
NOTE: This community engagement role carries no balance sheet or treasury management responsibilities.`
  },
  {
    opaqueId: "SECONDARY_ROLE_20",
    scenario: "Risk advisory committee seat without individual veto authority",
    highRiskStressDimension: "DECISION_AUTHORITY",
    rawText: `SENIOR RISK ADVISOR - CREDIT RISK
Company: CapitalTrust NBFC
Location: Mumbai, India (On-site)

FUNCTION:
Conduct portfolio credit risk stress tests and present delinquency trend forecasts to the Executive Credit Committee.
AUTHORITY CONSTRAINT: The Senior Risk Advisor participates as an advisory member of the committee. Final credit policy decisions, underwriting policy changes, and loan write-off approvals require the affirmative majority vote of the Credit Committee.`
  },
  {
    opaqueId: "SECONDARY_ROLE_21",
    scenario: "Technical architecture influence without direct headcount management",
    highRiskStressDimension: "PEOPLE_LEADERSHIP",
    rawText: `CHIEF ARCHITECT - DATA PLATFORMS
Company: TeleData Communications India
Location: Pune, India (Hybrid)

SCOPE:
Define end-to-end data lakehouse architectures handling 100TB+ daily telemetry ingestion across 4G/5G mobile towers.
MANAGEMENT INVARIANT: This is a top-level technical contributor appointment. You will influence architecture across 200+ engineers but will have no direct direct-line reports or administrative people management duties.`
  },
  {
    opaqueId: "SECONDARY_ROLE_22",
    scenario: "Cost center leadership vs commercial revenue generation",
    highRiskStressDimension: "REVENUE_ACCOUNTABILITY",
    rawText: `HEAD OF GLOBAL SHARED SERVICES IT
Company: Global Pharma Logistics
Location: Hyderabad, India (On-site)

OPERATIONAL MANDATE:
Lead the internal IT shared services center supporting 8,000 corporate employees worldwide with helpdesk, laptop provisioning, and ERP access administration.
FINANCIAL CLASSIFICATION: This shared service organization operates strictly as an internal cost center. The position carries zero external client revenue targets, commercial quota, or sales objectives.`
  },
  {
    opaqueId: "SECONDARY_ROLE_23",
    scenario: "Work condition - Remote policy and relocation exemption",
    highRiskStressDimension: "WORK_CONDITION",
    rawText: `VP REGULATORY AFFAIRS - MEDICAL DEVICES
Company: MedTech Innovations India
Location: India (100% Remote)

WORKING ARRANGEMENTS:
This role is 100% remote and can be executed from any location within India with high-speed internet connectivity.
RELOCATION: No relocation to corporate headquarters in Ahmedabad is required now or in the future.`
  },
  {
    opaqueId: "SECONDARY_ROLE_24",
    scenario: "Recruiting timeline and candidate assessment disclaimer",
    highRiskStressDimension: "RECRUITING_PROCESS",
    rawText: `SELECTION NOTICE - MANAGING DIRECTOR
Company: State Renewable Energy Development Agency
Location: Jaipur, India (On-site)

RECRUITMENT APPLICATION PROCEDURES:
All applications must be submitted via the official portal by 5:00 PM IST on November 15, 2026.
Incomplete applications or applications without certified degree copies will be rejected without notice.
Only shortlisted applicants will be called for the final interview with the selection panel.`
  },
  {
    opaqueId: "SECONDARY_ROLE_25",
    scenario: "Conditional product launch subject to central bank license",
    highRiskStressDimension: "CONDITIONAL_APPROVAL",
    rawText: `HEAD OF DIGITAL PAYMENTS PRODUCT
Company: NeoBank Bharat
Location: Bengaluru, India (Hybrid)

MISSION:
Lead product strategy and UX specification for NeoBank's planned UPI payment aggregator and credit line features.
REGULATORY CONDITION: Full commercial rollout of the consumer credit line feature is contingent upon receipt of the final Payment Aggregator (PA) license from the Reserve Bank of India (RBI). Initial work focuses on sandbox testing.`
  }
];

// ============================================================================
// Candidate Resumes
// ============================================================================

const PRIMARY_CANDIDATE_RESUMES = [
  {
    opaqueId: "PRIMARY_CANDIDATE_01",
    persona: "Chief Technology Officer (Enterprise Cloud & Distributed Systems)",
    rawText: `# **RAJESH NAIR**

### Chief Technology Officer | Enterprise Cloud & Distributed Systems

Bengaluru, KA • (+91) 98860 12345 • rajesh.nair@example.com • linkedin.com/in/rajeshnair-cto

## **EXECUTIVE PROFILE**

- Technology executive with 22+ years of architectural and engineering leadership building hyperscale distributed platforms, enterprise SaaS, and mission-critical cloud infrastructure.
- Track record of scaling engineering organizations from 50 to 450+ engineers while modernizing legacy monoliths into cloud-native microservices architectures.

## **CORE COMPETENCIES**

- Engineering Leadership: Global Engineering Teams (400+ FTEs), Multi-Site R&D, Technical Due Diligence
- Cloud & Infrastructure: AWS, GCP, Kubernetes, Multi-Region High Availability (99.999% SLA)
- Architecture Modernization: Event-Driven Systems, Kafka, Domain-Driven Design, Zero-Trust Security
- Budget & Governance: $35M Annual Infrastructure & Tooling Budget, FinOps Optimization

## **PROFESSIONAL EXPERIENCE**

### **Chief Technology Officer** | **CloudScale Technologies**

_Jan 2021 – Present_

- Directed global engineering and infrastructure org of 420 engineers across Bengaluru, Pune, and Seattle.
- Scaled platform throughput to 1.8 billion daily transactions while driving infrastructure unit costs down 38% through automated FinOps governance.
- Spearheaded the complete migration of core transactional database from legacy on-premises Oracle to distributed Spanner on GCP within 14 months.
- Managed an annual cloud infrastructure and engineering tooling budget of $28M with zero cost overruns.

### **VP Engineering** | **FinTech Velocity India**

_Mar 2016 – Dec 2020_

- Built the core payments and settlement engineering department from 35 to 190 engineers.
- Achieved PCI-DSS Level 1 compliance and SOC 2 Type II certification across all banking rails.
- Architected low-latency settlement engine processing $12B in annualized transaction volume with sub-25ms response time.

## **EDUCATION**

**Bachelor of Technology (B.Tech) - Computer Science** | Indian Institute of Technology (IIT) Madras

_2002_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_02",
    persona: "Chief Marketing Officer (B2C FinTech & Consumer Tech)",
    rawText: `# **PRIYA SHARMA**

### Chief Marketing Officer | B2C FinTech & Digital Growth

Mumbai, MH • (+91) 98200 54321 • priya.sharma@example.com • linkedin.com/in/priyasharma-cmo

## **EXECUTIVE PROFILE**

- High-impact Chief Marketing Officer with 19 years of consumer marketing, brand positioning, and full-funnel digital acquisition experience across consumer technology and digital payments.
- Proven capability in scaling user bases from 2M to 35M Monthly Active Users (MAU) while optimizing blended Customer Acquisition Cost (CAC) and driving top-of-mind brand equity.

## **CORE COMPETENCIES**

- Brand Strategy & Creative Direction: 360-Degree Brand Campaigns, Celebrity Endorsement, IPL Sponsorships
- Performance & Growth Marketing: Multi-Channel Digital Acquisition, App Store Optimization (ASO), Retention Funnels
- Budget Management: ₹120 Cr Annual Marketing Budget, Media Buying & Agency Management
- Executive Leadership: 65-member marketing organization, Agency Ecosystem Governance

## **PROFESSIONAL EXPERIENCE**

### **Chief Marketing Officer** | **PayZen Digital Payments**

_May 2021 – Present_

- Steered brand architecture and user acquisition strategy across India, growing MAU from 8M to 32M over a 3-year period.
- Governed an annual marketing and media expenditure budget of ₹110 Cr across television, digital, and outdoor media.
- Conceptualized and launched the national "Paisa Fast" brand campaign during ICC Cricket World Cup, lifting unprompted brand recall by 44%.
- Led a 55-person multidisciplinary team across brand, growth, PR, creative production, and customer research.

### **VP Marketing** | **ShopEase Commerce**

_Aug 2017 – Apr 2021_

- Scaled gross merchandise value (GMV) attributed to marketing campaigns from ₹400 Cr to ₹1,800 Cr.
- Compressed customer acquisition cost by 32% via automated programmatic bidding and regional language creative localization.
- Managed mainline creative agencies, digital performance agencies, and a 28-member internal creative studio.

## **EDUCATION**

**Post Graduate Diploma in Management (PGDM) - Marketing** | Indian Institute of Management (IIM) Calcutta

_2005_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_03",
    persona: "Chief Financial Officer (Public Listed Conglomerate & IPO)",
    rawText: `# **VIKRAM MALHOTRA**

### Chief Financial Officer | Capital Markets, M&A & Corporate Governance

New Delhi, DL • (+91) 98110 99887 • vikram.malhotra@example.com • linkedin.com/in/vikrammalhotra-cfo

## **EXECUTIVE PROFILE**

- Strategic finance leader and Chartered Accountant with 24 years of corporate finance, capital allocation, and governance leadership across manufacturing, infrastructure, and consumer goods.
- Successfully led a ₹2,800 Cr Initial Public Offering (IPO) on NSE/BSE and orchestrated over $650M in syndicated debt refinancing and cross-border M&A transactions.

## **CORE COMPETENCIES**

- Capital Markets: IPO Execution, Institutional Investor Relations, Debt Syndication, Credit Rating Enhancements
- Corporate Governance: Board Reporting, Audit Committee Liaison, Statutory Compliance, Internal Controls
- Financial Planning & P&L: Enterprise P&L Oversight (₹4,500 Cr), Working Capital Optimization
- Executive Team Leadership: 80-member finance, tax, treasury, and secretarial organization

## **PROFESSIONAL EXPERIENCE**

### **Chief Financial Officer** | **Apex Industrial Conglomerate**

_Jul 2019 – Present_

- Accountable for enterprise financial health, treasury, and tax strategy across a ₹4,200 Cr revenue manufacturing enterprise.
- Led the successful ₹2,800 Cr IPO on NSE and BSE, achieving 18x subscription across institutional and retail tranches.
- Reduced weighted average cost of debt from 9.4% to 7.8% through syndicated debt restructuring and credit rating upgrade to AA+.
- Present quarterly financial performance and risk disclosures directly to the Board of Directors and Audit Committee.

### **VP Finance & Treasury** | **Lumina Energy Systems**

_Nov 2013 – Jun 2019_

- Managed corporate treasury portfolio of ₹950 Cr and structured $320M in external commercial borrowings (ECB).
- Implemented SAP S/4HANA Finance across 12 manufacturing operating units within 18 months.

## **EDUCATION**

**Fellow Chartered Accountant (FCA)** | Institute of Chartered Accountants of India (ICAI)

_2000_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_04",
    persona: "Chief Product Officer (B2B SaaS & AI Products)",
    rawText: `# **ANANYA SENGUPTA**

### Chief Product Officer | Enterprise SaaS, AI & Product-Led Growth

Bengaluru, KA • (+91) 99001 23456 • ananya.s@example.com • linkedin.com/in/ananyasengupta-cpo

## **EXECUTIVE PROFILE**

- Visionary product leader with 18+ years building enterprise SaaS platforms, AI-native workflows, and self-serve PLG engines for Fortune 500 customers.
- Delivered 4.2x ARR expansion from $15M to $65M through disciplined product portfolio strategy, customer discovery, and frictionless onboarding.

## **CORE COMPETENCIES**

- Product Strategy: Product-Led Growth (PLG), Enterprise Roadmapping, Pricing & Packaging Strategy
- AI Innovation: Generative AI Assistant Integration, Agentic Automation, Predictive Analytics
- Product Operations: Cross-Functional Team Leadership (45 PMs & Designers), Agile Cadence
- Commercial Impact: Net Revenue Retention (NRR) Optimization (124%), Churn Compression

## **PROFESSIONAL EXPERIENCE**

### **Chief Product Officer** | **DataVerse Software**

_Feb 2021 – Present_

- Direct product vision, UX design, and product analytics across 5 product lines generating $62M ARR.
- Built and scaled a high-performing product management and UX research team of 42 professionals.
- Launched the flagship AI Copilot product line within 9 months, generating $8.5M in net new ARR in its first year.
- Improved enterprise Net Revenue Retention from 104% to 122% by revamping usage-based billing tiers.

### **VP Product** | **KiteHR Technologies**

_Jun 2016 – Jan 2021_

- Led product strategy for enterprise workforce analytics platform serving 1.2M active enterprise employees.
- Spearheaded mobile app redesign that increased daily active engagement by 55% and reduced support tickets by 30%.

## **EDUCATION**

**Master of Business Administration (MBA)** | Indian School of Business (ISB), Hyderabad

_2006_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_05",
    persona: "Chief Operating Officer (Quick Commerce & Omnichannel Supply Chain)",
    rawText: `# **AMITAV MUKHERJEE**

### Chief Operating Officer | Quick Commerce & Omnichannel Supply Chain

Gurugram, HR • (+91) 98105 67890 • amitav.m@example.com • linkedin.com/in/amitav-mukherjee-coo

## **EXECUTIVE PROFILE**

- Operations executive with 21 years of experience designing and scaling high-velocity supply chain networks, dark store fulfillment networks, and last-mile delivery fleets across India.
- Managed 14,000+ delivery partners and 280 fulfillment micro-warehouses delivering 450,000 orders daily with 98.4% on-time SLA compliance.

## **CORE COMPETENCIES**

- High-Velocity Fulfillment: Dark Store Network Planning, Micro-Fulfillment Operations, Fleet Management
- Operations P&L: ₹650 Cr Annual Operations Budget, Unit Economics & Delivery Cost Compression
- Safety & Compliance: Gig Workforce Welfare, Labor Compliance, Cold Chain Governance
- Scale Leadership: 180 corporate operations managers and 12,000+ logistics field partners

## **PROFESSIONAL EXPERIENCE**

### **Chief Operating Officer** | **SwiftBlink Retail**

_Mar 2022 – Present_

- Lead end-to-end national warehousing, dark store fulfillment, and 10-minute delivery fleet across 18 metro cities.
- Scaled active dark store count from 65 to 310 hubs while reducing average order picking time from 3.8 minutes to 1.9 minutes.
- Compressed last-mile cost per order by 24% through dynamic route bundling and algorithmic courier dispatch.
- Accountable for an annual operational expenditure budget of ₹480 Cr with direct P&L responsibility for fulfillment unit economics.

### **VP Operations** | **MetroLogix Express**

_Jan 2017 – Feb 2022_

- Supervised 14 regional distribution centers and 45 hub facilities covering 1,800 pin codes across North and Western India.
- Implemented warehouse management automation (WMS) that decreased inventory shrinkage by 65%.

## **EDUCATION**

**B.Tech - Production Engineering** | National Institute of Technology (NIT) Rourkela

_2003_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_06",
    persona: "Chief Revenue Officer (Enterprise B2B Software & APAC Expansion)",
    rawText: `# **SUNITA RAO**

### Chief Revenue Officer | Global Enterprise Software Sales & APAC Expansion

Singapore & Bengaluru • (+65) 9123 4567 • sunita.rao@example.com • linkedin.com/in/sunita-rao-cro

## **EXECUTIVE PROFILE**

- Global Chief Revenue Officer with 20 years of verifiable enterprise sales leadership selling complex cloud, security, and data platforms across APAC and North American markets.
- Consistently exceeded annual quotas, scaling sales organizations from $10M to $120M in Annual Contract Value (ACV).

## **CORE COMPETENCIES**

- Revenue Leadership: Direct Sales Quota ($95M ARR), GTM Strategy, Solution Selling, Channel Partnerships
- Deal Execution: Mega-Deal Structuring ($5M+ TCV contracts with Tier-1 banks and telcos)
- Organization Building: 110-person global sales team (Enterprise AEs, SDRs, Pre-Sales, Sales Ops)
- Revenue Operations: Sales Pipeline Forecasting, Salesforce CRM Hygiene, Compensation Plans

## **PROFESSIONAL EXPERIENCE**

### **Chief Revenue Officer** | **SecureNet Cloud Systems**

_Apr 2021 – Present_

- Lead global sales, solution architecture, customer success, and strategic partner alliances across APAC and US markets.
- Delivered 210% sales quota achievement in FY24, expanding total ARR from $38M to $84M.
- Closed 14 multi-year enterprise contracts exceeding $3.5M TCV with major financial institutions across Singapore, India, and Australia.
- Built the enterprise field sales team from 25 to 85 sales executives across 6 international regional offices.

### **VP Sales - APAC** | **CloudCore Technologies**

_Jul 2015 – Mar 2021_

- Established the APAC enterprise sales organization, scaling annual bookings from $4M to $32M within five years.
- Forged strategic distribution partnerships with Wipro, TCS, and NTT Data, generating 40% of regional pipeline.

## **EDUCATION**

**MBA - International Business** | Indian Institute of Foreign Trade (IIFT), New Delhi

_2004_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_07",
    persona: "Chief People Officer / CHRO (Global Capability Center 8,000+ FTEs)",
    rawText: `# **DEEPAK VERMA**

### Chief Human Resources Officer | Global Capability Centers (GCC) & Talent Transformation

Hyderabad, TS • (+91) 98490 11223 • deepak.verma@example.com • linkedin.com/in/deepakverma-chro

## **EXECUTIVE PROFILE**

- Strategic HR executive with 23 years of experience leading human capital strategy, executive compensation, and talent transformation across multinational GCCs and technology conglomerates.
- Successfully led hyper-growth hiring scaling an offshore capability center from 1,200 to 8,500 employees while reducing 90-day attrition from 22% to 9%.

## **CORE COMPETENCIES**

- Global Talent Strategy: Mass Tech Hiring, Leadership Succession Planning, Diversity & Inclusion (42% women in tech)
- HR Governance & Policy: Statutory Labor Compliance, Board Nomination & Remuneration Committee Liaison
- Organization Design: Capability Frameworks, Role Taxonomy, Performance Management Systems
- Executive HR Leadership: 95-person HR organization across talent acquisition, HRBPs, and shared services

## **PROFESSIONAL EXPERIENCE**

### **Chief Human Resources Officer** | **Novus Global Technology Center (India)**

_Oct 2020 – Present_

- Direct human resources, total rewards, and employer branding for an 8,200-employee global capability center.
- Scaled tech workforce by 3,400 engineers in 24 months across AI, cloud engineering, and cybersecurity domains.
- Designed comprehensive executive retention plan with restricted stock units (RSUs), compressing VP attrition to under 4%.
- Partner with US parent corporate board on global succession planning and workplace culture alignment.

### **Head of HR - India Operations** | **Apex Financial Services GCC**

_May 2014 – Sep 2020_

- Managed human capital operations for 4,500 banking operations and technology employees across Hyderabad and Bengaluru.
- Won "Best Employer Brand India" for three consecutive years (2018-2020).

## **EDUCATION**

**Master of Arts (MA) - Personnel Management & Industrial Relations** | Tata Institute of Social Sciences (TISS), Mumbai

_2001_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_08",
    persona: "General Counsel & VP Compliance (Fintech & Banking Regulatory)",
    rawText: `# **KAVITA KRISHNAN**

### General Counsel & VP Compliance | FinTech Regulations, Data Privacy & Corporate Law

Mumbai, MH • (+91) 98210 88776 • kavita.k@example.com • linkedin.com/in/kavitakrishnan-legal

## **EXECUTIVE PROFILE**

- Chief Legal Officer and General Counsel with 20+ years of expertise in banking law, RBI regulatory compliance, data protection (DPDP Act), cross-border contracts, and corporate litigation.
- Successfully secured RBI Non-Banking Financial Company (NBFC) license and Payment Aggregator (PA) authorization for leading fintech entities.

## **CORE COMPETENCIES**

- Regulatory Engagement: RBI, SEBI, IRDAI Regulatory Approvals, Sandbox Clearances, Policy Submissions
- Corporate Transactions: Venture Capital Series B/C/D Funding Documentation, Joint Ventures, Shareholder Agreements
- Data Privacy & Security: Digital Personal Data Protection Act compliance, GDPR, Cross-Border Data Flows
- Team Leadership: 22-lawyer in-house corporate legal department and panel law firm governance

## **PROFESSIONAL EXPERIENCE**

### **General Counsel & Head of Compliance** | **FinPrime Financial Technologies**

_Jan 2021 – Present_

- Advise the Board and CEO on all regulatory, licensing, governance, and transactional matters.
- Secured full RBI Payment Aggregator (PA) license and in-principle NBFC Account Aggregator registration.
- Drafted and negotiated enterprise white-label credit and banking partnerships with State Bank of India and ICICI Bank.
- Defended company interests across commercial disputes with 100% favorable settlement or dismissal record.

### **VP Legal** | **PaySmart Digital Solutions**

_Aug 2015 – Dec 2020_

- Led in-house legal team of 14 corporate counsels managing merchant agreements, IP trademarks, and consumer litigation.
- Structured $180M Series C and Series D equity financing documentation with global venture capital syndicates.

## **EDUCATION**

**Bachelor of Laws (LL.B)** | National Law School of India University (NLSIU), Bengaluru

_2003_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_09",
    persona: "Chief Information Security Officer (Cybersecurity & Banking)",
    rawText: `# **ARVIND SUBRAMANIAN**

### Chief Information Security Officer | Enterprise Cybersecurity, Cloud Sec & SOC Operations

Chennai, TN • (+91) 98400 33445 • arvind.subramanian@example.com • linkedin.com/in/arvind-ciso

## **EXECUTIVE PROFILE**

- CISO with 21 years of information security leadership in commercial banking, digital payments, and cloud security architectures.
- Built and commanded 24/7 Security Operations Centers (SOC) defending assets handling $25B in annual financial transactions.

## **CORE COMPETENCIES**

- Information Security: ISO 27001, SOC 2 Type II, RBI Cybersecurity Framework, NIST Cybersecurity Framework
- SOC Operations: SIEM/SOAR Automation, Incident Response, Threat Intelligence, Penetration Testing
- Cloud Security: Zero Trust Architecture, IAM Governance, DevSecOps CI/CD Pipelines, Kubernetes Security
- Budget & Risk Management: $14M Security Budget, Cyber Insurance, Executive Risk Reporting

## **PROFESSIONAL EXPERIENCE**

### **Chief Information Security Officer** | **Bharat Commercial Bank**

_Jun 2020 – Present_

- Accountable for all cyber defense, application security, identity governance, and regulatory compliance across 600 branches and mobile banking platforms.
- Managed a 45-member internal security engineering team and 24/7 managed detection SOC provider.
- Defended against 1.2M automated daily cyber threats with zero data breaches or ransomware compromises.
- Report cyber risk metrics and threat posture quarterly to the Board Information Technology Strategy Committee.

### **Head of Cybersecurity** | **SafePay Systems India**

_Sep 2014 – May 2020_

- Established security operations for high-velocity payment gateway processing 15M transactions per month.
- Achieved PCI-DSS 3.2.1 certification with zero non-conformity findings over five consecutive annual audits.

## **EDUCATION**

**B.E. - Electronics and Communication** | College of Engineering, Guindy (Anna University)

_2002_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_10",
    persona: "VP Growth & Performance Marketing (D2C E-commerce & Mobile App)",
    rawText: `# **MEERA JOSHI**

### VP Growth & Performance Marketing | D2C Scale, Mobile User Acquisition & MarTech

Bengaluru, KA • (+91) 99800 66778 • meera.joshi@example.com • linkedin.com/in/meerajoshi-growth

## **EXECUTIVE PROFILE**

- Analytical Growth and Performance Marketing VP with 16 years of experience driving D2C revenue, mobile app downloads, and consumer lifetime value (LTV) across consumer retail and beauty brands.
- Scaled annual brand D2C revenue from ₹30 Cr to ₹240 Cr while maintaining blended ROAS of 3.8x on paid channels.

## **CORE COMPETENCIES**

- Growth Architecture: Full-Funnel Paid Search/Social, Google Ads, Meta Ads, TikTok/Reels Performance
- MarTech & CDP: AppsFlyer, Clevertap, Segment, GA4 Attribution Modeling, A/B Experimentation
- Unit Economics: CAC Optimization, LTV:CAC Ratio Management (4.2x), Cohort Repeat Rate Expansion
- Team Leadership: 35 performance marketers, data analysts, and conversion rate optimization (CRO) engineers

## **PROFESSIONAL EXPERIENCE**

### **VP Growth & Digital Marketing** | **PureGlow D2C Brands**

_Nov 2020 – Present_

- Steered performance acquisition and retention marketing across 4 consumer personal care brand websites and mobile apps.
- Managed an annual digital performance media budget of ₹52 Cr across Google, Meta, Amazon Ads, and Quick Commerce ads.
- Increased monthly active app purchasers from 85,000 to 650,000 through aggressive influencer whitelisting and dynamic creative testing.
- Improved 90-day repeat purchase rate from 18% to 34% by deploying personalized automated WhatsApp lifecycle journeys.

### **Head of Performance Marketing** | **StyleKart Online**

_Jan 2016 – Oct 2020_

- Scaled digital paid media spend profitably from ₹80L/month to ₹3.5 Cr/month while maintaining 4.1x return on ad spend.
- Pioneered early programmatic display campaigns and attribution modeling across web and app channels.

## **EDUCATION**

**Post Graduate Certificate in Digital Marketing** | MICA, Ahmedabad

_2008_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_11",
    persona: "VP Corporate Strategy & M&A (Private Equity & Tech Conglomerates)",
    rawText: `# **ROHAN DESHMUKH**

### VP Corporate Strategy & M&A | Strategic Investments, Due Diligence & Portfolio Growth

Mumbai, MH • (+91) 98205 11990 • rohan.d@example.com • linkedin.com/in/rohandeshmukh-strategy

## **EXECUTIVE PROFILE**

- Corporate Strategy and M&A executive with 17 years of experience advising CXOs, private equity partners, and boards on growth capital deployment, joint ventures, and post-merger integration.
- Evaluated 150+ acquisition targets and closed 8 strategic buyouts totaling $420M in transaction enterprise value.

## **CORE COMPETENCIES**

- Corporate Strategy: 5-Year Strategic Horizons, Market Entry Scenarios, Synergies Modeling
- M&A Execution: Commercial Due Diligence, Valuation (DCF, Multiples), Share Purchase Agreements (SPA)
- Post-Merger Integration (PMI): 100-Day Value Creation Plans, Technology & Team Harmonization
- Stakeholder Management: Private Equity Sponsors, C-Suite Alignment, Investment Committees

## **PROFESSIONAL EXPERIENCE**

### **VP Corporate Strategy & Business Development** | **Equitas Tech Holdings**

_Apr 2021 – Present_

- Lead corporate strategy, inorganic expansion, and investment pipeline reporting directly to the Group CEO.
- Sourced, evaluated, and closed 4 strategic acquisitions in SaaS and logistics tech with combined deal value of $190M.
- Formulated the group's 3-year AI transformation roadmap, securing ₹150 Cr capital allocation from the Board.
- Directed cross-functional integration teams to deliver $18M in post-deal cost and revenue synergies ahead of schedule.

### **Associate Director - Strategy & M&A** | **Deloitte Corporate Finance**

_May 2015 – Mar 2021_

- Led commercial due diligence and transaction advisory engagements for private equity funds across India and Southeast Asia.
- Managed teams of 12 consultants on strategic market assessments and synergy realizations.

## **EDUCATION**

**MBA - Finance & Strategy** | Indian Institute of Management (IIM) Bangalore

_2007_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_12",
    persona: "Country Managing Director (Multinational Technology GCC India)",
    rawText: `# **SHWETA BANSAL**

### Country Managing Director | Multinational Technology GCC, Offshore Scaling & Operations

Bengaluru, KA • (+91) 99450 77889 • shweta.bansal@example.com • linkedin.com/in/shwetabansal-md

## **EXECUTIVE PROFILE**

- Executive leader with 23 years of multinational operations experience establishing, scaling, and managing Global Capability Centers (GCC) for Fortune 100 enterprise software organizations.
- Spearheaded the complete build-out of a 3,000-person India engineering and shared services organization, delivering $65M in annual operational efficiencies.

## **CORE COMPETENCIES**

- GCC Executive Leadership: Entity Incorporation, Statutory Regulatory Filings (STPI/SEZ), P&L Governance
- Scale & Operations: 3,000+ FTE operations across R&D, Cybersecurity, Customer Support, and Finance
- Global Alignment: Liaison with Global Board & US Executive Leadership Team
- People & Culture: Employee Engagement (Top 10 Great Place to Work), Executive Succession

## **PROFESSIONAL EXPERIENCE**

### **Managing Director - India Operations** | **Synergy Global Software Inc.**

_Jan 2019 – Present_

- Overall legal, operational, and commercial P&L accountability for Synergy's India entity spanning 3,200 employees across Bengaluru and Hyderabad.
- Built the engineering center from 450 to 3,200 FTEs while migrating core product ownership to India R&D teams.
- Governed an annual operating budget of ₹450 Cr ($55M) with 100% statutory compliance across RBI, Tax, and Labor regulations.
- Serve as the statutory resident director on the board of Synergy Software India Pvt Ltd.

### **Senior Director - Operations & GCC Build** | **Veritas Global Centers**

_Aug 2012 – Dec 2018_

- Led facilities expansion, talent acquisition, and vendor management across 3 technology centers in India.
- Managed 1,200 shared services staff supporting global finance and HR operations.

## **EDUCATION**

**B.E. - Mechanical Engineering** | Delhi College of Engineering (DCE)

_2001_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_13",
    persona: "Chief Digital Officer (Automotive & Manufacturing Transformation)",
    rawText: `# **SIDDHARTH KAPOOR**

### Chief Digital Officer | Industrial IoT, Smart Manufacturing & Digital Transformation

Pune, MH • (+91) 98900 12389 • siddharth.k@example.com • linkedin.com/in/siddharthkapoor-cdo

## **EXECUTIVE PROFILE**

- Transformational Digital and Technology Officer with 21 years of experience driving Industry 4.0, Industrial IoT, and enterprise digital transformation across automotive OEMs and discrete manufacturing conglomerates.
- Connected 12 manufacturing facilities via IoT sensors and predictive maintenance AI, increasing Overall Equipment Effectiveness (OEE) by 14% and saving ₹85 Cr in unscheduled downtime.

## **CORE COMPETENCIES**

- Digital Transformation: Industry 4.0 Architecture, Industrial IoT, Computer Vision for Quality Inspection
- Enterprise Platforms: SAP S/4HANA Manufacturing, Siemens Teamcenter PLM, MES Integration
- Technology Investment Governance: ₹140 Cr Digital Transformation Budget, Vendor Ecosystem
- Cross-Functional Leadership: 85 digital product managers, IoT engineers, and data scientists

## **PROFESSIONAL EXPERIENCE**

### **Chief Digital Officer** | **Mahindra Auto & Mobility Components**

_Sep 2020 – Present_

- Lead corporate digital transformation strategy, shop-floor automation, and connected vehicle platform engineering across 14 manufacturing plants.
- Spearheaded the deployment of edge-AI computer vision for automated paint defect detection, reducing warranty claims by 28%.
- Built the connected vehicle telematics cloud platform supporting 250,000 active electric commercial vehicles on road.
- Manage an annual digital capital expenditure budget of ₹90 Cr with direct reporting to the Group Executive Director.

### **Head of Digital Manufacturing** | **Tata Motors Industrial Systems**

_Apr 2014 – Aug 2020_

- Led enterprise MES rollout and robotic process automation across stamping and assembly lines.
- Established the Industrial Data Analytics Lab to optimize foundry scrap rates, saving ₹22 Cr annually.

## **EDUCATION**

**B.Tech - Electrical Engineering** | Indian Institute of Technology (IIT) Roorkee

_2003_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_14",
    persona: "VP Supply Chain & Strategic Sourcing (Consumer Electronics & Retail)",
    rawText: `# **POOJA HEGDE**

### VP Supply Chain & Strategic Sourcing | Global Procurement, Vendor Development & Logistics

Bengaluru, KA • (+91) 98865 44332 • pooja.hegde@example.com • linkedin.com/in/poojahegde-supplychain

## **EXECUTIVE PROFILE**

- Supply Chain and Procurement executive with 20 years of experience managing direct material sourcing, contract manufacturing, import-export customs, and global supply networks for consumer electronics and retail brands.
- Managed $350M in annual direct and indirect material spend with suppliers across India, Taiwan, Vietnam, and China.

## **CORE COMPETENCIES**

- Strategic Sourcing: Component Procurement, Supplier Risk Auditing, Dual-Source Vendor Strategies
- Contract Manufacturing: EMS Partner Management (Foxconn, Dixon), SMT Yield Optimization
- Logistics & Customs: Cross-Border Freight, Free Trade Agreements (FTA), Customs Bonded Warehousing
- Team Management: 45 procurement managers, quality auditors, and logistics planners

## **PROFESSIONAL EXPERIENCE**

### **VP Supply Chain & Procurement** | **Volt Consumer Electronics India**

_May 2020 – Present_

- Full end-to-end responsibility for direct component sourcing, inventory planning, and EMS manufacturing partner delivery for smartphone and smart TV product lines.
- Negotiated semiconductor and display panel contracts totaling $240M annually, securing 8.5% price reductions amid global supply crunches.
- Transferred 30% of critical component assembly from overseas suppliers to local Indian PLI-approved manufacturing partners within 18 months.
- Reduced supply chain inventory holding days from 65 days to 38 days through localized vendor hub replenishment models.

### **Director - Strategic Procurement** | **Samsung India Electronics**

_Feb 2013 – Apr 2020_

- Managed $180M procurement book for passive electronics, plastics, and PCB components for home appliance factories.
- Audited 85 Tier-1 supplier facilities annually to enforce quality and labor compliance standards.

## **EDUCATION**

**B.E. - Industrial Engineering** | RV College of Engineering, Bengaluru

_2004_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_15",
    persona: "Chief Data & AI Officer (Financial Services & Predictive Analytics)",
    rawText: `# **NITIN AGRAWAL**

### Chief Data & AI Officer | Enterprise Data Platforms, LLM Engineering & Predictive Risk

Gurugram, HR • (+91) 98180 55667 • nitin.agrawal@example.com • linkedin.com/in/nitinagrawal-cdo

## **EXECUTIVE PROFILE**

- Data and Artificial Intelligence executive with 19 years of leadership delivering data architectures, machine learning platforms, and generative AI applications for commercial banking and financial services.
- Architected unified enterprise data lakehouse processing 4 billion events daily, powering automated credit underwriting models approving ₹1,200 Cr in monthly consumer disbursements.

## **CORE COMPETENCIES**

- Data & AI Strategy: Enterprise Lakehouse (Snowflake, Databricks), Real-Time ML Feature Stores
- Predictive Modeling: Credit Underwriting, Fraud Detection Models, Churn Prediction, Alternative Data Scoring
- Generative AI & LLMs: Enterprise RAG Architecture, Private LLM Fine-Tuning, Guardrails & Responsible AI
- Organization Leadership: 70 data engineers, data scientists, and MLOps professionals

## **PROFESSIONAL EXPERIENCE**

### **Chief Data & AI Officer** | **OneFin Financial Corporation**

_Aug 2021 – Present_

- Lead all enterprise data governance, business intelligence, machine learning engineering, and generative AI initiatives across consumer banking operations.
- Built the automated credit decisioning engine that reduced personal loan approval turnaround time from 24 hours to 4 minutes.
- Reduced transaction fraud losses by 42% through deployment of graph neural network (GNN) fraud ring detection algorithms.
- Governed data security, DPDP regulatory compliance, and model explainability standards across 80+ production algorithms.

### **Head of Data Science & Machine Learning** | **Axis Bank Digital**

_Nov 2015 – Jul 2021_

- Led a 35-person data science team building predictive models for cross-sell recommendations and branch cash forecasting.
- Implemented real-time customer transaction categorization powering the mobile banking app for 12M users.

## **EDUCATION**

**Ph.D. in Computer Science (Machine Learning)** | Indian Institute of Technology (IIT) Delhi

_2005_`
  },
  {
    opaqueId: "PRIMARY_CANDIDATE_16",
    persona: "VP Strategic Alliances & Ecosystem (Payment Networks & FinTech)",
    rawText: `# **VANDANA MATHUR**

### VP Strategic Alliances & Ecosystem | Banking Partnerships, Co-Branded Cards & Fintech

Mumbai, MH • (+91) 98201 99001 • vandana.m@example.com • linkedin.com/in/vandanamathur-alliances

## **EXECUTIVE PROFILE**

- Strategic Alliances and Business Development leader with 18 years of experience forging high-impact commercial partnerships between major banks, payment networks (Visa, Mastercard, RuPay), and consumer internet platforms.
- Structured co-branded credit card agreements that issued over 2.5 million cards and generated ₹12,000 Cr in annual card spends.

## **CORE COMPETENCIES**

- Strategic Partnerships: Bank Co-Branded Credit Cards, Payment Gateway Ecosystems, Retail Merchant Networks
- Commercial Contracting: Multi-Year Revenue Share Agreements, Minimum Guarantees, Incentive Structuring
- Cross-Functional Leadership: Partner Operations, Legal/Compliance Negotiation, Joint Marketing Initiatives
- Executive Team Management: 20 partner directors and alliance relationship managers

## **PROFESSIONAL EXPERIENCE**

### **VP & Head of Strategic Alliances** | **CredPay Technologies India**

_Mar 2021 – Present_

- Lead enterprise partnerships with public and private sector banks, card networks, and major airlines/retailers.
- Structured and launched the flagship Co-Branded RuPay Credit Card with HDFC Bank, driving 800,000 card acquisitions in year one.
- Negotiated interchange revenue sharing terms and merchant discount rate (MDR) structures generating ₹85 Cr in high-margin partnership fee income.
- Direct a team of 18 partner managers and solution integration engineers managing 45 active banking counterparties.

### **Director - Merchant Partnerships** | **Mastercard South Asia**

_Jul 2015 – Feb 2021_

- Managed strategic relationships with top 20 e-commerce and travel merchants across India, increasing domestic network spend by 35%.
- Implemented contactless payment acceptance campaigns across 120,000 retail merchant outlets.

## **EDUCATION**

**MBA - Marketing & Strategy** | Faculty of Management Studies (FMS), Delhi University

_2006_`
  }
];

const SECONDARY_CANDIDATE_RESUMES = [
  {
    opaqueId: "SECONDARY_CANDIDATE_01",
    persona: "VP Customer Success & Enterprise Experience (Global SaaS)",
    rawText: `# **GAUTAM MEHTA**

### VP Customer Success & Enterprise Experience | B2B SaaS, Retention & NRR

Bengaluru, KA • (+91) 98450 11992 • gautam.mehta@example.com • linkedin.com/in/gautammehta-cs

## **EXECUTIVE PROFILE**

- Customer Success executive with 18 years of experience building and leading global enterprise customer onboarding, professional services, and renewal operations for B2B SaaS platforms.
- Maintained gross revenue retention above 94% and expanded Net Retention Rate (NRR) to 118% across a $75M ARR customer base.

## **CORE COMPETENCIES**

- Customer Success Management: Enterprise Onboarding, Executive QBRs, Customer Health Scoring, Churn Mitigation
- Retention Operations: Renewals Management, Upsell/Cross-sell Motion with Sales, Professional Services
- Team Leadership: 50 Customer Success Managers and Solutions Engineers across APAC, EMEA, and US
- Metric Focus: NRR (118%), Gross Retention (94%), CSAT (92%), Time-to-Value (TTV) Compression

## **PROFESSIONAL EXPERIENCE**

### **VP Customer Success** | **Sprinklr India & APAC**

_Jan 2021 – Present_

- Direct customer success, technical account management, and renewals across 140 enterprise clients generating $55M ARR.
- Reduced average enterprise onboarding time from 90 days to 42 days by implementing standardized customer journey playbooks.
- Managed a 45-member cross-functional CS team across Bengaluru, Singapore, and Tokyo.
- Championed customer feedback loops with Product Engineering, driving 15 key roadmap enhancements.

### **Director of Client Services** | **ZenDesk Asia**

_Apr 2015 – Dec 2020_

- Managed enterprise customer success operations for mid-market and enterprise accounts in South Asia.
- Improved customer satisfaction rating (CSAT) from 84% to 93% through structured quarterly business reviews.

## **EDUCATION**

**MBA - Marketing & Operations** | Symbiosis Institute of Business Management (SIBM), Pune

_2006_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_02",
    persona: "Head of Investor Relations & Capital Markets (Listed Tech Unicorn)",
    rawText: `# **RASHMI KULKARNI**

### Head of Investor Relations & Capital Markets | Institutional Equity, Earnings & Disclosures

Mumbai, MH • (+91) 98202 33441 • rashmi.k@example.com • linkedin.com/in/rashmikulkarni-ir

## **EXECUTIVE PROFILE**

- Investor Relations and Capital Markets leader with 17 years of experience steering corporate disclosures, institutional shareholder engagement, and equity analyst relationships for publicly listed technology companies on NSE and BSE.
- Successfully orchestrated 32 quarterly earnings calls, 14 international institutional investor roadshows, and a $250M Qualified Institutional Placement (QIP).

## **CORE COMPETENCIES**

- Investor Relations: Earnings Call Scripts, Investor Decks, Analyst Financial Consensus Modeling, Guidance Management
- Capital Markets: Institutional Roadshows, QIP Execution, Shareholder Registry Analysis (FII/DII)
- Regulatory Compliance: SEBI (LODR) Regulations, Insider Trading Regulations, Fair Disclosure Guidelines
- Executive Interface: Daily partnership with CEO, CFO, and Board Chairman

## **PROFESSIONAL EXPERIENCE**

### **Head of Investor Relations** | **InfoEdge Technology Enterprises**

_Sep 2020 – Present_

- Manage institutional investor engagement with 120+ domestic and international mutual funds, sovereign wealth funds, and private equity investors holding a ₹35,000 Cr market capitalization.
- Author all quarterly earnings press releases, investor presentations, and CEO shareholder letters.
- Led the investor outreach for a ₹1,800 Cr QIP offering, achieving 4.5x book subscription from top global long-only funds.
- Monitor sell-side consensus estimates and manage earnings communication cadence to maintain high credibility.

### **VP Investor Relations** | **Wipro Limited**

_Jul 2014 – Aug 2020_

- Supported global investor relations across NYSE and BSE listings, hosting quarterly earnings conferences and roadshows in New York, London, and Mumbai.
- Modeled institutional shareholder base transitions and analyzed peer valuation multiples.

## **EDUCATION**

**Master of Science (M.Sc) in Finance** | London School of Economics (LSE)

_2007_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_03",
    persona: "Chief Risk Officer (NBFC & Digital Lending)",
    rawText: `# **ALOK SINGHANIA**

### Chief Risk Officer | Digital Underwriting, Portfolio Risk, Fraud Governance & RBI Compliance

Gurugram, HR • (+91) 98112 44556 • alok.singhania@example.com • linkedin.com/in/aloksinghania-cro

## **EXECUTIVE PROFILE**

- Chief Risk Officer with 22 years of retail and MSME credit risk experience across leading private sector banks and digital NBFCs in India.
- Maintained gross Non-Performing Assets (NPA) below 1.4% across a ₹6,500 Cr digital loan book while doubling monthly disbursement volumes.

## **CORE COMPETENCIES**

- Credit Risk Modeling: Scorecard Development, Bureau Data Ingestion, Alternative Credit Scoring
- Regulatory Risk: RBI Scale-Based Regulation (SBR) Compliance, Capital Adequacy (CRAR), ECL Provisioning
- Fraud Risk Management: Synthetic Identity Detection, Device Fingerprinting, Collections Optimization
- Leadership: 35 risk analysts, credit underwriters, and model validation quantitative researchers

## **PROFESSIONAL EXPERIENCE**

### **Chief Risk Officer** | **LendBharat NBFC**

_Jan 2021 – Present_

- Full statutory risk accountability for a ₹5,800 Cr consumer and merchant digital lending balance sheet.
- Redesigned automated underwriting decision engine, increasing straight-through processing (STP) rate from 40% to 78% with zero increase in early delinquency.
- Chair the Executive Credit Risk Committee and present asset quality metrics directly to the Board Risk Management Committee.
- Managed ECL provision modeling under Ind AS 109 with zero statutory audit qualifications.

### **Head of Retail Credit Risk** | **RBL Bank**

_Mar 2014 – Dec 2020_

- Managed credit policy and risk underwriting for credit cards, personal loans, and auto loans.
- Led risk mitigation during macroeconomic disruptions, limiting net credit losses to under 2.1%.

## **EDUCATION**

**Chartered Financial Analyst (CFA)** | CFA Institute, USA

_2005_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_04",
    persona: "VP Infrastructure & Site Reliability Engineering (Hyperscale Cloud)",
    rawText: `# **TARUN SAXENA**

### VP Infrastructure & SRE | Hyperscale Cloud, Reliability, Kubernetes & FinOps

Bengaluru, KA • (+91) 98861 22334 • tarun.saxena@example.com • linkedin.com/in/tarunsaxena-sre

## **EXECUTIVE PROFILE**

- Infrastructure and SRE executive with 19 years of experience managing 24/7 high-availability cloud platforms, multi-cloud networking, and disaster recovery for global SaaS unicorns.
- Scaled infrastructure supporting 250 million monthly active users while maintaining 99.995% uptime across AWS and GCP regions.

## **CORE COMPETENCIES**

- Cloud & Infrastructure: AWS, GCP, Azure, Bare-Metal Datacenters, Global CDN Routing
- Reliability & SRE: SLO/SLI Frameworks, Chaos Engineering, Post-Mortem Incident Governance, Zero-Downtime Deployments
- FinOps & Cost Optimization: Reserved Instances, Spot Automation, $45M Annual Cloud Budget Optimization
- Organization Leadership: 80 site reliability engineers, database administrators, and network architects

## **PROFESSIONAL EXPERIENCE**

### **VP Infrastructure & Reliability** | **Zeta Cloud Platforms**

_Jul 2020 – Present_

- Direct global cloud infrastructure, reliability engineering, and disaster recovery across 5 global AWS regions.
- Achieved 99.995% service availability over 4 consecutive years, reducing P1 incident MTTR from 45 minutes to 11 minutes.
- Reduced annual cloud infrastructure spend by $14M through Kubernetes cluster rightsizing and automated cold-storage data tiering.
- Managed a 65-member infrastructure organization across Bengaluru, Dublin, and Austin.

### **Director of Site Reliability Engineering** | **InMobi**

_Feb 2014 – Jun 2020_

- Commanded SRE operations for ad-serving platform handling 1.5 million requests per second.
- Built automated multi-region failover architecture capable of redirecting 100% of global traffic within 60 seconds.

## **EDUCATION**

**B.Tech - Computer Science** | National Institute of Technology (NIT) Karnataka, Surathkal

_2004_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_05",
    persona: "Chief Commercial Officer (Luxury Hospitality & Real Estate)",
    rawText: `# **RADHIKA IYER**

### Chief Commercial Officer | Luxury Hospitality, Revenue Management & Asset Monetization

New Delhi, DL • (+91) 98101 55662 • radhika.iyer@example.com • linkedin.com/in/radhikaiyer-cco

## **EXECUTIVE PROFILE**

- Commercial executive with 21 years of experience in luxury hospitality, commercial asset leasing, RevPAR optimization, and global sales distribution across luxury hotel chains.
- Grew portfolio RevPAR by 28% and increased non-room food & beverage / event revenues across 18 luxury properties to ₹850 Cr annually.

## **CORE COMPETENCIES**

- Commercial Strategy: Revenue Management, Dynamic Pricing Algorithms, Luxury Brand Partnerships
- Sales & Distribution: Global Travel Consortium Deals, Corporate RFP Accounts, Direct Booking Channels
- Real Estate Asset Monetization: Hotel Management Contracts, Banquet & Convention Sales, Retail Leasing
- Team Leadership: 60 commercial sales directors, digital distribution heads, and revenue analysts

## **PROFESSIONAL EXPERIENCE**

### **Chief Commercial Officer** | **Palace Resorts & Luxury Hotels India**

_Mar 2021 – Present_

- Full commercial P&L accountability for revenue generation, brand distribution, and sales across 22 luxury heritage hotels and resorts.
- Increased average daily rate (ADR) by 32% and delivered total annual commercial revenues of ₹780 Cr in FY24.
- Negotiated global distribution agreements with American Express Fine Hotels & Resorts and Virtuoso.
- Managed a corporate commercial sales, loyalty marketing, and revenue management team of 48 professionals.

### **VP Revenue Management & Sales** | **The Oberoi Group**

_May 2013 – Feb 2021_

- Led commercial revenue management and corporate sales across 10 luxury business hotels in India.
- Implemented real-time dynamic pricing revenue management software (RMS), lifting room yield by 14%.

## **EDUCATION**

**Post Graduate Diploma in Hotel Management** | Institute of Hotel Management (IHM) Pusa, New Delhi

_2003_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_06",
    persona: "VP Brand, PR & Corporate Communications (FMCG Major)",
    rawText: `# **MANISH CHAWLA**

### VP Brand & Corporate Communications | Integrated PR, Crisis Management & ESG Messaging

Mumbai, MH • (+91) 98204 88992 • manish.chawla@example.com • linkedin.com/in/manishchawla-pr

## **EXECUTIVE PROFILE**

- Corporate communications and brand PR leader with 20 years of experience managing media relations, executive thought leadership, crisis communications, and brand reputation for multinational FMCG conglomerates.
- Successfully managed high-stakes regulatory and product crisis communications, preserving enterprise brand reputation and shareholder value.

## **CORE COMPETENCIES**

- Corporate Communications: National Media Relations, Press Conferences, Editorial Op-Eds, Crisis Playbooks
- Brand PR & Advocacy: Influencer Relations, Sustainable ESG Storytelling, CSR Campaign Amplification
- Executive Positioning: C-Suite Keynote Management, Industry Association Panels (CII, FICCI)
- Agency & Team Management: 25-person corporate communications team and national PR agency network

## **PROFESSIONAL EXPERIENCE**

### **VP Corporate Communications & Brand PR** | **Hindustan Consumer Care Ltd**

_Aug 2019 – Present_

- Direct all national external media relations, crisis response, and executive communications for a ₹12,000 Cr FMCG entity.
- Spearheaded the national media rollout of the group's "Zero Plastic" sustainability initiative, generating ₹45 Cr in earned media value.
- Advised the Managing Director and Board during sensitive regulatory investigations, maintaining neutral-to-positive media sentiment.
- Governed annual corporate PR and sponsorship budgets of ₹28 Cr across 6 national communication agencies.

### **Head of Media Relations** | **Nestle India**

_Jan 2012 – Jul 2019_

- Managed national press relationships and corporate communications during brand revitalization and product launch campaigns.
- Conducted regular media training for 40 senior corporate spokespersons and factory heads.

## **EDUCATION**

**Master of Mass Communication** | Indian Institute of Mass Communication (IIMC), New Delhi

_2004_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_07",
    persona: "VP Global Delivery & Transformation (IT Services & Digital Consulting)",
    rawText: `# **SWATI BANERJEE**

### VP Global Delivery & Digital Consulting | IT Services, Cloud Practices & Account Governance

Kolkata, WB • (+91) 98300 77665 • swati.b@example.com • linkedin.com/in/swatibanerjee-delivery

## **EXECUTIVE PROFILE**

- Global Delivery and Technology Practice leader with 23 years of experience orchestrating large-scale IT services delivery, offshore delivery centers, and enterprise digital transformation programs for Fortune 500 clients.
- Managed a $140M delivery portfolio with 2,400 technology consultants across banking, healthcare, and retail sectors with 99.2% milestone SLA adherence.

## **CORE COMPETENCIES**

- IT Delivery Governance: Large Account P&L Management ($120M+), Fixed-Price & T&M Contract Delivery
- Cloud & Modernization Practices: Enterprise Migration Factories, Agile Pod Models, DevOps Maturity
- Client Engagement: Executive Steering Committees, C-Level Governance, Contract Renegotiations
- Organization Leadership: 2,200 software engineers, delivery project managers, and quality assurance leads

## **PROFESSIONAL EXPERIENCE**

### **VP Global Delivery - Financial Services** | **Cognizant Technology Solutions**

_Oct 2018 – Present_

- P&L and delivery ownership for 18 core banking and insurance client accounts generating $135M in annual services revenue.
- Commanded a global delivery team of 2,200 consultants across Kolkata, Chennai, London, and New York.
- Improved billable utilization from 78% to 86% and expanded account operating margin by 340 basis points over 3 years.
- Directed the delivery of a multi-million-dollar digital banking re-platforming project for a top UK retail bank.

### **Director - Client Delivery** | **Wipro Technologies**

_Jul 2010 – Sep 2018_

- Led delivery operations for US healthcare accounts with 850 software engineers.
- Awarded "Best Delivery Leader of the Year" in 2016 for exceptional customer satisfaction and zero delivery escalations.

## **EDUCATION**

**B.E. - Computer Science and Engineering** | Jadavpur University, Kolkata

_2001_`
  },
  {
    opaqueId: "SECONDARY_CANDIDATE_08",
    persona: "VP ESG & Corporate Sustainability (Clean Energy & Infrastructure)",
    rawText: `# **HARISH NAMBIAR**

### VP ESG & Corporate Sustainability | Net Zero Roadmaps, Carbon Markets & Governance

Hyderabad, TS • (+91) 98495 66778 • harish.nambiar@example.com • linkedin.com/in/harishnambiar-esg

## **EXECUTIVE PROFILE**

- Sustainability and ESG executive with 19 years of experience designing net-zero decarbonization pathways, renewable energy integration, and ESG reporting frameworks for infrastructure and energy conglomerates.
- Reduced corporate Scope 1 & Scope 2 greenhouse gas emissions by 42% across 8 industrial manufacturing sites while securing $150M in green bond financing.

## **CORE COMPETENCIES**

- ESG Strategy: Science Based Targets initiative (SBTi), Net-Zero Roadmaps, Task Force on Climate-Related Financial Disclosures (TCFD)
- Sustainable Finance: Green Bonds, Sustainability-Linked Loans, Carbon Credit Verification (Verra, Gold Standard)
- Regulatory Compliance: SEBI Business Responsibility and Sustainability Reporting (BRSR) Core, GRI Standards
- Team Leadership: 20 sustainability consultants, environmental engineers, and carbon accounting analysts

## **PROFESSIONAL EXPERIENCE**

### **VP Sustainability & ESG** | **GreenPower Infrastructure Holdings**

_Feb 2021 – Present_

- Direct corporate ESG strategy, carbon reduction roadmaps, and stakeholder sustainability reporting across 12 solar and wind power plants.
- Authored the group's annual BRSR Core report, achieving top-decile ESG ranking among Indian listed infrastructure firms.
- Structuring carbon offset trading portfolios, monetizing 1.2 million carbon credits on international voluntary carbon exchanges.
- Present ESG risks and climate scenario models quarterly to the Board Risk and Sustainability Committee.

### **Head of Environmental Sustainability** | **Larsen & Toubro (L&T) Power**

_Apr 2013 – Jan 2021_

- Led environmental impact assessments, water neutrality projects, and renewable energy adoption across infrastructure project sites.
- Implemented energy efficiency optimization programs saving ₹35 Cr in annual industrial electricity costs.

## **EDUCATION**

**M.Tech - Environmental Engineering** | Indian Institute of Technology (IIT) Kharagpur

_2005_`
  }
];

// ============================================================================
// Main Assembly Function
// ============================================================================

async function assembleMaterials() {
  console.log("=== GATE 1B BATCH 06 STEP 3A: ASSEMBLING BLIND MATERIALS ===");

  ensureDir(batch06Dir);
  ensureDir(matPrimaryDir);
  ensureDir(matSecondaryDir);
  ensureDir(path.join(matPrimaryDir, "roles"));
  ensureDir(path.join(matPrimaryDir, "candidates"));
  ensureDir(path.join(matSecondaryDir, "roles"));
  ensureDir(path.join(matSecondaryDir, "candidates"));

  ensureDir(annPrimaryDir);
  ensureDir(annSecondaryDir);
  ensureDir(path.join(annPrimaryDir, "roles"));
  ensureDir(path.join(annPrimaryDir, "candidates"));
  ensureDir(path.join(annSecondaryDir, "roles"));
  ensureDir(path.join(annSecondaryDir, "candidates"));

  // 1. Fetch 30 Primary and 15 Secondary real natural executive roles from Turso Cloud DB
  console.log("\n[1/6] Fetching genuine natural executive roles from Turso Cloud DB...");
  const db = getDatabaseAdapter();

  const rows = await db.many<any>(`
    SELECT d.id as doc_id, o.id as opp_id, o.canonical_title, c.name as company_name, o.location, d.content
    FROM documents d
    JOIN opportunities o ON d.opportunity_id = o.id
    JOIN companies c ON o.company_id = c.id
    WHERE length(d.content) > 1500
      AND (
        o.canonical_title LIKE '%Director%' OR
        o.canonical_title LIKE '%Head%' OR
        o.canonical_title LIKE '%Chief%' OR
        o.canonical_title LIKE '%VP%' OR
        o.canonical_title LIKE '%Vice President%' OR
        o.canonical_title LIKE '%General Manager%' OR
        o.canonical_title LIKE '%Partner%' OR
        o.canonical_title LIKE '%Leader%' OR
        o.canonical_title LIKE '%Country Manager%'
      )
    ORDER BY d.id ASC
  `);

  console.log(`  Found ${rows.length} candidate executive records in Turso Cloud`);

  const primaryNaturalRoles: any[] = [];
  const secondaryNaturalRoles: any[] = [];
  const seenCompanies = new Set<string>();

  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content);
      const text = parsed.normalizedText || parsed.description || parsed.rawText;
      if (!text || text.length < 1500) continue;

      const compKey = (r.company_name || "").toLowerCase().trim();
      if (seenCompanies.has(compKey)) continue;
      seenCompanies.add(compKey);

      const item = {
        sourceDocId: r.doc_id,
        oppId: r.opp_id,
        title: r.canonical_title,
        company: r.company_name,
        location: r.location,
        charLength: text.length,
        rawText: text
      };

      if (primaryNaturalRoles.length < 30) {
        primaryNaturalRoles.push(item);
      } else if (secondaryNaturalRoles.length < 15) {
        secondaryNaturalRoles.push(item);
      }

      if (primaryNaturalRoles.length === 30 && secondaryNaturalRoles.length === 15) {
        break;
      }
    } catch {}
  }

  console.log(`  Selected ${primaryNaturalRoles.length} Primary Natural Roles from Turso Cloud`);
  console.log(`  Selected ${secondaryNaturalRoles.length} Secondary Natural Roles from Turso Cloud`);

  // 2. Package Primary Roles (50 roles: 30 natural + 20 adversarial)
  console.log("\n[2/6] Packaging Primary Certification Roles (N=50)...");
  const primaryRoleManifestEntries: any[] = [];

  for (let i = 0; i < primaryNaturalRoles.length; i++) {
    const nr = primaryNaturalRoles[i];
    const opaqueId = `PRIMARY_ROLE_${String(i + 1).padStart(2, "0")}`;
    const textPath = path.join(matPrimaryDir, "roles", `${opaqueId}.txt`);
    fs.writeFileSync(textPath, nr.rawText, "utf8");

    const textHash = sha256(nr.rawText);
    primaryRoleManifestEntries.push({
      opaqueId,
      sourceType: "NATURAL_SCRAPED_JD",
      partition: "PRIMARY_CERTIFICATION",
      jurisdiction: "INDIAN_EXECUTIVE_MARKET",
      unseenByPreviousBatches: true,
      charLength: nr.rawText.length,
      sha256: textHash,
      metadata: {
        title: nr.title,
        company: nr.company,
        location: nr.location
      }
    });

    // Write BLANK annotation template
    const blankTemplate = {
      schemaVersion: "gate1b-batch06-blank-annotation/v1",
      holdout: "PRIMARY_CERTIFICATION",
      opaqueId,
      documentType: "ROLE_JD",
      title: nr.title,
      company: nr.company,
      sha256: textHash,
      sourceText: nr.rawText,
      // Strictly BLANK for human adjudication
      reviewerId: "",
      reviewer2Id: "",
      reviewTimestamp: "",
      facts: [],
      highRiskNegatives: [],
      highRiskSilentDimensions: [],
      adjudicationNotes: ""
    };
    fs.writeFileSync(
      path.join(annPrimaryDir, "roles", `${opaqueId}_BLANK.json`),
      JSON.stringify(blankTemplate, null, 2),
      "utf8"
    );
  }

  for (let i = 0; i < PRIMARY_ADVERSARIAL_ROLES.length; i++) {
    const adv = PRIMARY_ADVERSARIAL_ROLES[i];
    const textPath = path.join(matPrimaryDir, "roles", `${adv.opaqueId}.txt`);
    fs.writeFileSync(textPath, adv.rawText, "utf8");

    const textHash = sha256(adv.rawText);
    primaryRoleManifestEntries.push({
      opaqueId: adv.opaqueId,
      sourceType: "ADVERSARIAL_BOUNDARY_STRESS",
      partition: "PRIMARY_CERTIFICATION",
      stressDimension: adv.highRiskStressDimension,
      scenario: adv.scenario,
      unseenByPreviousBatches: true,
      charLength: adv.rawText.length,
      sha256: textHash
    });

    const blankTemplate = {
      schemaVersion: "gate1b-batch06-blank-annotation/v1",
      holdout: "PRIMARY_CERTIFICATION",
      opaqueId: adv.opaqueId,
      documentType: "ROLE_JD",
      scenario: adv.scenario,
      sha256: textHash,
      sourceText: adv.rawText,
      // Strictly BLANK for human adjudication
      reviewerId: "",
      reviewer2Id: "",
      reviewTimestamp: "",
      facts: [],
      highRiskNegatives: [],
      highRiskSilentDimensions: [],
      adjudicationNotes: ""
    };
    fs.writeFileSync(
      path.join(annPrimaryDir, "roles", `${adv.opaqueId}_BLANK.json`),
      JSON.stringify(blankTemplate, null, 2),
      "utf8"
    );
  }

  // 3. Package Primary Candidate Resumes (N=16)
  console.log("\n[3/6] Packaging Primary Candidate Resumes (N=16)...");
  const primaryCandidateManifestEntries: any[] = [];

  for (let i = 0; i < PRIMARY_CANDIDATE_RESUMES.length; i++) {
    const cand = PRIMARY_CANDIDATE_RESUMES[i];
    const mdPath = path.join(matPrimaryDir, "candidates", `${cand.opaqueId}.md`);
    fs.writeFileSync(mdPath, cand.rawText, "utf8");

    const textHash = sha256(cand.rawText);
    primaryCandidateManifestEntries.push({
      opaqueId: cand.opaqueId,
      sourceType: "EXECUTIVE_RESUME",
      partition: "PRIMARY_CERTIFICATION",
      persona: cand.persona,
      unseenByPreviousBatches: true,
      charLength: cand.rawText.length,
      sha256: textHash
    });

    const blankTemplate = {
      schemaVersion: "gate1b-batch06-blank-candidate-annotation/v1",
      holdout: "PRIMARY_CERTIFICATION",
      opaqueId: cand.opaqueId,
      documentType: "CANDIDATE_RESUME",
      persona: cand.persona,
      sha256: textHash,
      sourceText: cand.rawText,
      // Strictly BLANK for human adjudication
      reviewerId: "",
      reviewer2Id: "",
      reviewTimestamp: "",
      facts: [],
      adjudicationNotes: ""
    };
    fs.writeFileSync(
      path.join(annPrimaryDir, "candidates", `${cand.opaqueId}_BLANK.json`),
      JSON.stringify(blankTemplate, null, 2),
      "utf8"
    );
  }

  // Write PRIMARY_POPULATION_MANIFEST.json
  const primaryManifest = {
    manifestVersion: "gate1b-batch06-primary-manifest/v1",
    holdout: "PRIMARY_CERTIFICATION",
    createdAt: new Date().toISOString(),
    governingScopeRevision: 3,
    summary: {
      totalRoles: primaryRoleManifestEntries.length,
      naturalRolesCount: 30,
      adversarialRolesCount: 20,
      totalCandidateResumes: primaryCandidateManifestEntries.length
    },
    roles: primaryRoleManifestEntries,
    candidates: primaryCandidateManifestEntries
  };
  const primaryManifestStr = JSON.stringify(primaryManifest, null, 2);
  const primaryManifestPath = path.join(matPrimaryDir, "PRIMARY_POPULATION_MANIFEST.json");
  fs.writeFileSync(primaryManifestPath, primaryManifestStr, "utf8");
  const primaryManifestHash = sha256(primaryManifestStr);
  console.log(`  -> Primary Population Manifest written. SHA-256: ${primaryManifestHash}`);

  // 4. Package Secondary Roles (25 roles: 15 natural + 10 adversarial)
  console.log("\n[4/6] Packaging Secondary Remediation Holdout Roles (N=25)...");
  const secondaryRoleManifestEntries: any[] = [];

  for (let i = 0; i < secondaryNaturalRoles.length; i++) {
    const nr = secondaryNaturalRoles[i];
    const opaqueId = `SECONDARY_ROLE_${String(i + 1).padStart(2, "0")}`;
    const textPath = path.join(matSecondaryDir, "roles", `${opaqueId}.txt`);
    fs.writeFileSync(textPath, nr.rawText, "utf8");

    const textHash = sha256(nr.rawText);
    secondaryRoleManifestEntries.push({
      opaqueId,
      sourceType: "NATURAL_SCRAPED_JD",
      partition: "SECONDARY_REMEDIATION_HOLDOUT",
      jurisdiction: "INDIAN_EXECUTIVE_MARKET",
      unseenByPreviousBatches: true,
      charLength: nr.rawText.length,
      sha256: textHash,
      metadata: {
        title: nr.title,
        company: nr.company,
        location: nr.location
      }
    });

    const blankTemplate = {
      schemaVersion: "gate1b-batch06-blank-annotation/v1",
      holdout: "SECONDARY_REMEDIATION_HOLDOUT",
      opaqueId,
      documentType: "ROLE_JD",
      title: nr.title,
      company: nr.company,
      sha256: textHash,
      sourceText: nr.rawText,
      // Strictly BLANK for human adjudication
      reviewerId: "",
      reviewer2Id: "",
      reviewTimestamp: "",
      facts: [],
      highRiskNegatives: [],
      highRiskSilentDimensions: [],
      adjudicationNotes: ""
    };
    fs.writeFileSync(
      path.join(annSecondaryDir, "roles", `${opaqueId}_BLANK.json`),
      JSON.stringify(blankTemplate, null, 2),
      "utf8"
    );
  }

  for (let i = 0; i < SECONDARY_ADVERSARIAL_ROLES.length; i++) {
    const adv = SECONDARY_ADVERSARIAL_ROLES[i];
    const textPath = path.join(matSecondaryDir, "roles", `${adv.opaqueId}.txt`);
    fs.writeFileSync(textPath, adv.rawText, "utf8");

    const textHash = sha256(adv.rawText);
    secondaryRoleManifestEntries.push({
      opaqueId: adv.opaqueId,
      sourceType: "ADVERSARIAL_BOUNDARY_STRESS",
      partition: "SECONDARY_REMEDIATION_HOLDOUT",
      stressDimension: adv.highRiskStressDimension,
      scenario: adv.scenario,
      unseenByPreviousBatches: true,
      charLength: adv.rawText.length,
      sha256: textHash
    });

    const blankTemplate = {
      schemaVersion: "gate1b-batch06-blank-annotation/v1",
      holdout: "SECONDARY_REMEDIATION_HOLDOUT",
      opaqueId: adv.opaqueId,
      documentType: "ROLE_JD",
      scenario: adv.scenario,
      sha256: textHash,
      sourceText: adv.rawText,
      // Strictly BLANK for human adjudication
      reviewerId: "",
      reviewer2Id: "",
      reviewTimestamp: "",
      facts: [],
      highRiskNegatives: [],
      highRiskSilentDimensions: [],
      adjudicationNotes: ""
    };
    fs.writeFileSync(
      path.join(annSecondaryDir, "roles", `${adv.opaqueId}_BLANK.json`),
      JSON.stringify(blankTemplate, null, 2),
      "utf8"
    );
  }

  // 5. Package Secondary Candidate Resumes (N=8)
  console.log("\n[5/6] Packaging Secondary Candidate Resumes (N=8)...");
  const secondaryCandidateManifestEntries: any[] = [];

  for (let i = 0; i < SECONDARY_CANDIDATE_RESUMES.length; i++) {
    const cand = SECONDARY_CANDIDATE_RESUMES[i];
    const mdPath = path.join(matSecondaryDir, "candidates", `${cand.opaqueId}.md`);
    fs.writeFileSync(mdPath, cand.rawText, "utf8");

    const textHash = sha256(cand.rawText);
    secondaryCandidateManifestEntries.push({
      opaqueId: cand.opaqueId,
      sourceType: "EXECUTIVE_RESUME",
      partition: "SECONDARY_REMEDIATION_HOLDOUT",
      persona: cand.persona,
      unseenByPreviousBatches: true,
      charLength: cand.rawText.length,
      sha256: textHash
    });

    const blankTemplate = {
      schemaVersion: "gate1b-batch06-blank-candidate-annotation/v1",
      holdout: "SECONDARY_REMEDIATION_HOLDOUT",
      opaqueId: cand.opaqueId,
      documentType: "CANDIDATE_RESUME",
      persona: cand.persona,
      sha256: textHash,
      sourceText: cand.rawText,
      // Strictly BLANK for human adjudication
      reviewerId: "",
      reviewer2Id: "",
      reviewTimestamp: "",
      facts: [],
      adjudicationNotes: ""
    };
    fs.writeFileSync(
      path.join(annSecondaryDir, "candidates", `${cand.opaqueId}_BLANK.json`),
      JSON.stringify(blankTemplate, null, 2),
      "utf8"
    );
  }

  // Write SECONDARY_POPULATION_MANIFEST.json
  const secondaryManifest = {
    manifestVersion: "gate1b-batch06-secondary-manifest/v1",
    holdout: "SECONDARY_REMEDIATION_HOLDOUT",
    createdAt: new Date().toISOString(),
    governingScopeRevision: 3,
    summary: {
      totalRoles: secondaryRoleManifestEntries.length,
      naturalRolesCount: 15,
      adversarialRolesCount: 10,
      totalCandidateResumes: secondaryCandidateManifestEntries.length
    },
    roles: secondaryRoleManifestEntries,
    candidates: secondaryCandidateManifestEntries
  };
  const secondaryManifestStr = JSON.stringify(secondaryManifest, null, 2);
  const secondaryManifestPath = path.join(matSecondaryDir, "SECONDARY_POPULATION_MANIFEST.json");
  fs.writeFileSync(secondaryManifestPath, secondaryManifestStr, "utf8");
  const secondaryManifestHash = sha256(secondaryManifestStr);
  console.log(`  -> Secondary Population Manifest written. SHA-256: ${secondaryManifestHash}`);

  // 6. Generate Reviewer Instructions
  console.log("\n[6/6] Generating External Reviewer Instructions...");
  const reviewerInstructions = `# GATE 1B BATCH 06 — EXTERNAL HUMAN REVIEWER INSTRUCTIONS

## 1. PURPOSE & GOVERNING PRINCIPLES
This document instructs independent external human adjudicators on annotating reference ground truth for the RADAR v2 Gate 1B Batch 06 Blind Validation.

**CRITICAL INDEPENDENCE RULE**:
Human truth adjudication must be strictly external and independent of the autonomous coding agent. No model outputs, proposed extractions, or candidate architecture inferences are provided to reviewers. Reviewers see only the authentic raw source documents.

---

## 2. POPULATIONS & SEALING SEMANTICS

1. **Primary Certification Population**:
   - 50 Roles (\`PRIMARY_ROLE_01\` to \`PRIMARY_ROLE_50\`)
   - 16 Candidate Resumes (\`PRIMARY_CANDIDATE_01\` to \`PRIMARY_CANDIDATE_16\`)
2. **Secondary Remediation Holdout**:
   - 25 Roles (\`SECONDARY_ROLE_01\` to \`SECONDARY_ROLE_25\`)
   - 8 Candidate Resumes (\`SECONDARY_CANDIDATE_01\` to \`SECONDARY_CANDIDATE_08\`)

### Crucial Secondary Holdout Sealing Clarification
Secondary is SEALED FROM:
- implementation agent inspection of completed truth
- model/extractor execution
- tuning
- scoring
until the permitted remediation condition occurs.

Secondary is NOT sealed from independent human adjudicators.

Both Primary and Secondary must be human-annotated, dual-reviewed where required, and cryptographically frozen before the Primary model run.

---

## 3. ROLE ANNOTATION PROTOCOL (\`*_BLANK.json\`)

For each role document, reviewers must extract discrete reference facts and negative boundaries according to [\`ROLE_MATERIALITY_RUBRIC.md\`](./ROLE_MATERIALITY_RUBRIC.md).

### A. Fact Record Structure
For each discrete factual statement affirmed or negated in the text:
\`\`\`json
{
  "id": "fact_01",
  "propositionText": "Owns the $6.5M marketing department operational budget.",
  "sourceEvidence": ["manage an annual marketing program budget of $6,500,000"],
  "canonicalTypes": ["BUDGET_SCOPE"],
  "appliesTo": "ROLE",
  "polarity": "AFFIRMED",
  "materiality": "MATERIAL_SELECTED",
  "highRiskFamily": null
}
\`\`\`

### B. Controlled Vocabularies
1. **Materiality Class** (Governed by [\`ROLE_MATERIALITY_RUBRIC.md\`](./ROLE_MATERIALITY_RUBRIC.md)):
   - \`MATERIAL_SELECTED\`: Facts that materially characterize any of the 9 executive dimensions:
     - role mandate/purpose
     - material responsibilities/outcomes
     - requirements/preferences
     - authority/accountability
     - reporting/governance
     - people scope
     - financial/commercial scope
     - geographic/regulatory/product/customer/channel scope
     - material work conditions
     **Invariant**: Do not select facts based on what the extractor emits or misses. Certification Typed Reference Recall >= 50% must be computed against \`MATERIAL_SELECTED\` facts.
   - \`SUPPORTING_NON_MATERIAL\`: Corporate boilerplate, standard office tools, routine administrative perks, generic non-differentiating prose. Recorded for diagnostic reporting only; must not silently replace the historically comparable certification denominator.

2. **Canonical Semantic Types (25 Canonical Types Strictly)**:
   \`ROLE_PURPOSE\`, \`RESPONSIBILITY\`, \`OUTCOME\`, \`SUCCESS_METRIC\`, \`HARD_REQUIREMENT\`, \`PREFERRED_REQUIREMENT\`, \`REPORTING_LINE\`, \`FOUNDER_CEO_PROXIMITY\`, \`BOARD_EXPOSURE\`, \`PNL_OWNERSHIP\`, \`REVENUE_ACCOUNTABILITY\`, \`PROFITABILITY_ACCOUNTABILITY\`, \`BUDGET_SCOPE\`, \`DECISION_AUTHORITY\`, \`PEOPLE_LEADERSHIP\`, \`PEOPLE_SCALE\`, \`GREENFIELD_BUILD\`, \`TRANSFORMATION\`, \`GEOGRAPHIC_SCOPE\`, \`REGULATORY_SCOPE\`, \`PRODUCT_SCOPE\`, \`CUSTOMER_SCOPE\`, \`CHANNEL_SCOPE\`, \`COMPANY_CONTEXT\`, \`WORK_CONDITION\`.

3. **Applicability Domain**:
   - \`ROLE\`: Direct mandate, authority, or condition of the hiring position.
   - \`CANDIDATE_REQUIREMENT\`: Mandatory prerequisite qualifications the applicant must possess.
   - \`CANDIDATE_PREFERENCE\`: Preferred, optional qualifications.
   - \`COMPANY\`: Context about the hiring company (e.g. employee count, funding, revenue).
   - \`RECRUITING_PROCESS\`: Interview steps, assessment protocols, background checks.

4. **Polarity**:
   - \`AFFIRMED\`: Stated as true and in-scope for the position.
   - \`NEGATED\`: Explicitly excluded, prohibited, or stated as not in scope (e.g., "no direct reports", "does not manage P&L").
   - \`CONDITIONAL\`: Contingent upon an explicit external dependency (e.g., "subject to Board approval", "requires CFO sign-off").

5. **High-Risk Negative Boundaries (\`highRiskNegatives\`)**:
   Enumerate any of the 9 canonical high-risk families that are explicitly absent or contradicted in the JD:
   - \`REPORTING_LINE\`, \`FOUNDER_CEO_PROXIMITY\`, \`BOARD_EXPOSURE\`, \`PNL_OWNERSHIP\`, \`REVENUE_ACCOUNTABILITY\`, \`PROFITABILITY_ACCOUNTABILITY\`, \`DECISION_AUTHORITY\`, \`PEOPLE_LEADERSHIP\`, \`PEOPLE_SCALE\`.

---

## 4. CANDIDATE RESUME ANNOTATION PROTOCOL (\`*_BLANK.json\`)

Reviewers must extract candidate career milestones and executive proof points strictly adhering to [\`CANDIDATE_REFERENCE_TRUTH_CONTRACT.md\`](./CANDIDATE_REFERENCE_TRUTH_CONTRACT.md), aligning 1:1 with the canonical \`CandidateProofClaim\` contract from \`CandidateProofExtractorV1.ts\`.

### A. Proof Claim Record Structure
\`\`\`json
{
  "id": "cand_fact_01",
  "title": "Chief Technology Officer",
  "employer": "CloudScale Technologies",
  "startDate": "2021-01",
  "endDate": null,
  "isCurrent": true,
  "proofTypes": ["PEOPLE_SCOPE"],
  "evidenceClass": "WORK_HISTORY",
  "exactText": "Directed global engineering and infrastructure org of 420 engineers across Bengaluru, Pune, and Seattle.",
  "startOffset": 1240,
  "endOffset": 1345,
  "metrics": [
    {
      "exactText": "420 engineers",
      "startOffset": 1297,
      "endOffset": 1310,
      "metricType": "COUNT",
      "rawValue": "420",
      "normalizedValue": 420,
      "comparator": "EXACT",
      "unit": "engineers"
    }
  ]
}
\`\`\`

### B. Controlled Candidate Vocabularies
1. **Candidate Proof Types (18 Canonical Types strictly from \`CandidateProofExtractorV1.ts\`)**:
   \`OUTCOME\`, \`OWNERSHIP\`, \`FINANCIAL_SCOPE\`, \`PEOPLE_SCOPE\`, \`GEOGRAPHIC_SCOPE\`, \`ORGANIZATION_BUILD\`, \`TRANSFORMATION\`, \`MANDATE\`, \`PRODUCT_LAUNCH\`, \`CUSTOMER_GROWTH\`, \`REVENUE_GROWTH\`, \`COST_EFFICIENCY\`, \`PIPELINE_GENERATION\`, \`TECHNOLOGY_IMPLEMENTATION\`, \`PARTNERSHIP\`, \`STAKEHOLDER_LEADERSHIP\`, \`DOMAIN_PRECEDENT\`, \`CAPABILITY_LABEL\`.

2. **Candidate Evidence Classes (3 Canonical Classes strictly from \`CandidateProofExtractorV1.ts\`)**:
   - \`WORK_HISTORY\`: Bullet-level accomplishments or responsibilities tied directly to an employer tenure.
   - \`SELF_SUMMARY\`: High-level executive profile or career summary assertions preceding work history.
   - \`CAPABILITY_LABEL\`: Skills, certifications, or tool competencies listed in standalone lists.

### C. Candidate Scoring Rules & Invariants
1. **Exact-Text / Source-Span Invariant**: \`exactText\` must match character-for-character as an exact substring of the resume text, with exact \`startOffset\` and \`endOffset\` satisfying \`sourceText.slice(startOffset, endOffset) === exactText\`. Hallucinated or loosely paraphrased spans fail Gate 4 (\`candidateSpanProvenanceMin: 1.0\`).
2. **Chronology Gate 9 Invariant**: Evaluates exact work-history binding:
   chronologyBindingAccuracy = (work-history reference claims with correct employer AND title AND tenure/current-status) / (all applicable work-history reference claims).
   Evaluated by Gate 9 (\`candidateChronologyBindingMin: 0.90\`). Employer-only binding is evaluated as a secondary diagnostic.
3. **Position / Title Binding**: Each claim must bind to the specific executive title held during that tenure.
4. **Date / Tenure Binding**: Each claim must bind to verified employment dates (\`startDate\`, \`endDate\`) in \`YYYY-MM\` or \`YYYY\` format.
5. **Metric Fidelity (Gate 8)**: Canonical \`StructuredMetric\` records preserve numerical values, currencies, units, and comparators. Evaluated by Gate 8 (\`candidateMetricFidelityMin: 0.90\`).
6. **Current-Role Status**: Correctly identify whether the role is active (\`isCurrent: true\`) or historical (\`false\`).
7. **Zero Cross-Position Leakage**: Attributing accomplishments achieved at Position A to Position B is a fatal contamination error.
8. **Zero Cross-Document Leakage**: Candidate claims must never reference facts from other candidate resumes or job postings.

---

## 5. DUAL HUMAN CONFIRMATION & ARTIFACT PROTOCOL

1. **Independent Review Artifacts**:
   - Reviewer 1 annotates \`*_REV1.json\`.
   - Reviewer 2 annotates \`*_REV2.json\` independently.
2. **Reconciliation Record (\`*_RECONCILIATION.json\`)**:
   - For all high-risk role facts, negative boundaries, and candidate work-history chronology bindings, both reviews are compared.
   - In case of divergence, an Adjudication Reviewer documents the resolution in \`*_RECONCILIATION.json\` with an explicit adjudicator ID.
3. **Mechanical Ingestion**:
   - \`scripts/transition/ingest-batch06-human-truth.ts\` verifies independent dual-review proofs (\`reviewerId !== reviewer2Id\`), resolves verbatim quotes to frozen span IDs, validates canonical schemas, and generates the compiled authoritative reference truth files.
4. **Cryptographic Sealing**:
   - Both Primary and Secondary reference files are finalized and cryptographically hashed before Step 4 model extraction runs.
`;

  fs.writeFileSync(
    path.join(batch06Dir, "annotation/REVIEWER_INSTRUCTIONS.md"),
    reviewerInstructions,
    "utf8"
  );
  console.log("  -> Reviewer Instructions written to annotation/REVIEWER_INSTRUCTIONS.md");

  console.log("\n======================================================================");
  console.log("STEP 3A MATERIAL PACKAGING COMPLETE");
  console.log(`Primary Manifest Hash   : ${primaryManifestHash}`);
  console.log(`Secondary Manifest Hash : ${secondaryManifestHash}`);
  console.log("======================================================================");
}

assembleMaterials().catch(err => {
  console.error("Failed to assemble materials:", err);
  process.exit(1);
});
