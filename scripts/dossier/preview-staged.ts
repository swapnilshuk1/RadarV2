/** Local read-only preview of an already persisted rich dossier. No model calls. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { getDatabaseAdapter } from "../../src/data/database";
import { dossierSchema } from "../../src/dossier/contracts";
import { RICH_DOSSIER_VERSION } from "../../src/data/sqlite/repositories/SqliteRichDossierStore";

const option = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const context = option("context"),
  job = option("job"),
  file = option("file"),
  directory = option("directory");
let raw: unknown;
if (directory) {
  raw = undefined;
} else if (file) {
  // Local evidence review never opens a database or starts a model/worker.
  raw = JSON.parse(readFileSync(resolve(file), "utf8").replace(/^\uFEFF/, ""));
} else {
  if (!context || !job) throw new Error("Explicit --file or --context and --job required");
  const row = await getDatabaseAdapter().one<{ presentation_json: string }>(
    `SELECT presentation_json FROM materialized_dossier_presentations WHERE evaluation_context_fingerprint=? AND canonical_job_id=? AND presentation_version=?`,
    [context, job, RICH_DOSSIER_VERSION],
  );
  if (!row) throw new Error("Persisted rich dossier not found");
  raw = JSON.parse(row.presentation_json);
}
if (process.argv.includes("--dto")) {
  const dto = raw as { evaluationState?: string; richDossier?: unknown };
  if (dto?.evaluationState !== "EVALUATED" || !dto.richDossier)
    throw new Error("Evaluated serving DTO with a rich dossier required");
  raw = dto.richDossier;
}
const dossier = directory ? undefined : dossierSchema.parse(raw);
const port = Number(option("port") || "4318");
const origin = `http://127.0.0.1:${port}`;
const server = await createServer({
  configFile: false,
  root: resolve("src/dossier/development"),
  plugins: [
    react(),
    tailwind(),
    {
      name: "persisted-dossier-preview",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
          if (!hosts.has(req.headers.host || "")) {
            res.statusCode = 403;
            res.end();
            return;
          }
          const url = new URL(req.url || "/", origin);
          const entries = directory
            ? readdirSync(resolve(directory))
                .filter((name) => name.endsWith("-dossier.json"))
                .map((name) =>
                  dossierSchema.parse(JSON.parse(readFileSync(resolve(directory, name), "utf8"))),
                )
            : [];
          const escape = (value: string) =>
            value.replace(
              /[&<>"']/g,
              (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
            );
          if (directory && url.pathname === "/" && !url.searchParams.has("job")) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(
              `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RADAR - Memo review</title><style>body{background:#faf9f6;color:#222720;font:16px system-ui;margin:0}main{max-width:1050px;margin:70px auto;padding:24px}h1{font:48px Georgia,serif}.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(270px,1fr))}a{display:block;color:inherit;text-decoration:none;background:white;padding:28px;border:1px solid #ddd9cf;border-radius:12px}a:hover{border-color:#138461}h2{font:28px Georgia,serif}p{line-height:1.6}.signal{color:#08764f;font-size:13px;font-weight:600}small{color:#62695e}</style></head><body><main><small>RADAR &middot; LOCAL EXECUTIVE MEMO REVIEW</small><h1>Your opportunities, clearly considered.</h1><p>Reviewed memos from the production composer. The same Template B layout is used for fresh opportunities.</p><div class="grid">${entries.map((d) => `<a href="/?job=${encodeURIComponent(d.opportunity.id)}"><span class="signal">${escape(d.verdict.verdict)} &middot; ${escape(d.verdict.screeningViability.toLowerCase())} screening</span><h2>${escape(d.opportunity.company)}</h2><p>${escape(d.opportunity.title)}</p><small>Open executive memo &rarr;</small></a>`).join("")}</div><p><small>Local review only. This page does not scrape, generate or activate production.</small></p></main></body></html>`,
            );
            return;
          }
          if (url.pathname !== "/api/dossier") {
            next();
            return;
          }
          if (
            req.method !== "GET" ||
            (req.headers.origin && !hosts.has(new URL(req.headers.origin).host))
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          const ref = new URL(req.headers.referer || origin);
          const selected = directory
            ? hosts.has(ref.host)
              ? entries.find((d) => d.opportunity.id === ref.searchParams.get("job"))
              : undefined
            : dossier;
          if (!selected) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(
            JSON.stringify({
              dossier: selected,
              stage: "Ready",
              running: false,
              opportunity: selected.opportunity,
            }),
          );
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    cors: false,
    fs: { allow: [process.cwd()] },
  },
});
await server.listen();
console.log(`Persisted dossier preview: ${origin}`);
