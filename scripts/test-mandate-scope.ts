import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";

async function runMandateScopeGuardrailTest() {
  console.log("=================================================================");
  console.log("   INDEPENDENT MANDATE SCOPE GUARDRAIL TEST (BMW vs JAQUAR)");
  console.log("=================================================================\n");

  const testCases = [
    {
      company: "BMW India",
      role: "Chief Marketing Officer (CMO)",
      text: "BMW India is looking for a Chief Marketing Officer to drive global brand strategy, commercial growth, enterprise P&L, and luxury market expansion across India.",
      expectedScope: "ENTERPRISE"
    },
    {
      company: "Reliance Retail",
      role: "Chief Growth Officer, D2C",
      text: "Reliance Retail requires a Chief Growth Officer to lead enterprise D2C commercial expansion, company-wide revenue ownership, and multi-brand growth.",
      expectedScope: "ENTERPRISE"
    },
    {
      company: "Flipkart",
      role: "VP Growth Marketing",
      text: "Flipkart is hiring a VP Growth Marketing to lead company-wide user acquisition, enterprise performance marketing, and commercial expansion.",
      expectedScope: "ENTERPRISE"
    },
    {
      company: "Jaquar Group",
      role: "Retail Head",
      text: "Jaquar Group is hiring a Retail Head to oversee retail store operations, store footprint expansion, and showroom sales execution across North India.",
      expectedScope: "CHANNEL"
    },
    {
      company: "Fraganote",
      role: "Head of Business & Growth D2C",
      text: "Fraganote is hiring a Head of D2C to manage online Shopify storefront sales, D2C paid acquisition, and performance marketing execution.",
      expectedScope: "CHANNEL"
    },
    {
      company: "NSRCEL",
      role: "Head - Growth Accelerator",
      text: "NSRCEL is hiring a Head of Growth Accelerator to manage incubator cohort mentoring, startup accelerator programs, and incubator events.",
      expectedScope: "CHANNEL"
    }
  ];

  console.log("--- EVALUATING INDEPENDENT MANDATE SCOPE ---");
  for (const tc of testCases) {
    const ma = OpportunityAssessmentEngine.assessMandate(tc.text, tc.role);
    const scopeMatch = (ma as any).scope === tc.expectedScope;
    console.log(`• ${tc.company} — ${tc.role}`);
    console.log(`   Evaluated Mandate Scope : ${(ma as any).scope} [Expected: ${tc.expectedScope}]`);
    console.log(`   Guardrail Test Result   : ${scopeMatch ? "PASSED ✅" : "FAILED ❌"}\n`);
  }
}

runMandateScopeGuardrailTest().catch(console.error);
