import { v4 as uuidv4 } from "uuid";
import { getDatabaseAdapter } from "../../src/data/database";

export async function seedAcquisition() {
  console.log("Seeding Acquisition Domain (V1)...");
  const db = getDatabaseAdapter();

  const versionId = uuidv4();
  await db.execute(`INSERT OR IGNORE INTO catalog_versions (id, version_string) VALUES (?, ?)`, [versionId, "v1.0"]);

  const campaignId = uuidv4();
  await db.execute(`INSERT OR IGNORE INTO acquisition_campaigns (id, name) VALUES (?, ?)`, [campaignId, "Executive Leadership"]);

  const strategyId = uuidv4();
  await db.execute(`
    INSERT OR IGNORE INTO acquisition_strategies (id, campaign_id, catalog_version_id, name, freshness_target_days)
    VALUES (?, ?, ?, ?, ?)
  `, [strategyId, campaignId, versionId, "Global Executive Search", 7]);

  // Define some families and their intents
  const families = [
    { name: "Marketing Leadership", weight: 1.0, priority: 100, intents: ["Chief Marketing Officer", "VP Marketing"] },
    { name: "Commercial Leadership", weight: 0.9, priority: 95, intents: ["Chief Commercial Officer", "VP Sales"] },
    { name: "Growth", weight: 0.85, priority: 90, intents: ["Chief Growth Officer", "VP Growth"] },
    { name: "Digital Transformation", weight: 0.95, priority: 100, intents: ["Chief Digital Officer", "VP Digital Transformation"] },
    { name: "Customer Experience", weight: 0.8, priority: 85, intents: ["Chief Customer Officer", "VP Customer Experience"] },
    { name: "AI Leadership", weight: 1.0, priority: 90, intents: ["Chief AI Officer", "VP Artificial Intelligence"] },
    { name: "Capability Centers", weight: 0.9, priority: 95, intents: ["GCC Head", "Capability Center Director"] },
    { name: "Martech", weight: 0.85, priority: 80, intents: ["Head of Martech", "VP Marketing Technology"] },
    { name: "Performance Marketing", weight: 0.85, priority: 80, intents: ["Head of Performance Marketing"] },
    { name: "E-commerce", weight: 0.8, priority: 75, intents: ["Head of E-commerce", "VP Ecommerce"] },
    { name: "CRM", weight: 0.8, priority: 70, intents: ["Head of CRM", "VP Customer Retention"] },
    { name: "Loyalty", weight: 0.75, priority: 70, intents: ["Loyalty Director", "Head of Loyalty"] },
    { name: "Marketing Operations", weight: 0.7, priority: 60, intents: ["Marketing Operations Director"] },
    { name: "Demand Generation", weight: 0.75, priority: 65, intents: ["VP Demand Generation"] },
    { name: "Digital Strategy", weight: 0.85, priority: 85, intents: ["VP Digital Strategy"] },
    { name: "Business Transformation", weight: 0.9, priority: 90, intents: ["Chief Transformation Officer"] },
    { name: "Customer Analytics", weight: 0.75, priority: 70, intents: ["Director Customer Analytics"] },
    { name: "Omnichannel", weight: 0.8, priority: 75, intents: ["VP Omnichannel"] },
    { name: "Retail Media", weight: 0.7, priority: 60, intents: ["Head of Retail Media"] },
    { name: "B2B Marketing Leadership", weight: 0.85, priority: 85, intents: ["VP B2B Marketing"] },
    { name: "SaaS Marketing Leadership", weight: 0.85, priority: 85, intents: ["VP Marketing SaaS"] },
    { name: "Automotive Digital", weight: 0.7, priority: 60, intents: ["Digital Director Automotive"] },
    { name: "Consulting Partner (Digital)", weight: 0.9, priority: 90, intents: ["Digital Consulting Partner"] },
    { name: "Strategy & Transformation", weight: 0.9, priority: 95, intents: ["VP Strategy and Transformation"] },
    { name: "Regional Marketing", weight: 0.8, priority: 80, intents: ["APAC Marketing Director"] },
    { name: "Commercial Excellence", weight: 0.8, priority: 75, intents: ["VP Commercial Excellence"] },
    { name: "Revenue", weight: 0.9, priority: 95, intents: ["Chief Revenue Officer"] },
    { name: "Brand Marketing", weight: 0.6, priority: 50, intents: ["VP Brand Marketing"] },
    { name: "AI Evangelist", weight: 0.5, priority: 40, intents: ["AI Evangelist"] },
    { name: "Product Marketing", weight: 0.7, priority: 65, intents: ["VP Product Marketing"] }
  ];

  let definitionCount = 0;

  await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM search_families WHERE strategy_id = ?`, [strategyId]);
    
    for (const fam of families) {
      const famId = uuidv4();
      await tx.execute(`INSERT INTO search_families (id, strategy_id, name, weight) VALUES (?, ?, ?, ?)`, [famId, strategyId, fam.name, fam.weight]);

      for (const intentName of fam.intents) {
        const intentId = uuidv4();
        await tx.execute(`INSERT INTO search_intents (id, family_id, name) VALUES (?, ?, ?)`, [intentId, famId, intentName]);
        
        const templateId = uuidv4();
        await tx.execute(`INSERT INTO query_templates (id, intent_id, template) VALUES (?, ?, ?)`, [templateId, intentId, "{{intent}}"]);

        const portals = ["LinkedIn", "Indeed", "Naukri"];
        const locations = ["India"];

        for (const portal of portals) {
          for (const loc of locations) {
            const defId = uuidv4();
            const rawQuery = `${intentName}`;
            const isRemote = loc === "Remote" ? 1 : 0;
            const res = await tx.execute(
              `INSERT OR IGNORE INTO search_definitions (id, intent_id, portal, location, industry, is_remote, raw_query, status, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [defId, intentId, portal, loc, null, isRemote, rawQuery, 'ACTIVE', fam.priority]
            );
            if (res.rowsAffected > 0) definitionCount++;
          }
        }
      }
    }
  });

  console.log(`Successfully seeded ${families.length} families, ${families.reduce((acc, f) => acc + f.intents.length, 0)} intents, and ${definitionCount} Search Definitions.`);
}

if (process.argv[1]?.includes("seed-acquisition")) {
  seedAcquisition().catch(console.error);
}
