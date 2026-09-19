import fs from 'node:fs';
import path from 'node:path';
import { loadUnifiedEnvironment } from '../env';

/** Accept the raw key or the console's labelled download, never guess between keys. */
export function parseMantleKey(text: string): string {
  const candidates = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^[A-Za-z0-9+\/=_\-.]{40,}$/.test(line));
  if (candidates.length !== 1) throw new Error('BEDROCK_MANTLE_CREDENTIAL_FILE_INVALID');
  return candidates[0];
}

/** Dedicated Mantle credential; an old Converse bearer token cannot override it. */
export function loadMantleCredentials(): void {
  loadUnifiedEnvironment();
  const configured = process.env.BEDROCK_MANTLE_API_KEY?.trim();
  if (configured) {
    if (/[\r\n]/.test(configured)) throw new Error('BEDROCK_MANTLE_CREDENTIAL_INVALID');
    return;
  }
  const file = process.env.BEDROCK_MANTLE_KEY_FILE || path.resolve('mantle.key');
  try { process.env.BEDROCK_MANTLE_API_KEY = parseMantleKey(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('BEDROCK_MANTLE_CREDENTIAL_FILE_UNAVAILABLE_OR_INVALID'); }
}

/** AWS console CSV is a local credential source; never log its values. */
export function loadBedrockCredentials(): void {
  loadUnifiedEnvironment();
  if (process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()) return;
  const file = process.env.BEDROCK_API_KEY_FILE || path.resolve('bedrock-long-term-api-key.csv');
  if (!fs.existsSync(file)) throw new Error('BEDROCK_AUTH_UNAVAILABLE');
  const rows = fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
  const cells = (row:string) => (row.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || [])
    .filter(Boolean).map(cell=>cell.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"').trim());
  const column = cells(rows[0]).indexOf('API key');
  const value = column >= 0 && rows[1] ? cells(rows[1])[column] : undefined;
  if (!value) throw new Error('BEDROCK_CREDENTIAL_FILE_INVALID');
  process.env.AWS_BEARER_TOKEN_BEDROCK = value;
}
