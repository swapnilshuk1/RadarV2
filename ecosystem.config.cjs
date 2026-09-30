// Production configuration is supplied by PM2/the process environment. Never
// search the checkout for an arbitrary .env file at runtime.
const envVars = {};
const runServerScraper = process.env.RADAR_SERVER_SCRAPER_ENABLED === "true";

module.exports = {
  apps: [
    {
      name: "radar-v2",
      script: ".output/server/index.mjs",
      cwd: __dirname,
      env: {
        PORT: Number(process.env.RADAR_WEB_PORT || 3000),
        NODE_ENV: "production",
        ...envVars,
      },
    },
    {
      name: "radar-enrich",
      // Invoke the package entry point directly. Some production npm installs
      // omit .bin shims even when tsx itself is present.
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/enrich.ts",
      cwd: __dirname,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        ...envVars,
      },
    },
    {
      name: "radar-evaluate",
      // See radar-enrich: this remains valid without npm's .bin symlink farm.
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/run-evaluation-worker.ts",
      cwd: __dirname,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        ...envVars,
      },
    },
    ...[
      ...(runServerScraper ? [["radar-scrape", "scripts/run-scrape-worker.ts"]] : []),
      ["radar-documents", "scripts/process-document-jobs.ts"],
      ["radar-dossiers", "scripts/run-dossier-composition-worker.ts"],
      ["radar-reviews", "scripts/run-dossier-review-worker.ts"],
      ["radar-corpus", "scripts/run-corpus-regeneration-worker.ts"],
      ["radar-pursuit", "scripts/run-pursuit-preparation-worker.ts"],
    ].map(([name, args]) => ({
      name,
      script: "node_modules/tsx/dist/cli.mjs",
      args,
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 30000,
      env: { NODE_ENV: "production", ...envVars },
    })),
  ],
};
