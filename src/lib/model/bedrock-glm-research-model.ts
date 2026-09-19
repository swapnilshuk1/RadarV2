import { BedrockMantleJsonModel } from './bedrock-mantle-model';
import { loadMantleCredentials } from './bedrock-credentials';
/** Current production GLM-5 transport; Mantle credentials are independent of Converse. */
export function createBedrockGlmResearchModel() {
  return new BedrockMantleJsonModel('zai.glm-5', async () => {
    loadMantleCredentials();
    return process.env.BEDROCK_MANTLE_API_KEY!.trim();
  }, fetch, {region:'us-east-1',maxOutputTokens:12288});
}
