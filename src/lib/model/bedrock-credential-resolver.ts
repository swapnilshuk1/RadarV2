import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readEnvFile } from "../env";
import { ModelProviderUnavailableError } from "./provider-unavailable";
import { parseMantleKey } from "./bedrock-credentials";

export interface BedrockCredential {
  key: string;
  source: "host";
  version: string;
  generation: number;
}

export function normalizeMantleKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9+/]+=*$/.test(key)) return key;
  return key.padEnd(key.length + ((4 - (key.length % 4)) % 4), "=");
}

/** Resolve at use time. Reading a file must never install a stale key in process.env. */
export async function resolveBedrockCredential(): Promise<BedrockCredential> {
  const configuration: Record<string, string | undefined> = { ...process.env };
  const development =
    !["production", "test"].includes(process.env.NODE_ENV ?? "") &&
    !["production", "test"].includes(process.env.RADAR_ENV ?? "") &&
    process.env.VITEST !== "true";
  if (development) {
    for (const filename of [
      ".env.development.local",
      ".env.local",
      ".env.development",
      ".env",
      "gemini.env",
      "groq.env",
    ]) {
      for (const [name, value] of Object.entries(readEnvFile(path.resolve(filename)))) {
        if (configuration[name] === undefined) configuration[name] = value;
      }
    }
  }
  let raw = configuration.BEDROCK_MANTLE_API_KEY?.trim();
  let version = configuration.RADAR_MODEL_CREDENTIAL_VERSION ?? "host-environment";
  if (raw && /[\r\n]/.test(raw))
    throw new ModelProviderUnavailableError("BEDROCK_MANTLE_CREDENTIAL_INVALID", 401);
  if (!raw) {
    try {
      const filename = configuration.BEDROCK_MANTLE_KEY_FILE || path.resolve("mantle.key");
      raw = parseMantleKey(await readFile(filename, "utf8"));
      const metadata = await stat(filename);
      version = configuration.RADAR_MODEL_CREDENTIAL_VERSION ?? `host-file:${metadata.mtimeMs}`;
    } catch {
      throw new ModelProviderUnavailableError(
        "BEDROCK_MANTLE_CREDENTIAL_FILE_UNAVAILABLE_OR_INVALID",
        401,
      );
    }
  }
  const key = normalizeMantleKey(raw);
  return { key, source: "host", generation: 0, version };
}
