import fs from "node:fs";
import path from "node:path";
import type { DatabaseAdapter } from "../data/database";
import type { BlobStore } from "../lib/storage/blob-store";
import { handoffPrefix } from "./handoff";
import { acquireExecutionLease } from "./execution-lease";

export const RETENTION_DAYS = { handoff: 7, debug: 7, terminalRuns: 30 } as const;
const day = 86400_000;
const terminal = "'completed','failed','aborted'";

/** Deletes only regular files under explicitly selected artifact roots; never follows symlinks. */
function pruneFiles(root: string, cutoff: number, apply: boolean): number {
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) return 0;
  const absolute = fs.realpathSync(root);
  let count = 0;
  const visit = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (count >= 500) return;
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        visit(file);
        continue;
      }
      if (!item.isFile() || fs.statSync(file).mtimeMs >= cutoff) continue;
      const resolved = fs.realpathSync(file);
      if (!resolved.startsWith(absolute + path.sep)) throw new Error("RETENTION_PATH_ESCAPE");
      if (apply) fs.unlinkSync(resolved);
      count++;
    }
  };
  visit(absolute);
  return count;
}

export async function runAcquisitionRetention(
  db: DatabaseAdapter,
  store: BlobStore,
  options: {
    artifactsDir: string;
    outboxDir: string;
    apply?: boolean;
    now?: number;
  },
) {
  let lease;
  try {
    lease = await acquireExecutionLease(db);
  } catch (error) {
    if ((error as Error).message === "ACQUISITION_EXECUTION_BUSY")
      return { apply: options.apply === true, skipped: "acquisition_busy" };
    throw error;
  }
  try {
    return await retain(db, store, options, lease.renew);
  } finally {
    await lease.release();
  }
}

async function retain(
  db: DatabaseAdapter,
  store: BlobStore,
  options: {
    artifactsDir: string;
    outboxDir: string;
    apply?: boolean;
    now?: number;
  },
  renew: () => Promise<void>,
) {
  const now = options.now ?? Date.now(),
    apply = options.apply === true;
  const report = {
    apply,
    handoffObjects: 0,
    acknowledgedOutbox: 0,
    debugFiles: 0,
    protectedObjects: 0,
  };
  const cutoff = new Date(now - RETENTION_DAYS.handoff * day).toISOString();
  const receipts = await db.many<{
    submission_id: string;
    tenant_id: string;
    person_id: string;
    staging_retired_at: string | null;
  }>(
    `SELECT submission_id,tenant_id,person_id,staging_retired_at FROM acquisition_ingress_submissions
     WHERE datetime(accepted_at)<datetime(?) AND json_extract(response_json,'$.state') IS NULL`,
    [cutoff],
  );
  for (const receipt of receipts) {
    await renew();
    if (!/^[a-f0-9]{64}$/.test(receipt.submission_id)) throw new Error("RETENTION_RECEIPT_INVALID");
    const key = `${handoffPrefix(receipt.tenant_id, receipt.person_id)}${receipt.submission_id}.json`;
    const file = path.resolve(options.outboxDir, `${receipt.submission_id}.json`);
    if (
      fs.existsSync(file) &&
      !fs.lstatSync(file).isSymbolicLink() &&
      !JSON.parse(fs.readFileSync(file, "utf8")).result
    ) {
      report.protectedObjects++;
      continue;
    }
    const protectedRow = await db.one(
      `SELECT 1 FROM opportunity_versions WHERE source_payload_key=?
      UNION ALL SELECT 1 FROM enrichment_jobs WHERE payload_key=? AND status NOT IN ('COMPLETE','FAILED') LIMIT 1`,
      [key, key],
    );
    if (protectedRow) {
      report.protectedObjects++;
      continue;
    }
    if (!receipt.staging_retired_at) {
      if (apply) {
        await store.delete(key); // Receipt replay does not depend on the staging envelope.
        await db.execute(
          "UPDATE acquisition_ingress_submissions SET staging_retired_at=CURRENT_TIMESTAMP WHERE submission_id=?",
          [receipt.submission_id],
        );
      }
      report.handoffObjects++;
    }
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) continue;
    // Never delete unacknowledged data, even if Oracle has a committed receipt.
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      !entry.result ||
      entry.reference?.submissionId !== receipt.submission_id ||
      entry.reference?.payloadKey !== key ||
      fs.statSync(file).mtimeMs >= now - RETENTION_DAYS.handoff * day
    )
      continue;
    if (apply) fs.unlinkSync(file);
    report.acknowledgedOutbox++;
  }
  // Active acquisition/enrichment may need local diagnostics and legacy snapshots.
  const active = await db.one(`SELECT 1 FROM scrape_runs WHERE status NOT IN (${terminal})
    UNION ALL SELECT 1 FROM enrichment_jobs WHERE status NOT IN ('COMPLETE','FAILED') LIMIT 1`);
  if (!active) {
    for (const directory of ["snapshots", "extractions", "enrichment-cache", "metrics"]) {
      report.debugFiles += pruneFiles(
        path.join(options.artifactsDir, directory),
        now - RETENTION_DAYS.debug * day,
        apply,
      );
    }
    const runs = await db.many<{ id: string }>(
      `SELECT id FROM scrape_runs WHERE status IN (${terminal})
      AND datetime(COALESCE(finished_at,updated_at,created_at))<datetime(?)`,
      [new Date(now - RETENTION_DAYS.terminalRuns * day).toISOString()],
    );
    for (const run of runs) {
      if (!/^[A-Za-z0-9_-]+$/.test(run.id)) continue;
      report.debugFiles += pruneFiles(
        path.join(options.artifactsDir, "runs", run.id),
        now - RETENTION_DAYS.terminalRuns * day,
        apply,
      );
    }
  }
  return report;
}
