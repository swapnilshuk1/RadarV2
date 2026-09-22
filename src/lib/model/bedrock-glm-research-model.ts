import { BedrockMantleJsonModel } from "./bedrock-mantle-model";
import { loadMantleCredentials } from "./bedrock-credentials";
import type { ModelInvocationSink } from "./model-invocation";

export const GLM_STAGE_OUTPUT_TOKENS = {
  "evidence-extraction": 8192,
  "candidate-conflict-comparison": 4096,
  "context-relevance-selection": 3072,
  "role-interpretation": 6144,
  "screening-batch": 4096,
  "candidate-mapping-batch": 6144,
  "context-resolution": 6144,
  "gap-classification-batch": 3072,
  "career-capital": 4096,
  "decision": 4096,
  "memo-draft": 12288,
  "memo-repair": 6144,
  "factual-review": 12288,
} as const;

/** Current production GLM-5 transport; Mantle credentials are independent of Converse. */
export function createBedrockGlmResearchModel(
  options: {
    invocationSink?: ModelInvocationSink;
    providerConcurrencyLimit?: number;
  } = {},
) {
  return new BedrockMantleJsonModel(
    "zai.glm-5",
    async () => {
      loadMantleCredentials();
      return process.env.BEDROCK_MANTLE_API_KEY!.trim();
    },
    fetch,
    {
      region: "us-east-1",
      maxOutputTokens: 12288,
      stageOutputTokens: GLM_STAGE_OUTPUT_TOKENS,
      invocationSink: options.invocationSink,
      providerConcurrencyLimit: options.providerConcurrencyLimit,
    },
  );
}
