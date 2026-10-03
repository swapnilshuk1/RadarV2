/** Host-only connectivity evidence. No application DB writes or secret output. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readEnvFile, loadUnifiedEnvironment } from "../../src/lib/env";
import { resolveBedrockCredential } from "../../src/lib/model/bedrock-credential-resolver";
import { adcTokenProvider } from "../../src/lib/model/google-adc";
loadUnifiedEnvironment();
const credentialRoot = process.argv[process.argv.indexOf("--credential-root") + 1];
const selectedRoot = process.argv.includes("--credential-root") ? credentialRoot : undefined;
if (selectedRoot) {
  for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
    const values = readEnvFile(path.join(selectedRoot, file));
    for (const key of [
      "TAVILY_API_KEY",
      "BEDROCK_MANTLE_API_KEY",
      "BEDROCK_MANTLE_KEY_FILE",
      "GCP_PROJECT_ID",
    ] as const)
      if (!process.env[key] && values[key]) process.env[key] = values[key];
  }
}

type Result = { provider: string; status: string; httpStatus?: number; permission: string };
async function bearer(provider: string, url: string, key: string | undefined): Promise<Result> {
  if (!key)
    return { provider, status: "credential unavailable on this host", permission: "unverified" };
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    await response.body?.cancel();
    return {
      provider,
      status: response.ok ? "passed" : "failed",
      httpStatus: response.status,
      permission: response.ok ? "read-only endpoint accessible" : "unverified",
    };
  } catch {
    return { provider, status: "connectivity unavailable", permission: "unverified" };
  }
}
const credential = await resolveBedrockCredential().catch(() => null);
const results = await Promise.all([
  bearer("Tavily", "https://api.tavily.com/usage", process.env.TAVILY_API_KEY),
  bearer("Bedrock Mantle", "https://bedrock-mantle.us-east-1.api.aws/v1/models", credential?.key),
  (async (): Promise<Result> => {
    if (process.argv.includes("--skip-adc"))
      return {
        provider: "Google ADC",
        status: "previous authentication evidence retained",
        permission: "model/project permission unverified",
      };
    try {
      await adcTokenProvider()();
      return {
        provider: "Google ADC",
        status: "token authentication passed",
        permission: "model/project permission unverified",
      };
    } catch {
      return {
        provider: "Google ADC",
        status: "host authentication unavailable",
        permission: "unverified",
      };
    }
  })(),
]);
const report = {
  checkedAt: new Date().toISOString(),
  host: "local checkout host; deployment worker connectivity remains separate",
  results,
};
mkdirSync(".radar/acceptance", { recursive: true });
writeFileSync(
  selectedRoot
    ? ".radar/acceptance/operations-connectivity-configured.json"
    : ".radar/acceptance/operations-connectivity.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
