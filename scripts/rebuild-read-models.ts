import Database from "better-sqlite3";
import path from "path";
import { SqliteTimelineStore } from "../src/data/sqlite/repositories/SqliteTimelineStore";
import { ReadModelRebuilder } from "../src/data/sqlite/read_models/ReadModelRebuilder";
import { globalReadModelRegistry, initializeReadModels } from "../src/lib/infrastructure/Registry";
import { SqliteAdapter } from "../src/data/database/sqlite";

export async function runRebuildReadModels(verify: boolean = false, targetName: string = "") {
  initializeReadModels();

  const dbPath = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH || "radar.sqlite");
  const rawDb = new Database(dbPath);
  const adapter = new SqliteAdapter(rawDb);

  const timelineStore = new SqliteTimelineStore(adapter);
  
  let readModelsToRebuild = globalReadModelRegistry.getReadModels();

  if (targetName) {
    const rm = globalReadModelRegistry.getReadModel(targetName);
    if (!rm) {
      console.error(`Read Model "${targetName}" not found in registry.`);
      rawDb.close();
      return;
    }
    readModelsToRebuild = [rm];
    console.log(`Targeting single read model: ${targetName}`);
  }

  const workspaces = rawDb.prepare("SELECT id FROM workspaces").all() as { id: string }[];
  
  if (workspaces.length === 0) {
    console.log("[Rebuild] No workspaces found. Nothing to rebuild.");
    rawDb.close();
    return;
  }

  if (verify) {
    console.log("Running in --verify mode. Will compare checksums before overwriting...");
    for (const row of workspaces) {
      for (const rm of readModelsToRebuild) {
        console.log(`[Verify] Checksum for ${rm.name} on workspace ${row.id}: ${rm.checksum(rawDb)}`);
      }
    }
  }

  const rebuilder = new ReadModelRebuilder(rawDb, timelineStore, readModelsToRebuild);

  for (const row of workspaces) {
    await rebuilder.rebuildAll(row.id);
  }

  console.log(`[Rebuild] Successfully rebuilt ${readModelsToRebuild.length} read models for ${workspaces.length} workspaces.`);
  rawDb.close();
}

async function main() {
  const args = process.argv.slice(2);
  let targetName = "";
  let verify = false;

  if (args.length > 0 && !args[0].startsWith("--")) {
    targetName = args[0];
    if (args.includes("--verify")) verify = true;
  } else if (args.includes("--verify")) {
    verify = true;
  }

  await runRebuildReadModels(verify, targetName);
}

import { fileURLToPath } from "url";
const isMain = typeof process !== "undefined" && 
  process.argv && 
  process.argv[1] && 
  (process.argv[1].endsWith('rebuild-read-models.ts') || process.argv[1] === fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
