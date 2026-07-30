import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";

const medicalJobPayload = {
  jobHash: "TEST-MED-001",
  role: "Director - Medical Affairs",
  company: "Pharma Corp",
  description: "Lead clinical research operations and medical governance. Must drive business growth and expansion strategies across the portfolio.",
  location: "Remote",
  dimensions: []
};

const technologyJobPayload = {
  jobHash: "TEST-TECH-001",
  role: "Technology Head",
  company: "Cloud Systems Inc.",
  description: "Own the technology vision, cloud-native architecture, and platform engineering teams. Scale systems for maximum performance and throughput.",
  location: "On-site",
  dimensions: []
};

const operationsJobPayload = {
  jobHash: "TEST-OPS-001",
  role: "Operations Director",
  company: "Logistics Hub",
  description: "Run national operations, ensure SLA compliance, manage multi-vendor budgets, and protect margins.",
  location: "Hybrid",
  dimensions: []
};

const marketingJobPayload = {
  jobHash: "TEST-MKT-001",
  role: "Marketing Head",
  company: "E-Commerce Start",
  description: "Drive user acquisition, paid growth, and e-commerce strategy. Manage the performance marketing budget.",
  location: "Remote",
  dimensions: []
};


console.log("=========================================");
console.log("   RUNNING PROJECTION REGRESSION TESTS");
console.log("=========================================\n");

let passed = true;

console.log("Test 1: Identity Regression (Medical)");
const medProj = JobProjectionBuilder.build(medicalJobPayload as any);
if (medProj.executiveIdentity.value === "Clinical & Medical Leadership") {
  console.log("Passed: Identity correctly identified as Clinical & Medical Leadership");
} else {
  console.log("Failed: Expected Clinical & Medical Leadership, got " + medProj.executiveIdentity.value);
  passed = false;
}
if (medProj.capabilities && medProj.capabilities.find((c: any) => c.name === "Growth Marketing & Acquisition")) {
  console.log("Failed: Incorrectly extracted Growth Marketing due to substring hallucination");
  passed = false;
} else {
  console.log("Passed: Ignored growth substring for Growth Marketing capability");
}
console.log("");

console.log("Test 2: Capability Hallucination (Technology)");
const techProj = JobProjectionBuilder.build(technologyJobPayload as any);
if (techProj.executiveIdentity.value === "Technology & Engineering Leadership") {
  console.log("Passed: Identity correctly identified as Technology & Engineering Leadership");
} else {
  console.log("Failed: Expected Technology & Engineering Leadership, got " + techProj.executiveIdentity.value);
  passed = false;
}
if (techProj.capabilities && techProj.capabilities.find((c: any) => c.name === "Performance Marketing")) {
  console.log("Failed: Incorrectly extracted Performance Marketing due to substring hallucination");
  passed = false;
} else {
  console.log("Passed: Ignored performance substring for Performance Marketing capability");
}
console.log("");

console.log("Test 3: Theme Dimensional Split (Operations)");
const opsProj = JobProjectionBuilder.build(operationsJobPayload as any);
if (opsProj.executiveIdentity.value === "Operations & Delivery Leadership") {
  console.log("Passed: Identity correctly identified as Operations & Delivery Leadership");
} else {
  console.log("Failed: Expected Operations & Delivery Leadership, got " + opsProj.executiveIdentity.value);
  passed = false;
}
if (opsProj.executiveFunction && opsProj.executiveFunction.includes("Operations")) {
  console.log("Passed: Function includes Operations");
} else {
  console.log("Failed: Function missing Operations. Got: " + (opsProj.executiveFunction ? opsProj.executiveFunction.join(",") : "none"));
  passed = false;
}
if (opsProj.executionStyle && opsProj.executionStyle.includes("Delivery")) {
  console.log("Passed: Execution Style includes Delivery");
} else {
  console.log("Failed: Execution Style missing Delivery. Got: " + (opsProj.executionStyle ? opsProj.executionStyle.join(",") : "none"));
  passed = false;
}
console.log("");

console.log("Test 4: Contextual Phrase Match (Marketing)");
const mktProj = JobProjectionBuilder.build(marketingJobPayload as any);
if (mktProj.executiveIdentity.value === "Commercial & Marketing Leadership") {
  console.log("Passed: Identity correctly identified as Commercial & Marketing Leadership");
} else {
  console.log("Failed: Expected Commercial & Marketing Leadership, got " + mktProj.executiveIdentity.value);
  passed = false;
}

const hasUserAcq = mktProj.capabilities && mktProj.capabilities.find((c: any) => c.name === "Growth Marketing & Acquisition");
const hasPerfMkt = mktProj.capabilities && mktProj.capabilities.find((c: any) => c.name === "Performance Marketing");

if (hasUserAcq && hasPerfMkt) {
  console.log("Passed: Correctly extracted contextual marketing phrases (Growth & Performance)");
} else {
  console.log("Failed: Did not extract required capabilities. Caps: " + (mktProj.capabilities ? mktProj.capabilities.map((c: any) => c.name).join(", ") : "none"));
  passed = false;
}
console.log("");


console.log("=========================================");
if (passed) {
  console.log("ALL REGRESSION TESTS PASSED.");
} else {
  console.log("REGRESSION TESTS FAILED.");
  process.exit(1);
}
console.log("=========================================");

