type RuntimeLogFields = Record<string, string | number | boolean | null | undefined>;

const sensitive = /secret|token|credential|password|payload|document|prompt|content/i;

/** Narrow JSON logger for durable runtime entrypoints.  It intentionally
 * accepts scalar identifiers only, so worker logs cannot accidentally carry
 * candidate text, credentials, or provider payloads. */
export function runtimeLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: RuntimeLogFields = {},
): void {
  const safeFields = Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) => {
      if (sensitive.test(key) || value === undefined) return [];
      return [[key, typeof value === "string" ? value.slice(0, 300) : value]];
    }),
  );
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safeFields });
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}
