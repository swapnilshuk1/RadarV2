const fs = require('fs');
const path = require('path');

function parseEnv(filePath) {
  const env = {};
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
  }
  return env;
}

const envVars = parseEnv(path.join(__dirname, '.env'));

module.exports = {
  apps: [
    {
      name: 'radar-v2',
      script: '.output/server/index.mjs',
      cwd: __dirname,
      env: {
        PORT: 3000,
        NODE_ENV: 'production',
        ...envVars
      }
    },
    {
      name: 'radar-enrich',
      // Invoke the package entry point directly. Some production npm installs
      // omit .bin shims even when tsx itself is present.
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/enrich.ts',
      cwd: __dirname,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        ...envVars
      }
    },
    {
      name: 'radar-evaluate',
      // See radar-enrich: this remains valid without npm's .bin symlink farm.
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/run-evaluation-worker.ts',
      cwd: __dirname,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        ...envVars
      }
    }
  ]
};
