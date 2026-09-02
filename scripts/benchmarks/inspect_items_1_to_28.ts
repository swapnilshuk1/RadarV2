import * as fs from "fs";
import * as path from "path";

function inspectItems1to28() {
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

  for (let i = 0; i < 28; i++) {
    const p = snapshotPaths[i];
    if (!fs.existsSync(p)) continue;
    const snap = JSON.parse(fs.readFileSync(p, "utf-8"));

    const cardRawText = snap.rawText || "";
    const detailRawText = snap.detail?.rawText || "";
    const effectiveText = detailRawText || cardRawText;

    const startsWithScript =
      effectiveText.trim().startsWith("var ") ||
      effectiveText.trim().startsWith("(function") ||
      effectiveText.includes("window.ub =") ||
      effectiveText.includes("rmkcdn.successfactors.com") ||
      effectiveText.includes("Cookie information Welcome to the EY");

    console.log(`[#${i + 1}] [${snap.portal}] "${snap.title}" @ "${snap.company}" | Route: ${snap.acquisitionRoute} | DetailLen: ${detailRawText.length} | Script: ${startsWithScript}`);
    console.log(`     Text Snippet: "${effectiveText.slice(0, 100).replace(/\s+/g, ' ')}"`);
  }
}

inspectItems1to28();
