import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database";

const databaseNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
/** Coarse account safety: no concurrent browser runs, even for different people/hosts. */
export async function acquireExecutionLease(db: DatabaseAdapter, durationMs = 120_000) {
  const token = randomUUID();
  const claim = await db.execute(
    `INSERT INTO acquisition_execution_lease(id,token,lease_until)
    VALUES('portal-acquisition',?,${databaseNow}+?)
    ON CONFLICT(id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until
    WHERE acquisition_execution_lease.lease_until<=${databaseNow}`,
    [token, durationMs],
  );
  if (!claim.rowsAffected) throw new Error("ACQUISITION_EXECUTION_BUSY");
  return {
    token,
    async renew() {
      const renewed = await db.execute(
        `UPDATE acquisition_execution_lease SET lease_until=${databaseNow}+?
        WHERE id='portal-acquisition' AND token=? AND lease_until>${databaseNow}`,
        [durationMs, token],
      );
      if (!renewed.rowsAffected) throw new Error("ACQUISITION_EXECUTION_LEASE_LOST");
    },
    async release() {
      await db.execute(
        "DELETE FROM acquisition_execution_lease WHERE id='portal-acquisition' AND token=?",
        [token],
      );
    },
  };
}
