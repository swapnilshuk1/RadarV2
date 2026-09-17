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
2. ENTRY_QUALIFICATION means the source requires the candidate to arrive with a pre-existing qualification, credential, eligibility state, artifact, tenure threshold, or retrospective experience/background. Explicit shortlisting/disqualification language is one way to establish an entry qualification, but it is not required when the source already states a genuine pre-entry qualification.
3. ROLE_PERFORMANCE_REQUIREMENT means the source describes a prospective skill, capability, proficiency, knowledge, working style, responsibility, or success expectation for doing the job, without requiring a distinct pre-existing qualification. It must use gateBasis=NONE.
4. PREFERRED or explicitly optional requirements are always ROLE_PERFORMANCE_REQUIREMENT / NONE.
5. Section headings are contextual evidence, not semantic overrides. Headings such as Required Skills, Skills & Capabilities, Qualifications, or Must-Have do not by themselves decide screeningFunction. Do not demote an explicit tenure threshold or retrospective experience requirement merely because it appears under a skills/capabilities heading; likewise do not promote a pure skill/capability statement merely because it appears under a required or must-have heading.
6. MINIMUM_TENURE means an explicit numeric or verbal duration threshold on experience the candidate must already have. For a REQUIRED candidate requirement, wording such as a number/range of years or months of experience is normally ENTRY_QUALIFICATION / MINIMUM_TENURE unless the source explicitly makes it optional or clearly describes future time-in-role rather than prior experience. Do not require separate shortlisting language.
7. MANDATORY_CREDENTIAL means a formal educational degree, licence, certification, professional qualification, or registration the candidate must already hold. Tool/platform knowledge is not a credential.
8. PRIOR_RELEVANT_EXPERIENCE means non-duration retrospective candidate history: prior/proven/hands-on experience, experience doing or managing something, prior background, track record, or exposure. When such retrospective wording is a REQUIRED or must-have candidate requirement, normally treat it as ENTRY_QUALIFICATION / PRIOR_RELEVANT_EXPERIENCE even if it is listed in a skills section. Do not require a numeric duration or explicit shortlisting words. By contrast, expertise, knowledge, proficiency, ability, grounding, comfort, or responsibility wording without retrospective history remains a performance requirement unless the source separately makes it an entry condition.
9. ELIGIBILITY_CONDITION means legal/regulatory/right-to-work/clearance eligibility for employment.
10. QUALIFYING_ARTIFACT means a candidate-supplied artifact required to qualify or progress, such as a portfolio or work sample.
11. EXPLICIT_SHORTLIST_CONDITION means the source explicitly ties possession/non-possession to consideration, shortlisting, interview, or disqualification. Use this when explicit selection language itself is the basis rather than another more specific qualification basis.
12. Use the requirement wording together with all supplied quotes. Prefer the semantic substance of the requirement over generic section labels. Do not infer a stronger condition than the source actually states.
13. Do not reason about the candidate's evidence, fit, desire, willingness, or likelihood of acceptance.`;

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
