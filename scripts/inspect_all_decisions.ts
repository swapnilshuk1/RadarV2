import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectAllLegacyDecisions() {
  const db = getDatabaseAdapter();
  const allLegacyDecisions = await db.many<any>("SELECT * FROM decisions");
  
  const mappedToCanonical = [];
  const testMocks = [];
  const oPrefix = [];
  const other = [];

  for (const d of allLegacyDecisions) {
    if (d.opportunity_id.startsWith("j-")) {
      mappedToCanonical.push(d);
    } else if (d.opportunity_id.startsWith("job_") || d.opportunity_id.startsWith("op-test")) {
      testMocks.push(d);
    } else if (d.opportunity_id.startsWith("o_")) {
      oPrefix.push(d);
    } else {
      other.push(d);
    }
  }

  console.log({
    total: allLegacyDecisions.length,
    mappedToCanonical: mappedToCanonical.length,
    testMocks: testMocks.length,
    oPrefix: oPrefix.length,
    other: other.length,
    otherItems: other,
    oPrefixItems: oPrefix
  });
}

inspectAllLegacyDecisions().catch(console.error);
