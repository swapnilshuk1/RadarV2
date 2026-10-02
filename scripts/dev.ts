import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { getDatabaseTargetIdentity } from "../src/data/database";

type ManagedProcess = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  restart: boolean;
};

const RESTART_DELAY_MS = 2_000;

function pipePrefixedOutput(
  stream: Readable | null,
  name: string,
  target: NodeJS.WriteStream,
): void {
  if (!stream) return;
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      target.write(`[${name}] ${line}\n`);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffered) target.write(`[${name}] ${buffered}\n`);
  });
}

function processSpecs(databaseTarget: string, fullStack: boolean): ManagedProcess[] {
  const localFileDb = databaseTarget.startsWith("file:");
  const workerEnv = localFileDb
    ? {
        RADAR_EVALUATION_JOB_CONCURRENCY:
          process.env.RADAR_EVALUATION_JOB_CONCURRENCY || "1",
        RADAR_DOSSIER_JOB_CONCURRENCY:
          process.env.RADAR_DOSSIER_JOB_CONCURRENCY || "1",
      }
    : {};
  const vite: ManagedProcess = {
    name: "vite",
    command: process.execPath,
    args: ["node_modules/vite/bin/vite.js", "--strictPort", "--port", "3000"],
    restart: false,
  };
  const evaluation: ManagedProcess = {
    name: "evaluation",
    command: process.execPath,
    args: ["--import", "tsx", "scripts/run-evaluation-worker.ts"],
    env: workerEnv,
    restart: true,
  };

  if (process.env.RADAR_RUNTIME_ROLE === "acquisition") {
    return [vite, {
      name: "scrape",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-scrape-worker.ts"],
      env: workerEnv,
      restart: true,
    }];
  }

  if (!fullStack) {
    // Normal product development keeps the evaluator service alive so the UI
    // Start/Pause/Resume/Stop controls are real. Durable control defaults to
    // STOPPED, so merely starting RADAR does not consume model-backed work.
    return [evaluation, vite];
  }

  return [
    vite,
    {
      name: "scrape",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-scrape-worker.ts"],
      env: workerEnv,
      restart: true,
    },
    {
      name: "enrichment",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/enrich.ts"],
      env: workerEnv,
      restart: true,
    },
    evaluation,
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
    {
      name: "documents",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/process-document-jobs.ts"],
      env: workerEnv,
      restart: true,
    },
    {
      name: "corpus",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-corpus-regeneration-worker.ts"],
      env: workerEnv,
      restart: true,
    },
    {
      name: "pursuit-preparation",
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-pursuit-preparation-worker.ts"],
      env: workerEnv,
      restart: true,
    },
  ];
}
async function main() {
  const identity = getDatabaseTargetIdentity();
  const expectedDatabaseTarget = process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT;
  if (expectedDatabaseTarget && expectedDatabaseTarget !== identity.fingerprint) {
    throw new Error(
      `[dev-supervisor] DATABASE_TARGET_MISMATCH: configured ${expectedDatabaseTarget}, resolved ${identity.fingerprint}. Refusing to start.`,
    );
  }
  const databaseTarget =
    process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL || "";
  const fullStack = process.argv.includes("--full");
  console.log(
    process.env.RADAR_RUNTIME_ROLE === "acquisition"
      ? "[dev-supervisor] ACQUISITION mode: web + scrape worker; processing runs on Oracle."
      : fullStack
      ? "[dev-supervisor] FULL STACK mode: all local workers are enabled; queued work may be consumed."
      : "[dev-supervisor] INTERACTIVE mode: web + evaluator service. Evaluation remains idle until the UI starts it.",
  );
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
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
      env: { ...baseEnv, ...spec.env },
    });
    children.set(spec.name, child);
    pipePrefixedOutput(child.stdout, spec.name, process.stdout);
    pipePrefixedOutput(child.stderr, spec.name, process.stderr);
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

  for (const spec of processSpecs(databaseTarget, fullStack)) launch(spec);
}

main().catch((error) => {
  console.error(
    "Development startup is blocked by database migration/schema readiness failure.",
    error,
  );
  process.exitCode = 1;
});
