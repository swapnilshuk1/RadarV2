import { runEngineSingle } from "./engine";

const result = runEngineSingle("j-91004f14fb2f", 0);
console.log("=========================================");
console.log("INSPECTING SALESFORCE JOB");
console.log("=========================================");
console.log("Role:", result?.opportunity.role);
console.log("Company:", result?.opportunity.company);
console.log("Decision:", result?.opportunity.decision);
console.log("Score / Priority:", result?.opportunity.recommendationResult?.score);
console.log("=========================================");
console.log("Full Result:", JSON.stringify(result, null, 2));
