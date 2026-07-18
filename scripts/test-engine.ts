import { OpportunityProvider } from "../src/lib/intelligence/opportunity-provider";

async function main() {
  const o = OpportunityProvider.get("j-07873ec4648e");
  if (!o) return;
  console.log(JSON.stringify(o.dimensions[0].jdEvidence, null, 2));
}
main();
