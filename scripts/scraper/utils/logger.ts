export type Level = "info" | "warn" | "error" | "debug";

export function makeLogger(prefix: string) {
  return (msg: string, level: Level = "info") => {
    const t = new Date().toISOString().slice(11, 19);
    const line = `[${t}] [${prefix}] ${msg}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
}
