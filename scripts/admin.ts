import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../src/data/database";
import { appendAdminAudit, rollupUsage } from "../src/admin/service";
import { hostname, userInfo } from "node:os";

const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
const command = args[0];
const db = getDatabaseAdapter();
const hostActor = `host:${hostname()}/${userInfo().username}`;
console.log("Database:", getDatabaseTargetIdentity().sanitizedTarget);
try {
  if (command === "rollup") {
    const today = new Date().toISOString().slice(0, 10);
    const first = args.includes("--from")
      ? value("--from")
      : new Date(Date.parse(today) - 29 * 86400000).toISOString().slice(0, 10);
    const last = args.includes("--to") ? value("--to") : today;
    if (!args.includes("--apply"))
      console.log(`Preview: rebuild usage rollup ${first} through ${last}. Add --apply to write.`);
    else {
      await rollupUsage(db, first, last);
      console.log("Usage rollup reconciled.");
    }
  } else if (command === "grant" || command === "revoke") {
    const user = args.includes("--user") ? value("--user") : "";
    const reason = args.includes("--reason") ? value("--reason") : "";
    const role = args.includes("--role") ? value("--role") : "operator";
    if (!user || !reason.trim() || !["operator", "viewer"].includes(role))
      throw new Error(
        "Require --user existing-user-id, --reason and optional --role operator|viewer",
      );
    if (!(await db.one("SELECT id FROM users WHERE id=?", [user]))) throw new Error("UNKNOWN_USER");
    console.log(
      `Preview: ${command} platform ${role} for ${user}. Tenant memberships are untouched.`,
    );
    if (args.includes("--apply"))
      await db.transaction(async (tx) => {
        const before = await tx.one("SELECT role,revoked_at FROM platform_roles WHERE user_id=?", [
          user,
        ]);
        if (command === "grant")
          await tx.execute(
            `INSERT INTO platform_roles VALUES(?,?,?,?,?,NULL)
        ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,granted_at=excluded.granted_at,
        granted_by=excluded.granted_by,reason=excluded.reason,revoked_at=NULL`,
            [user, role, Date.now(), hostActor, reason],
          );
        else
          await tx.execute("UPDATE platform_roles SET revoked_at=? WHERE user_id=?", [
            Date.now(),
            user,
          ]);
        await appendAdminAudit(tx, {
          actor: hostActor,
          action: `platform.${command}`,
          target: user,
          reason,
          detail: { before, after: command === "grant" ? role : "revoked" },
        });
      });
  } else throw new Error("Usage: tsx scripts/admin.ts grant|revoke|rollup [options] [--apply]");
} finally {
  await db.close?.();
}
