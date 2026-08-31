import * as fs from "fs";
import * as path from "path";

function inspectAll41() {
  const journalPath = path.resolve(
    process.cwd(),
    ".scraper-artifacts/runs/run-1788182498220/journal.ndjson"
  );
  const journalLines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);

  const snapshotPaths: string[] = [];
  for (const line of journalLines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "snapshot_written" && ev.path) {
        snapshotPaths.push(ev.path);
      }
    } catch (e) {}
  }

  console.log(`Analyzing ${snapshotPaths.length} snapshots...`);

  for (let i = 0; i < snapshotPaths.length; i++) {
    const p = snapshotPaths[i];
    if (!fs.existsSync(p)) continue;
    const snap = JSON.parse(fs.readFileSync(p, "utf-8"));

    const cardRawText = snap.rawText || "";
    const detailRawText = snap.detail?.rawText || "";
    const rawHtml = snap.rawHtml || snap.detail?.rawHtml || "";
    const detailRawHtml = snap.detail?.rawHtml || "";

    const effectiveText = detailRawText || cardRawText;
    const effectiveHtml = detailRawHtml || rawHtml;

    const startsWithScript =
      effectiveText.trim().startsWith("var ") ||
      effectiveText.trim().startsWith("(function") ||
      effectiveText.includes("window.ub =") ||
      effectiveText.includes("rmkcdn.successfactors.com");

    const hasHtmlInText = effectiveText.includes("<div") || effectiveText.includes("<script") || effectiveText.includes("<style");

    console.log(`\n[#${i + 1}] [${snap.portal}] "${snap.title}" @ "${snap.company}"`);
    console.log(`   Detail URL: ${snap.detailUrl}`);
    console.log(`   Acquisition Route: ${snap.acquisitionRoute || 'N/A'}`);
    console.log(`   Card Text Len: ${cardRawText.length} | Detail Text Len: ${detailRawText.length} | Html Len: ${effectiveHtml.length}`);
    console.log(`   Starts with Script: ${startsWithScript} | Has HTML in text: ${hasHtmlInText}`);
    console.log(`   Text Snippet: "${effectiveText.slice(0, 150).replace(/\s+/g, ' ')}"`);
  }
}

inspectAll41();
