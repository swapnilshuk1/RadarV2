import { spawn, type ChildProcess } from "node:child_process";
import { getDatabaseTargetIdentity } from "../src/data/database";

type ManagedProcess = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  restart: boolean;
};

const RESTART_DELAY_MS = 2_000;

function processSpecs(databaseTarget: string): ManagedProcess[] {
  const localFileDb = databaseTarget.startsWith("file:");
  const workerEnv = localFileDb
    ? {
        RADAR_EVALUATION_JOB_CONCURRENCY:
          process.env.RADAR_EVALUATION_JOB_CONCURRENCY || "1",
        RADAR_DOSSIER_JOB_CONCURRENCY:
          process.env.RADAR_DOSSIER_JOB_CONCURRENCY || "1",
      }
    : {};
  const viteCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  return [
    { name: "vite", command: viteCommand, args: ["vite", "--strictPort", "--port", "3000"], restart: false },
    {
      name: "scrape",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-scrape-worker.ts"],
      env: workerEnv,
      restart: true,
    },
    {
      name: "evaluation",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-evaluation-worker.ts"],
      env: workerEnv,
      restart: true,
    },
    {
      name: "dossier-composition",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-dossier-composition-worker.ts"],
      env: workerEnv,
      restart: true,
    },
    {
      name: "dossier-review",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-dossier-review-worker.ts"],
      env: workerEnv,
      restart: true,
    },
  ];
}
async function main() {
  const identity = getDatabaseTargetIdentity();
  const databaseTarget =
    process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL || "";
  console.log(`Database target fingerprint: ${identity.fingerprint}`);
  console.log(
    "Development startup never applies migrations. Run npm run db:migrate against an explicitly selected non-production target.",
  );

  let shuttingDown = false;
  const children = new Map<string, ChildProcess>();
  const baseEnv = {
    ...process.env,
    RADAR_EXPECTED_DB_TARGET_FINGERPRINT: identity.fingerprint,
  };

  const stopChild = (child: ChildProcess) => {
    if (child.exitCode !== null || child.killed) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // The child may have exited between the state check and signal.
    }
  };
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children.values()) stopChild(child);
    process.exitCode = exitCode;
  };

  const launch = (spec: ManagedProcess) => {
    if (shuttingDown) return;
    const child = spawn(spec.command, spec.args, {
      stdio: "inherit",
      shell: spec.name === "vite" && process.platform === "win32",
      env: { ...baseEnv, ...spec.env },
    });
    children.set(spec.name, child);
    console.log(`[dev-supervisor] started ${spec.name} pid=${child.pid ?? "unknown"}`);

    child.on("error", (error) => {
      console.error(`[dev-supervisor] ${spec.name} launch failed`, error);
    });
    child.on("exit", (code, signal) => {
      if (children.get(spec.name) === child) children.delete(spec.name);
      if (shuttingDown) return;

      if (spec.name === "vite") {
        console.error(
          `[dev-supervisor] vite exited code=${code ?? "null"} signal=${signal ?? "none"}; stopping workers`,
        );
        shutdown(code ?? 1);
        return;
      }

      console.error(
        `[dev-supervisor] ${spec.name} exited code=${code ?? "null"} signal=${signal ?? "none"}`,
      );
      if (spec.restart) {
        const timer = setTimeout(() => launch(spec), RESTART_DELAY_MS);
        timer.unref();
      }
    });
  };
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));

  for (const spec of processSpecs(databaseTarget)) launch(spec);
}

main().catch((error) => {
  console.error(
    "Development startup is blocked by database migration/schema readiness failure.",
    error,
  );
  process.exitCode = 1;
});
