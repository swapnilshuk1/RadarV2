import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectDecisions() {
  const db = getDatabaseAdapter();

  let retries = 3;
  while (retries > 0) {
    try {
      const sampleLegacy = await db.many<any>("SELECT * FROM decisions LIMIT 10");
      console.log("Sample legacy decisions:", sampleLegacy);

      const sampleCanonical = await db.many<any>("SELECT * FROM canonical_decisions LIMIT 10");
      console.log("\nSample canonical decisions:", sampleCanonical);
      break;
    } catch (err) {
      console.error("Retrying after error:", err);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

inspectDecisions().catch(console.error);
