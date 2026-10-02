import path from "node:path";
import { loadUnifiedEnvironment } from "../../src/lib/env";
import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../../src/data/database";
import { getBlobStore } from "../../src/lib/storage/blob-store";
import { assertAcquisitionHost } from "../../src/acquisition/execution-role";
import { runAcquisitionRetention } from "../../src/acquisition/retention";
loadUnifiedEnvironment();
assertAcquisitionHost();
if (
  !process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT ||
  getDatabaseTargetIdentity().fingerprint !== process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT
) {
  throw new Error("RETENTION_DATABASE_TARGET_MISMATCH");
}
const db = getDatabaseAdapter();
try {
  console.log(
    JSON.stringify(
      await runAcquisitionRetention(db, getBlobStore({ enforceDistributed: true }), {
        artifactsDir: path.resolve(process.env.SCRAPER_ARTIFACTS_DIR || ".scraper-artifacts"),
        outboxDir: path.resolve(
          process.env.RADAR_ACQUISITION_OUTBOX_DIR || ".radar/acquisition-outbox",
        ),
        apply: process.argv.includes("--apply"),
      }),
      null,
      2,
    ),
  );
} finally {
  await db.close?.();
}
