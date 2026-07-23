import { CandidateIntelligencePipeline } from "./cip";

const cip = new CandidateIntelligencePipeline();
const { intent } = cip.getActiveDossier();
console.log("Candidate Intent:", JSON.stringify(intent, null, 2));
