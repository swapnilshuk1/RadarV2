/**
 * Verifies that a disposable remote Turso database enforces foreign keys on
 * both its normal client stream and a write transaction. It never reads or
 * touches RADAR tables. This deliberately has no default URL/token fallback.
 */
import { randomUUID } from "node:crypto";
import { TursoAdapter } from "../src/data/database/turso";

const url = process.env.RADAR_REMOTE_VALIDATION_URL;
const token = process.env.RADAR_REMOTE_VALIDATION_TOKEN;
if (process.env.RADAR_ADMIN_REMOTE_VALIDATION_CONFIRM !== "DISPOSABLE" || !url || !token)
  throw new Error(
    "Set RADAR_REMOTE_VALIDATION_URL, RADAR_REMOTE_VALIDATION_TOKEN and RADAR_ADMIN_REMOTE_VALIDATION_CONFIRM=DISPOSABLE for a disposable database.",
  );
if (url.startsWith("file:")) throw new Error("REMOTE_TURSO_URL_REQUIRED");

const suffix = randomUUID().replaceAll("-", "");
const parent = `radar_fk_probe_parent_${suffix}`;
const child = `radar_fk_probe_child_${suffix}`;
const db = new TursoAdapter(url, token);
let childCreated = false;
try {
  await db.execute(`CREATE TABLE ${parent}(id TEXT PRIMARY KEY)`);
  await db.execute(
    `CREATE TABLE ${child}(id TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES ${parent}(id))`,
  );
  childCreated = true;
  const direct = await db.one<{ foreign_keys: number }>("PRAGMA foreign_keys");
  if (Number(direct?.foreign_keys) !== 1) throw new Error("REMOTE_FOREIGN_KEYS_DISABLED_ON_CLIENT");
  await db.transaction(async (tx) => {
    const transactional = await tx.one<{ foreign_keys: number }>("PRAGMA foreign_keys");
    if (Number(transactional?.foreign_keys) !== 1)
      throw new Error("REMOTE_FOREIGN_KEYS_DISABLED_IN_TRANSACTION");
    let rejected = false;
    try {
      await tx.execute(`INSERT INTO ${child}(id,parent_id) VALUES('orphan','missing')`);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("REMOTE_FOREIGN_KEY_ORPHAN_ACCEPTED");
  });
  console.log("Remote Turso foreign-key probe passed.");
} finally {
  if (childCreated) await db.execute(`DROP TABLE IF EXISTS ${child}`).catch(() => undefined);
  await db.execute(`DROP TABLE IF EXISTS ${parent}`).catch(() => undefined);
  await db.close();
}
