import { getDatabaseAdapter } from "../../src/data/database";

async function inspectAllRawContent() {
  const db = await getDatabaseAdapter();

  const titles = [
    "Assistant Manager, Chief Accounting & Capital Office",
    "Management Consultant",
    "Avantor - Technical Sales Manager - Single-Use Solutions",
    "OPENTEXT XECM",
    "Strategy & Transformation Senior Consultant",
    "Service Delivery Director",
    "SAP Financial Accounting",
    "S&C Global Network - AI - Supply Chain Analytics - Manager",
    "Vice President Transformer Sales For leading Company",
    "Marketing Head",
    "Head - Marketing - FinTech",
    "Vice President APAC",
    "Vice President, Valuations",
    "Associate Marketing Director, ADC India",
    "Head of Marketing Operations and Growth Initiatives",
    "Vice President of Growth",
  ];

  for (const title of titles) {
    const row = await db.one<any>(
      `SELECT co.id, co.source as portal, ov.job_title, ov.company_name, length(ov.raw_content) as content_len,
              ov.raw_content, me.decision, me.quality_score, me.vetoed, me.evaluation_json
       FROM canonical_opportunities co
       JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
       LEFT JOIN materialized_evaluations me ON co.id = me.canonical_job_id
       WHERE ov.job_title LIKE ? OR co.company_name LIKE ?
       ORDER BY co.created_at DESC
       LIMIT 1`,
      [`%${title}%`, `%${title}%`]
    );

    if (row) {
      console.log("\n============================================================");
      console.log(`[${row.portal}] "${row.job_title}" @ ${row.company_name} (Length: ${row.content_len} bytes)`);
      console.log(`Evaluation: Decision=${row.decision}, Score=${row.quality_score}, Vetoed=${row.vetoed}`);
      
      let evalObj: any = {};
      try { evalObj = JSON.parse(row.evaluation_json || "{}"); } catch(e) {}
      console.log(`Effective UI Decision: ${evalObj.effectiveDecision || evalObj.decision || row.decision}`);
      console.log(`UI Badge: ${JSON.stringify(evalObj.uiBadge || {})}`);
      console.log(`Veto Reason: ${evalObj.engineRecommendation?.vetoReason || evalObj.vetoReason || 'none'}`);
      console.log(`Veto Risk: ${JSON.stringify(evalObj.engineRecommendation?.decisionRisks || [])}`);
      
      // Clean preview of text
      const cleanSnippet = row.raw_content
        ? row.raw_content.slice(0, 300).replace(/\s+/g, ' ')
        : 'EMPTY';
      console.log(`Raw Content Start: "${cleanSnippet}"`);
    } else {
      console.log(`\nNot found: ${title}`);
    }
  }
}

inspectAllRawContent().catch(console.error);
