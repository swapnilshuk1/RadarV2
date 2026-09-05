import { spawn } from "child_process";
import { getDatabaseTargetIdentity } from "../src/data/database";
import { runMigrations } from "../src/data/sqlite/migrations/runner";

async function main() {
  const identity = getDatabaseTargetIdentity();
  console.log(`Migration target fingerprint: ${identity.fingerprint}`);
  await runMigrations();

  const viteCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const vite = spawn(viteCommand, ["vite"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, RADAR_EXPECTED_DB_TARGET_FINGERPRINT: identity.fingerprint },
  });
  vite.on("error", (error) => {
    console.error("Development startup failed to launch Vite.", error);
    process.exitCode = 1;
  });
  vite.on("exit", (code) => { process.exitCode = code ?? 1; });
}

main().catch((error) => {
  console.error("Development startup is blocked by database migration/schema readiness failure.", error);
  process.exitCode = 1;
});
