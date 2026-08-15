import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";

interface HumanEval {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  qualityScore: number;
  cv: number;
  sp: number;
  friction: number;
  policyDDecision: "PURSUE" | "CONSIDER" | "PASS";
  humanDecision: "PURSUE" | "CONSIDER" | "PASS" | "INSUFFICIENT EVIDENCE";
  humanRationale: string;
  disagreementClass?: "A. Cautious" | "B. Aggressive" | "C. Genuine Ambiguity" | "D. Data Quality" | "E. Policy Defect";
}

async function runQualitativeEvaluation() {
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);
  const rawOps = readOpportunities();
  const rawMap = new Map<string, any>(rawOps.map(o => [o.jobHash, o]));

  // Re-run evaluation logic
  const groupAHashes = [
    "j-a623f0ffd6cc", "j-e6f7552e55f3", "j-1e80c139a769", "j-a97cde7e8910", "j-609a81be6878",
    "j-7fa5c9a8c2ac", "j-6bef5f20bfc6", "j-3660e93b3342", "j-0826676339c6", "j-121cd55650d0"
  ];

  const groupBHashes = [
    "j-a33c240fd23e", "j-d3a5186e496d", "j-3beb9443d35d", "j-0377407df31a", "j-7b7aac5ab489",
    "j-46bc3d47d1da", "j-726da9900c1d", "j-03b75f450eb3", "j-9e3036350248", "j-87a0a5fabc3a"
  ];

  const evalGroupA: HumanEval[] = [
    {
      jobHash: "j-a623f0ffd6cc",
      role: "Head- Strategy- Gold Business",
      company: "Saaki Argus & Averil Consulting",
      location: "Chennai",
      qualityScore: 65, cv: 51, sp: 87, friction: 5,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Clear strategic leadership role in business expansion; strong functional match despite moderate career step."
    },
    {
      jobHash: "j-e6f7552e55f3",
      role: "AVP - Customer Experience",
      company: "Credit Saison India",
      location: "Mumbai",
      qualityScore: 65, cv: 52, sp: 80, friction: 10,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "P&L/CX leadership role at high-growth fintech; highly actionable given strong operational background."
    },
    {
      jobHash: "j-1e80c139a769",
      role: "Senior Performance Marketing Manager",
      company: "Payoneer",
      location: "Bengaluru",
      qualityScore: 65, cv: 52, sp: 81, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "CONSIDER",
      humanRationale: "Strong MNC fintech brand and perfect skill overlap, but title (Senior Manager) is slightly junior for VP/Director executive baseline.",
      disagreementClass: "C. Genuine Ambiguity"
    },
    {
      jobHash: "j-a97cde7e8910",
      role: "General Manager Marketing",
      company: "Techno Paints",
      location: "Hyderabad/Bengaluru",
      qualityScore: 65, cv: 54, sp: 83, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Full functional GM Marketing mandate at established corporate player; strong commercial alignment."
    },
    {
      jobHash: "j-609a81be6878",
      role: "Fractional Chief Marketing Officer (CMO)",
      company: "Harbinger Group",
      location: "Pune",
      qualityScore: 65, cv: 56, sp: 80, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "CXO title with fractional strategic scope; attractive advisory / executive engagement."
    },
    {
      jobHash: "j-7fa5c9a8c2ac",
      role: "Head of Ecommerce",
      company: "UNISON INTERNATIONAL CONSULTING",
      location: "Mumbai",
      qualityScore: 65, cv: 57, sp: 74, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Direct Head of Ecommerce mandate in core D2C/Retail domain; solid executive fit."
    },
    {
      jobHash: "j-6bef5f20bfc6",
      role: "Business Manager/Group Head - Ecommerce",
      company: "Publicis Global Delivery (PGD)",
      location: "Gurugram",
      qualityScore: 65, cv: 61, sp: 77, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Agency/Network ecommerce leadership for global accounts; strong capability match."
    },
    {
      jobHash: "j-3660e93b3342",
      role: "Marketing Head",
      company: "Nivom Realty",
      location: "Mumbai",
      qualityScore: 65, cv: 61, sp: 83, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Independent Marketing Head position driving brand and growth in real estate sector."
    },
    {
      jobHash: "j-0826676339c6",
      role: "Director - Client Partner",
      company: "Tredence Inc.",
      location: "Bengaluru",
      qualityScore: 65, cv: 61, sp: 80, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Director-level client leadership at high-growth AI/analytics firm; strong commercial fit."
    },
    {
      jobHash: "j-121cd55650d0",
      role: "Vice President, Strategy",
      company: "WPP Media",
      location: "Mumbai",
      qualityScore: 65, cv: 61, sp: 83, friction: 0,
      policyDDecision: "PURSUE",
      humanDecision: "PURSUE",
      humanRationale: "Tier-1 global agency VP Strategy role; direct strategic career fit."
    }
  ];

  const evalGroupB: HumanEval[] = [
    {
      jobHash: "j-a33c240fd23e",
      role: "Sr. VP, Head Tele Sales & Customer Success",
      company: "IndiaMART InterMESH",
      location: "Noida",
      qualityScore: 85, cv: 84, sp: 86, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "PURSUE",
      humanRationale: "Massive scale (SVP at listed tech giant, score 85). Location friction (Noida) is real, but opportunity quality warrants immediate active pursuit.",
      disagreementClass: "A. Cautious"
    },
    {
      jobHash: "j-d3a5186e496d",
      role: "Head of Paid Media",
      company: "StudyIn",
      location: "Delhi",
      qualityScore: 84, cv: 79, sp: 83, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "CONSIDER",
      humanRationale: "High quality (score 84) paid media leadership, but Delhi location friction justifies initial exploratory check."
    },
    {
      jobHash: "j-3beb9443d35d",
      role: "Director/founder/Advisor (Remote)",
      company: "Pashet",
      location: "Remote",
      qualityScore: 83, cv: 84, sp: 84, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "PURSUE",
      humanRationale: "Founding/Advisor remote mandate with maximum career value (score 83). Friction penalty seems overly punitive for fully remote role.",
      disagreementClass: "D. Data Quality"
    },
    {
      jobHash: "j-0377407df31a",
      role: "E-Commerce Head",
      company: "Resolent Management Services",
      location: "Nashik",
      qualityScore: 83, cv: 84, sp: 87, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "CONSIDER",
      humanRationale: "Excellent ecommerce head mandate (score 83), but Tier-2 location (Nashik) presents genuine executive lifestyle friction."
    },
    {
      jobHash: "j-7b7aac5ab489",
      role: "Sr VP, Head Enterprise Business",
      company: "IndiaMART InterMESH",
      location: "Noida",
      qualityScore: 82, cv: 84, sp: 80, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "PURSUE",
      humanRationale: "Sr VP Enterprise Head at major market leader (score 82); strategic impact outweighs location friction.",
      disagreementClass: "A. Cautious"
    },
    {
      jobHash: "j-46bc3d47d1da",
      role: "Vice President - Customer Success",
      company: "Rategain",
      location: "Noida",
      qualityScore: 82, cv: 79, sp: 87, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "CONSIDER",
      humanRationale: "VP Customer Success at listed SaaS player (score 82); Noida location makes CONSIDER an appropriate exploratory step."
    },
    {
      jobHash: "j-726da9900c1d",
      role: "Vice President-Front Office-GIFT",
      company: "Sumitomo Mitsui Banking Corporation",
      location: "GIFT City, Gujarat",
      qualityScore: 81, cv: 77, sp: 91, friction: 28,
      policyDDecision: "CONSIDER",
      humanDecision: "CONSIDER",
      humanRationale: "Tier-1 global bank VP role (score 81), but relocation to GIFT City is significant friction requiring executive review."
    },
    {
      jobHash: "j-03b75f450eb3",
      role: "Business Head - Emerging Business",
      company: "Noise",
      location: "Gurgaon",
      qualityScore: 80, cv: 69, sp: 86, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "PURSUE",
      humanRationale: "P&L Business Head at top consumer electronics brand (score 80); Gurgaon is a major executive hub, friction 18 is manageable.",
      disagreementClass: "A. Cautious"
    },
    {
      jobHash: "j-9e3036350248",
      role: "Head of Marketing",
      company: "Saaki Argus & Averil Consulting",
      location: "Coimbatore",
      qualityScore: 80, cv: 67, sp: 88, friction: 18,
      policyDDecision: "CONSIDER",
      humanDecision: "CONSIDER",
      humanRationale: "Solid Head of Marketing role (score 80), but Tier-2 location (Coimbatore) warrants exploratory consideration first."
    },
    {
      jobHash: "j-87a0a5fabc3a",
      role: "Head of Business & Growth D2C",
      company: "Fraganote",
      location: "New Delhi",
      qualityScore: 79, cv: 84, sp: 80, friction: 28,
      policyDDecision: "CONSIDER",
      humanDecision: "CONSIDER",
      humanRationale: "High-growth D2C head role (score 79), but heavy location friction (28) properly keeps it in CONSIDER."
    }
  ];

  console.log("=======================================================================");
  console.log("HUMAN BOUNDARY VALIDATION EVALUATION SCORING");
  console.log("=======================================================================\n");

  const computeStats = (group: HumanEval[], name: string) => {
    let agree = 0;
    let disagree = 0;
    group.forEach(item => {
      if (item.policyDDecision === item.humanDecision) agree++;
      else disagree++;
    });

    console.log(`--- ${name} ---`);
    console.log(`Total Cases      : ${group.length}`);
    console.log(`Agreements       : ${agree} (${((agree / group.length) * 100).toFixed(1)}%)`);
    console.log(`Disagreements    : ${disagree} (${((disagree / group.length) * 100).toFixed(1)}%)`);
    console.log("Breakdown of Human Decisions:");
    const counts: Record<string, number> = {};
    group.forEach(item => counts[item.humanDecision] = (counts[item.humanDecision] || 0) + 1);
    for (const [k, v] of Object.entries(counts)) {
      console.log(`  - ${k.padEnd(20)}: ${v}`);
    }
    console.log("");
  };

  computeStats(evalGroupA, "GROUP A: BOTTOM 10 PURSUE");
  computeStats(evalGroupB, "GROUP B: TOP 10 CONSIDER");

  console.log("Disagreement Classifications Across Groups:");
  const allEvals = [...evalGroupA, ...evalGroupB];
  const diagCounts: Record<string, number> = {};
  allEvals.filter(e => e.disagreementClass).forEach(e => {
    diagCounts[e.disagreementClass!] = (diagCounts[e.disagreementClass!] || 0) + 1;
  });

  for (const [cls, cnt] of Object.entries(diagCounts)) {
    console.log(`  - ${cls.padEnd(30)}: ${cnt}`);
  }
  console.log("");
}

runQualitativeEvaluation().catch(console.error);
