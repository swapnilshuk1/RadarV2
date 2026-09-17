import { BedrockConverseJsonModel } from './bedrock-converse-model';
import { loadBedrockCredentials } from './bedrock-credentials';
/** Production model factory: credentials are supplied only through the process environment. */
export function createBedrockGlmResearchModel() { return new BedrockConverseJsonModel('zai.glm-5', async () => { loadBedrockCredentials(); const token=process.env.AWS_BEARER_TOKEN_BEDROCK?.trim(); if(!token) throw new Error('BEDROCK_AUTH_UNAVAILABLE'); return token; }, fetch, {region:'us-east-1',maxOutputTokens:12288}); }
