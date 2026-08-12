import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";

console.log("=================================================================");
console.log("          RADAR v2 MANDATE TITLE INVARIANCE HARD TEST");
console.log("=================================================================\n");

let passedTests = 0;
let totalTests = 0;

function assertTest(condition: boolean, testName: string, actual: any, expected: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.log(`❌ [FAIL] ${testName}`);
    console.log(`     Actual  : ${JSON.stringify(actual)}`);
    console.log(`     Expected: ${JSON.stringify(expected)}`);
  }
}

// -----------------------------------------------------------------
// TEST A: Title Variation on Fixed Executive P&L JD
// -----------------------------------------------------------------
console.log("--- TEST SUITE A: Title Invariance (Fixed Executive P&L JD) ---");
const execJD = "Owns regional revenue, CAC/LTV, P&L, GTM strategy, annual revenue targets, and 50-person organization.";

const titleVariations = [
  "VP Digital Marketing",
  "Head of Digital Marketing",
  "Director Digital Marketing",
  "Digital Marketing Lead"
];

for (const title of titleVariations) {
  const result = OpportunityAssessmentEngine.assessMandate(execJD, title);
  assertTest(
    result.type === "BUSINESS_GROWTH" && result.level === "EXECUTIVE",
    `Fixed Executive P&L JD with Title: "${title}"`,
    result,
    { type: "BUSINESS_GROWTH", level: "EXECUTIVE" }
  );
}

console.log("\n--- TEST SUITE B: Mandate Sensitivity (Fixed Title 'VP Digital Marketing') ---");
// -----------------------------------------------------------------
// TEST B: JD Variation on Fixed Title "VP Digital Marketing"
// -----------------------------------------------------------------
const titleFixed = "VP Digital Marketing";

const jdBusinessGrowth = "Owns regional revenue, CAC/LTV, P&L, GTM strategy, annual revenue targets, and 50-person organization.";
const jdExecution = "Manages campaigns, email deployment, copywriting, SEO execution, PPC execution, and reporting.";
const jdPlatform = "Configures SFMC journeys, CDP data pipelines, GA4 tracking setup, and MarTech infrastructure.";
const jdDelivery = "Manages client retainers, agency client services delivery, project retainers, and client relationships.";

const resultGrowth = OpportunityAssessmentEngine.assessMandate(jdBusinessGrowth, titleFixed);
assertTest(
  resultGrowth.type === "BUSINESS_GROWTH" && resultGrowth.level === "EXECUTIVE",
  `Fixed Title "${titleFixed}" + Executive P&L JD`,
  resultGrowth,
  { type: "BUSINESS_GROWTH", level: "EXECUTIVE" }
);

const resultExec = OpportunityAssessmentEngine.assessMandate(jdExecution, titleFixed);
assertTest(
  resultExec.type === "EXECUTION" && resultExec.level === "EXECUTION",
  `Fixed Title "${titleFixed}" + Tactical Execution JD`,
  resultExec,
  { type: "EXECUTION", level: "EXECUTION" }
);

const resultPlatform = OpportunityAssessmentEngine.assessMandate(jdPlatform, titleFixed);
assertTest(
  resultPlatform.type === "PLATFORM" && resultPlatform.level === "FUNCTIONAL",
  `Fixed Title "${titleFixed}" + MarTech Platform JD`,
  resultPlatform,
  { type: "PLATFORM", level: "FUNCTIONAL" }
);

const resultDelivery = OpportunityAssessmentEngine.assessMandate(jdDelivery, titleFixed);
assertTest(
  resultDelivery.type === "DELIVERY" && resultDelivery.level === "FUNCTIONAL",
  `Fixed Title "${titleFixed}" + Agency Delivery JD`,
  resultDelivery,
  { type: "DELIVERY", level: "FUNCTIONAL" }
);

console.log("\n=================================================================");
console.log(`TITLE INVARIANCE SUMMARY: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log("=================================================================\n");

if (passedTests !== totalTests) {
  process.exit(1);
}
