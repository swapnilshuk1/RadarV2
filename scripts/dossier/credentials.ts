import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Use the existing local Google ADC identity. No secret is sent to the browser. */
export function adcTokenProvider() {
  let cache: { value: string; expires: number } | undefined;
  return async () => {
    if (cache && cache.expires > Date.now()) return cache.value;
    const locations = [process.env.GOOGLE_APPLICATION_CREDENTIALS,
      process.env.APPDATA && join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'gcloud', 'application_default_credentials.json'),
      join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')].filter((v): v is string => Boolean(v));
    for (const file of locations) {
      let credentials;
      try { credentials = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
      if (credentials.type !== 'authorized_user') continue;
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: credentials.client_id, client_secret: credentials.client_secret, refresh_token: credentials.refresh_token, grant_type: 'refresh_token' }) });
      if (!response.ok) throw new Error(`ADC authentication failed (HTTP ${response.status})`);
      const token = await response.json() as { access_token: string; expires_in: number };
      if (!token.access_token) throw new Error('ADC returned no access token');
      cache = { value: token.access_token, expires: Date.now() + (token.expires_in - 60) * 1000 };
      return cache.value;
    }
    throw new Error('No supported local Google ADC credentials; authenticate before generating a dossier');
  };
}
