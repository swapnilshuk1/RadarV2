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
      cwd: '/home/ubuntu/radar-local-v2',
      env: {
        PORT: 80,
        NODE_ENV: 'production',
        ...envVars
      }
    }
  ]
};
