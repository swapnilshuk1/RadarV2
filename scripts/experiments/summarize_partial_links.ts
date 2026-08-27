import fs from "fs";
import path from "path";

function summarizePartialLinks() {
  const jsonPath = path.join(process.cwd(), ".scraper-artifacts", "partial_payload_inspection.json");
  const rawData: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  console.log(`\n================================================================`);
  console.log(`  PARTIAL-QUALITY NAUKRI CARDS LINK & APPLY ANALYSIS (${rawData.length} CARDS)`);
  console.log(`================================================================\n`);

  const summary = rawData.map((item, idx) => {
    const raw = item.fullRaw;
    const hasApplyRedirect = !!raw.applyRedirectUrl;
    const applyType = raw.jobApplyType || "N/A";
    const applyRedirectUrl = raw.applyRedirectUrl || "NONE";
    const isConsultant = !!raw.consultant;

    let destinationDomain = "NONE";
    if (hasApplyRedirect) {
      try {
        destinationDomain = new URL(raw.applyRedirectUrl).hostname;
      } catch {
        destinationDomain = "INVALID_URL";
      }
    }

    return {
      index: idx + 1,
      jobId: raw.jobId,
      title: raw.title,
      company: raw.companyName,
      descLength: item.descLength,
      applyType,
      hasApplyRedirect,
      destinationDomain,
      applyRedirectUrl,
      isConsultant,
      tags: raw.tagsAndSkills
    };
  });

  console.table(
    summary.map((s) => ({
      "#": s.index,
      Role: s.title.slice(0, 35),
      Company: s.company.slice(0, 20),
      "Desc Len": s.descLength,
      "Apply Type": s.applyType,
      "Ext Link?": s.hasApplyRedirect ? "YES" : "NO",
      "Ext Domain": s.destinationDomain
    }))
  );

  const redirectCount = summary.filter((s) => s.hasApplyRedirect).length;
  const quickApplyCount = summary.filter((s) => s.applyType === "quickApply").length;
  console.log(`\nSummary Statistics:`);
  console.log(`- Total Partial Jobs: ${summary.length}`);
  console.log(`- With External ApplyRedirectUrl: ${redirectCount} (${Math.round((redirectCount / summary.length) * 100)}%)`);
  console.log(`- QuickApply / Consultant In-Portal Jobs: ${quickApplyCount} (${Math.round((quickApplyCount / summary.length) * 100)}%)`);

  const outSummary = path.join(process.cwd(), ".scraper-artifacts", "partial_link_analysis_summary.json");
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), "utf8");
}

summarizePartialLinks();
