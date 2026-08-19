import { type OpportunitySource } from "./opportunity-fixtures";

const jd = (value: string | null, quote: string) =>
  value === null
    ? { value: null, status: "Missing" as const, evidence: [] }
    : { value, status: "Explicit" as const, evidence: [{ quote, source: "snippet" as const, provenance: "fixture" as const }] };

const proof = (headline: string, detail: string) => ({ headline, detail });

export const extraOpportunities: OpportunitySource[] = [
  {
    jobHash: "j-maruti-cmo",
    role: "Chief Marketing Officer (CMO)",
    company: "Maruti Suzuki",
    location: "Gurugram · India",
    postedRelative: "Posted today",
    scrapedFrom: "Naukri",
    primaryConcern: null,
    dimensions: [
      {
        key: "requiredLevel",
        label: "Required Level",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("CMO", "Chief Marketing Officer (CMO)"),
        candidateProof: proof("CMO target matched", "Currently VP Marketing on track for CMO.")
      },
      {
        key: "reportingLine",
        label: "Reporting Line",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("MD", "Reports to the Managing Director."),
        candidateProof: proof("Board ready", "Prior reporting into MD and CEO layer.")
      },
      {
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("Transformation", "Lead Maruti D2C digital transition and connected car CRM."),
        candidateProof: proof("13-market Salesforce reset", "Legacy-to-Salesforce migration across APAC/ME in 12 months.")
      },
      {
        key: "commercialAccountability",
        label: "Commercial Accountability",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("₹5.0 Cr+ P&L", "Own the Maruti Suzuki marketing P&L (₹5.0 Cr+ scale)."),
        candidateProof: proof("$8M Ford + ₹36 Cr BMW", "Direct commercial ownership scale fits the ask.")
      }
    ]
  },
  {
    jobHash: "j-zomato-cgo",
    role: "Chief Growth Officer (CGO)",
    company: "Zomato",
    location: "Gurugram · India",
    postedRelative: "Posted today",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: [
      {
        key: "requiredLevel",
        label: "Required Level",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("CGO", "Chief Growth Officer"),
        candidateProof: proof("CGO is on target list", "strategy.targetTitles includes CGO.")
      },
      {
        key: "reportingLine",
        label: "Reporting Line",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("CEO", "Reports directly to the CEO."),
        candidateProof: proof("CxO reporting proven", "Prior reporting into CEO/CMO layer.")
      },
      {
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("Transformation", "Lead CRM lifecycle reset and loyalty scale-up."),
        candidateProof: proof("13-market Salesforce reset", "Legacy-to-Salesforce migration across APAC/ME in 12 months.")
      },
      {
        key: "commercialAccountability",
        label: "Commercial Accountability",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("₹100 Cr+ P&L", "Own the growth marketing P&L (₹100 Cr+ top-line)."),
        candidateProof: proof("$8M Ford + ₹36 Cr BMW", "P&L altitude matches Zomato scale.")
      }
    ]
  },
  {
    jobHash: "j-landmark-cmo",
    role: "Chief Marketing Officer (CMO)",
    company: "Landmark Group India",
    location: "Bengaluru · India",
    postedRelative: "Posted today",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: [
      {
        key: "requiredLevel",
        label: "Required Level",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("CMO", "Chief Marketing Officer"),
        candidateProof: proof("CMO target matched", "strategy.targetTitles includes CMO.")
      },
      {
        key: "reportingLine",
        label: "Reporting Line",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("MD India", "Reports to the Managing Director, India."),
        candidateProof: proof("Board exposure proven", "Prior reporting into MD and Board layer.")
      },
      {
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("Transformation", "Salesforce CDP migration for loyalty across retail formats."),
        candidateProof: proof("13-market Salesforce reset", "Legacy-to-Salesforce migration across APAC/ME in 12 months.")
      },
      {
        key: "commercialAccountability",
        label: "Commercial Accountability",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("₹3.0 Cr+ P&L", "Own the retail marketing P&L (₹3.0 Cr+ scale)."),
        candidateProof: proof("$8M Ford + ₹36 Cr BMW", "Comparable retail/portfolio scale.")
      }
    ]
  },
  {
    jobHash: "j-freshworks-cgo",
    role: "Chief Growth Officer",
    company: "Freshworks",
    location: "Bengaluru · India",
    postedRelative: "Posted today",
    scrapedFrom: "Indeed",
    primaryConcern: null,
    dimensions: [
      {
        key: "requiredLevel",
        label: "Required Level",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("CGO", "Chief Growth Officer"),
        candidateProof: proof("CGO is on target list", "strategy.targetTitles includes CGO.")
      },
      {
        key: "reportingLine",
        label: "Reporting Line",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("CEO", "Reports directly to the CEO."),
        candidateProof: proof("CxO reporting proven", "Prior reporting into CEO/CMO layer.")
      },
      {
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: jd("Transformation", "Build global growth marketing Center of Excellence."),
        candidateProof: proof("40-member CoE GCC setup", "Recruited and scaled a 40-member cross-functional Performance Marketing Center of Excellence.")
      }
    ]
  }
];

for (const opp of extraOpportunities) {
  if (!opp.rawText) {
    const quotes = (opp.dimensions || [])
      .flatMap((d) => (d.jdEvidence?.evidence || []).map((e: any) => e.quote))
      .filter(Boolean);
    opp.rawText = `${opp.role} at ${opp.company} located in ${opp.location}. ${quotes.join(". ")}. Scraped from ${opp.scrapedFrom}.`;
  }
}

