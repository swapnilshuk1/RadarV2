import { getDatabaseAdapter } from "../src/data/database/index.js";

async function main() {
  const db = getDatabaseAdapter();
  
  // Search for the ground-truth cases by URL fragments or keywords
  const targets = [
    { label: "Case A (Indeed -> External ATS)", pattern: "%377d4898b4be8a70%" },
    { label: "Case B (Indeed P0 Accordion)", pattern: "%cdfc18533516735f%" },
    { label: "Case C (Naukri Skyleaf Head of Operations)", pattern: "%030826019779%" },
    { label: "Case D (Naukri Deputy GM Commercial)", pattern: "%210726019943%" },
    { label: "Case E (Naukri Head of Marketing Workoid)", pattern: "%100826005217%" },
    { label: "Case F (Naukri Director Ops IQSA)", pattern: "%050826009123%" },
    { label: "Case G (Naukri Expired Alvarez)", pattern: "%190726015522%" },
  ];

  console.log("=== INSPECTING GROUND TRUTH FORENSIC CASES ===");

  for (const t of targets) {
    const opps = await db.many(
      `SELECT o.*, c.name as company_name 
       FROM opportunities o 
       LEFT JOIN companies c ON o.company_id = c.id 
       WHERE o.id IN (
         SELECT opportunity_id FROM documents WHERE content LIKE ?
       )`,
      [t.pattern]
    );

    console.log(`\n--------------------------------------------------`);
    console.log(`TARGET: ${t.label} (Pattern: ${t.pattern})`);
    console.log(`Matched Opportunities: ${opps.length}`);

    for (const opp of opps) {
      console.log(`\n  Opp ID: ${opp.id}`);
      console.log(`  Title: ${opp.canonical_title}`);
      console.log(`  Company: ${opp.company_name}`);
      console.log(`  Location: ${opp.location}`);
      console.log(`  Source URL: ${opp.source_url}`);
      console.log(`  Created At: ${opp.created_at}`);

      const docs = await db.many(
        `SELECT id, payload_type, length(content) as content_len, content 
         FROM documents WHERE opportunity_id = ?`,
        [opp.id]
      );
      console.log(`  Documents (${docs.length}):`);
      for (const d of docs) {
        let wordCount = 0;
        let charCount = 0;
        let snippet = "";
        let failureReason = "";
        try {
          const parsed = JSON.parse(d.content);
          const rawText = parsed.normalizedText || parsed.rawText || parsed.detail?.rawText || (typeof parsed === "string" ? parsed : "");
          wordCount = rawText.split(/\s+/).filter(Boolean).length;
          charCount = rawText.length;
          snippet = rawText.substring(0, 160);
          failureReason = parsed.telemetry?.llmFallbackReason || parsed.telemetry?.extractorId || "";
        } catch {
          wordCount = d.content.split(/\s+/).filter(Boolean).length;
          charCount = d.content.length;
          snippet = d.content.substring(0, 160);
        }
        console.log(`    - Doc ${d.id} [${d.payload_type}]: ${charCount} chars, ${wordCount} words | fallbackReason: ${failureReason}`);
        console.log(`      Snippet: "${snippet.replace(/\n/g, ' ')}"`);
      }

      const ledger = await db.one(
        `SELECT * FROM acquisition_ledger WHERE canonical_job_id = ?`,
        [opp.id]
      );
      if (ledger) {
        console.log(`  Acquisition Ledger: state=${ledger.state}, quality=${ledger.acquisition_quality}, method=${ledger.last_acquisition_method}, portal=${ledger.source_portal}`);
      }

      try {
        const assess = await db.one(
          `SELECT * FROM assessments WHERE opportunity_id = ?`,
          [opp.id]
        );
        if (assess) {
          console.log(`  Assessment:`, assess);
        }
      } catch (err: any) {
        console.log(`  Assessment query error:`, err.message);
      }
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error inspecting cases:", err);
  process.exit(1);
});
