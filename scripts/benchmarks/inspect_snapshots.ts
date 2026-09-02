import * as fs from "fs";
import * as path from "path";

function inspectSnapshots() {
  const journalPath = path.resolve(
    process.cwd(),
    ".scraper-artifacts/runs/run-1788182498220/journal.ndjson"
  );
  const journalLines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);

  const snapshots: any[] = [];
  for (const line of journalLines) {
    const ev = JSON.parse(line);
    if (ev.type === "snapshot_written") {
      snapshots.push(ev);
    }
  }

  console.log(`Found ${snapshots.length} snapshot_written events:`);
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    console.log(`${i + 1}. [${s.portal}] "${s.title}" @ "${s.company}" | jobHash: ${s.jobHash} | path: ${s.path}`);
  }

  fs.writeFileSync(
    path.resolve(process.cwd(), "scraped_39_snapshots.json"),
    JSON.stringify(snapshots, null, 2)
  );
}

inspectSnapshots();
