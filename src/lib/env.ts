import fs from "fs";
import path from "path";

let _hasLoadedUnifiedEnvironment = false;

/**
 * Parses raw .env file content into key-value pairs.
 * Trims whitespace, ignores comments (#), and strips surrounding quotes.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Safely reads and parses an environment file if it exists.
 */
export function readEnvFile(filePath: string): Record<string, string> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return parseEnvContent(content);
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

export interface LoadUnifiedEnvironmentOptions {
  rootDir?: string;
  forceReload?: boolean;
  envFiles?: string[];
}

/**
 * Authoritative unified environment loader.
 * Loads all environment variables across the system with strict precedence:
 * 1. Existing process.env (Shell variables always win)
 * 2. In development (NODE_ENV !== "production" && RADAR_ENV !== "production"):
 *    .env.development.local -> .env.local -> .env.development -> .env -> gemini.env -> groq.env
 * 3. In production:
 *    .env.local -> .env -> gemini.env -> groq.env
 *
 * Uses 'set only if currently undefined' evaluated from highest priority to lowest priority.
 */
export function loadUnifiedEnvironment(options?: LoadUnifiedEnvironmentOptions): void {
  if (_hasLoadedUnifiedEnvironment && !options?.forceReload) {
    return;
  }

  const rootDir = options?.rootDir || process.cwd();
  const nodeEnv = process.env.NODE_ENV;
  const radarEnv = process.env.RADAR_ENV;
  const isDev = nodeEnv !== "production" && radarEnv !== "production";

  const filesInPriorityOrder = options?.envFiles || (isDev
    ? [
        ".env.development.local",
        ".env.local",
        ".env.development",
        ".env",
        "gemini.env",
        "groq.env",
      ]
    : [
        ".env.local",
        ".env",
        "gemini.env",
        "groq.env",
      ]);

  for (const filename of filesInPriorityOrder) {
    const fullPath = path.isAbsolute(filename) ? filename : path.join(rootDir, filename);
    const parsed = readEnvFile(fullPath);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  _hasLoadedUnifiedEnvironment = true;
}
