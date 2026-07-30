import { IdentityDistanceCalculator } from "../src/lib/intelligence/utils/IdentityDistanceCalculator";

console.log("=================================================");
console.log("   RUNNING PROFESSIONAL IDENTITY INVARIANTS TEST");
console.log("=================================================\n");

let passed = true;
const candIdentity = "Commercial & Marketing Leadership";

const testCases = [
  {
    name: "Marketing Exec -> IT Delivery (VOIS)",
    jobIdentity: "Operations & Delivery Leadership",
    jobText: "VOIS IT Delivery and Transformation function SAFe programme delivery Power Automate",
    expectedReject: true
  },
  {
    name: "Marketing Exec -> Salesforce CPQ Architect (TechTorch)",
    jobIdentity: "Technology & Engineering Leadership",
    jobText: "AVP Commercial Excellence Salesforce Architect CPQ Agentforce Revenue Apex LWC vibe coding",
    expectedReject: true
  },
  {
    name: "Marketing Exec -> Brand Marketing Director (Leela)",
    jobIdentity: "Commercial & Marketing Leadership",
    jobText: "Director Brand Communications luxury hospitality PR public relations brand storytelling",
    expectedReject: false
  },
  {
    name: "Marketing Exec -> Performance Marketing (Simplilearn)",
    jobIdentity: "Commercial & Marketing Leadership",
    jobText: "Associate Director Performance Marketing US Market paid growth user acquisition google ads meta ads",
    expectedReject: false
  },
  {
    name: "Marketing Exec -> Customer Success (Axestrack)",
    jobIdentity: "Commercial & Marketing Leadership",
    jobText: "Head of Customer Success NRR retention renewals account management",
    expectedReject: false
  },
  {
    name: "Marketing Exec -> Clinical Affairs Director",
    jobIdentity: "Clinical & Medical Leadership",
    jobText: "Director Medical Affairs clinical research pharma governance",
    expectedReject: true
  }
];

testCases.forEach((tc, idx) => {
  const distance = IdentityDistanceCalculator.calculate(candIdentity, tc.jobIdentity, tc.jobText);
  const isRejected = distance >= 0.80;

  console.log(`Test ${idx + 1}: ${tc.name}`);
  console.log(`  Calculated Semantic Distance: ${distance.toFixed(2)}`);

  if (isRejected === tc.expectedReject) {
    console.log(`  Passed: ${isRejected ? "REJECTED as expected" : "ALLOWED as expected"}`);
  } else {
    console.log(`  FAILED: Expected ${tc.expectedReject ? "REJECT" : "ALLOW"}, got ${isRejected ? "REJECT" : "ALLOW"}`);
    passed = false;
  }
  console.log("");
});

console.log("=================================================");
if (passed) {
  console.log("ALL IDENTITY INVARIANT TESTS PASSED.");
} else {
  console.log("IDENTITY INVARIANT TESTS FAILED.");
  process.exit(1);
}
console.log("=================================================");

