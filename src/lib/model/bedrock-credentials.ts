import fs from 'node:fs';
import path from 'node:path';
import { loadUnifiedEnvironment } from '../env';

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
