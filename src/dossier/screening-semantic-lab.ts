import { z } from 'zod';

import type { ReasoningModel } from './contracts';
import { bedrockJsonSchema } from './bedrock-schema';
import { modelSchema } from './model-schema';
import {
  stagedScreeningFunctionSchema,
  stagedScreeningGateBasisSchema,
  type StagedScreeningFunction,
  type StagedScreeningGateBasis,
} from './staged-decision-contract';

export const screeningSemanticQuoteSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
}).strict();

export const screeningSemanticLabInputSchema = z.object({
  requirement: z.object({
    requirement: z.string().min(1),
    strength: z.enum(['REQUIRED', 'PREFERRED']),
    roleImportance: z.enum(['CORE_CAPABILITY', 'ENABLER']),
  }).strict(),
  quoteCatalog: z.array(screeningSemanticQuoteSchema).min(1),
}).strict();

export const screeningSemanticLabProposalSchema = z.object({
  screeningFunction: stagedScreeningFunctionSchema,
  gateBasis: stagedScreeningGateBasisSchema,
  supportQuoteIds: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1),
}).strict();

export type ScreeningSemanticQuote = z.infer<typeof screeningSemanticQuoteSchema>;
export type ScreeningSemanticLabInput = z.infer<typeof screeningSemanticLabInputSchema>;
export type ScreeningSemanticLabProposal = z.infer<typeof screeningSemanticLabProposalSchema>;
export type ScreeningSemanticLabResult = ScreeningSemanticLabProposal & { screeningGate: boolean };

export const screeningSemanticLabInstruction = `You are RADAR's screening-semantics classifier. Decide one question: does this immutable candidate requirement describe an employer entry/shortlisting qualification, or a capability expected for performing the role?

The input contains the requirement and an application-owned quoteCatalog. Each quote has an immutable id and exact source text. Return only quote IDs from that catalog in supportQuoteIds. Never rewrite, reconstruct, concatenate, or invent source quotations.

Return:
- screeningFunction: ENTRY_QUALIFICATION or ROLE_PERFORMANCE_REQUIREMENT
- gateBasis: one of MINIMUM_TENURE, MANDATORY_CREDENTIAL, PRIOR_RELEVANT_EXPERIENCE, ELIGIBILITY_CONDITION, QUALIFYING_ARTIFACT, EXPLICIT_SHORTLIST_CONDITION, NONE
- supportQuoteIds: one or more supplied quote IDs that directly support your classification
- concise reasoning

Semantic rules:
1. REQUIRED does not automatically mean screening gate. A capability can be essential for strong performance and still be ROLE_PERFORMANCE_REQUIREMENT.
2. ENTRY_QUALIFICATION means the source presents something the candidate must already possess, have done, or supply in order to qualify for entry/consideration. ENTRY_QUALIFICATION must use exactly one non-NONE gateBasis.
3. ROLE_PERFORMANCE_REQUIREMENT means the source describes a skill, capability, proficiency, knowledge, working style, responsibility, or success expectation without making it an employer-entry qualification. It must use gateBasis=NONE.
4. PREFERRED or explicitly optional requirements are always ROLE_PERFORMANCE_REQUIREMENT / NONE.
5. MINIMUM_TENURE means an explicit numeric or verbal duration/experience threshold used as an entry qualification.
6. MANDATORY_CREDENTIAL means a formal educational degree, licence, certification, professional qualification, or registration used as an entry qualification. Tool/platform knowledge is not a credential.
7. PRIOR_RELEVANT_EXPERIENCE means non-duration retrospective experience/background/exposure used as an entry qualification. Experience wording alone is not enough: distinguish a selection prerequisite from a capability description in the role.
8. ELIGIBILITY_CONDITION means legal/regulatory/right-to-work/clearance eligibility for employment.
9. QUALIFYING_ARTIFACT means a candidate-supplied artifact required to qualify or progress, such as a portfolio or work sample.
10. EXPLICIT_SHORTLIST_CONDITION means the source explicitly ties possession/non-possession to consideration, shortlisting, interview, or disqualification.
11. Headings and surrounding wording in the supplied quotes are relevant. Do not infer a stronger condition than the source actually states.
12. Do not reason about the candidate's evidence, fit, desire, willingness, or likelihood of acceptance.`;

function schemaForModel(model: ReasoningModel): Record<string, unknown> {
  return /bedrock/i.test(model.id)
    ? bedrockJsonSchema(screeningSemanticLabProposalSchema)
    : modelSchema(screeningSemanticLabProposalSchema);
}

export function materializeScreeningSemanticLabProposal(
  value: unknown,
  input: ScreeningSemanticLabInput,
): ScreeningSemanticLabResult {
  const parsedInput = screeningSemanticLabInputSchema.parse(input);
  const parsed = screeningSemanticLabProposalSchema.parse(value);
  const knownQuoteIds = new Set(parsedInput.quoteCatalog.map(quote => quote.id));

  if (new Set(parsed.supportQuoteIds).size !== parsed.supportQuoteIds.length) {
    throw new Error('supportQuoteIds must not contain duplicates');
  }
  const unknownQuote = parsed.supportQuoteIds.find(id => !knownQuoteIds.has(id));
  if (unknownQuote) {
    throw new Error(`Unknown support quote id: ${unknownQuote}`);
  }
  if (parsedInput.requirement.strength === 'PREFERRED' && parsed.screeningFunction === 'ENTRY_QUALIFICATION') {
    throw new Error('A preferred requirement cannot become an entry qualification');
  }
  if (parsed.screeningFunction === 'ENTRY_QUALIFICATION' && parsed.gateBasis === 'NONE') {
    throw new Error('An entry qualification needs a non-NONE gate basis');
  }
  if (parsed.screeningFunction === 'ROLE_PERFORMANCE_REQUIREMENT' && parsed.gateBasis !== 'NONE') {
    throw new Error('A role-performance requirement must use gateBasis=NONE');
  }

  return {
    ...parsed,
    screeningGate:
      parsedInput.requirement.strength === 'REQUIRED'
      && parsed.screeningFunction === 'ENTRY_QUALIFICATION'
      && parsed.gateBasis !== 'NONE',
  };
}

export interface ScreeningSemanticLabAttempt {
  attempt: number;
  valid: boolean;
  output?: unknown;
  error?: string;
}

export interface ScreeningSemanticLabExecution {
  result?: ScreeningSemanticLabResult;
  attempts: ScreeningSemanticLabAttempt[];
  firstPassValid: boolean;
  repaired: boolean;
  error?: string;
}

export async function runScreeningSemanticLabCase(
  model: ReasoningModel,
  input: ScreeningSemanticLabInput,
  maxAttempts = 2,
): Promise<ScreeningSemanticLabExecution> {
  const parsedInput = screeningSemanticLabInputSchema.parse(input);
  const attempts: ScreeningSemanticLabAttempt[] = [];
  let previous: unknown;
  let issue = '';

  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    try {
      previous = await model.generate(
        screeningSemanticLabInstruction,
        attempt === 0
          ? parsedInput
          : {
              input: parsedInput,
              previous,
              repair: `Repair only the structural/source-reference defect: ${issue}. Re-adjudicate from the supplied quoteCatalog; do not preserve an invalid classification merely because it appeared previously.`,
            },
        schemaForModel(model),
      );
      const result = materializeScreeningSemanticLabProposal(previous, parsedInput);
      attempts.push({ attempt: attempt + 1, valid: true, output: previous });
      return {
        result,
        attempts,
        firstPassValid: attempt === 0,
        repaired: attempt > 0,
      };
    } catch (error) {
      issue = error instanceof Error ? error.message : 'Invalid semantic-lab output';
      attempts.push({ attempt: attempt + 1, valid: false, output: previous, error: issue });
    }
  }

  return {
    attempts,
    firstPassValid: false,
    repaired: false,
    error: issue || 'Semantic-lab output failed validation',
  };
}

export type ScreeningSemanticExpectation = {
  screeningFunction: StagedScreeningFunction;
  gateBasis: StagedScreeningGateBasis;
};
