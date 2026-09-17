import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { createBedrockGlmResearchModel } from '../src/lib/model/bedrock-glm-research-model';
import { runScreeningSemanticLabCase } from '../src/dossier/screening-semantic-lab';
import { screeningSemanticCorpus, type ScreeningSemanticCorpusCase } from './screening-semantic-corpus';

const OUTPUT_PATH = '.radar/dossier-runs/screening-semantic-lab.json';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function bearerToken(): string {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (token) return token;

  const lines = readFileSync('bedrock-long-term-api-key.csv', 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
  const values = lines[1].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
  const index = headers.findIndex(header => ['ServiceApiKeyValue', 'API key', 'API key value'].includes(header));
  if (index < 0 || !values[index]) throw new Error('Bedrock API key is unavailable');
  return values[index];
}

process.env.AWS_BEARER_TOKEN_BEDROCK = bearerToken();

const repeats = Math.max(1, Number(option('--repeats') ?? '1'));
const concurrency = Math.max(1, Math.min(8, Number(option('--concurrency') ?? '3')));
const maxAttempts = Math.max(1, Math.min(3, Number(option('--max-attempts') ?? '2')));
const onlyScored = process.argv.includes('--only-scored');
const selectedCases = onlyScored ? screeningSemanticCorpus.filter(item => item.scored) : screeningSemanticCorpus;
const model = createBedrockGlmResearchModel();

type RunItem = { corpusCase: ScreeningSemanticCorpusCase; repeat: number };
const work: RunItem[] = selectedCases.flatMap(corpusCase =>
  Array.from({ length: repeats }, (_, repeat) => ({ corpusCase, repeat: repeat + 1 })),
);

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const executions = await mapConcurrent(work, concurrency, async ({ corpusCase, repeat }) => {
  const execution = await runScreeningSemanticLabCase(model, corpusCase.input, maxAttempts);
  const actual = execution.result
    ? {
        screeningFunction: execution.result.screeningFunction,
        gateBasis: execution.result.gateBasis,
        screeningGate: execution.result.screeningGate,
        supportQuoteIds: execution.result.supportQuoteIds,
        reasoning: execution.result.reasoning,
      }
    : null;
  const expectedGate = corpusCase.input.requirement.strength === 'REQUIRED'
    && corpusCase.expected.screeningFunction === 'ENTRY_QUALIFICATION'
    && corpusCase.expected.gateBasis !== 'NONE';
  const functionMatch = actual?.screeningFunction === corpusCase.expected.screeningFunction;
  const basisMatch = actual?.gateBasis === corpusCase.expected.gateBasis;

  return {
    caseId: corpusCase.id,
    role: corpusCase.role,
    scored: corpusCase.scored,
    repeat,
    requirement: corpusCase.input.requirement,
    quoteCatalog: corpusCase.input.quoteCatalog,
    expected: { ...corpusCase.expected, screeningGate: expectedGate },
    actual,
    firstPassValid: execution.firstPassValid,
    repaired: execution.repaired,
    attempts: execution.attempts,
    technicalError: execution.error ?? null,
    functionMatch,
    basisMatch,
    exactMatch: Boolean(functionMatch && basisMatch),
    gateMatch: actual?.screeningGate === expectedGate,
    note: corpusCase.note,
  };
});

const scoredRuns = executions.filter(item => item.scored);
const validScoredRuns = scoredRuns.filter(item => item.actual);
const technicalFailures = executions.filter(item => !item.actual);
const exactMatches = scoredRuns.filter(item => item.exactMatch).length;
const functionMatches = scoredRuns.filter(item => item.functionMatch).length;
const gateMatches = scoredRuns.filter(item => item.gateMatch).length;
const firstPassValid = scoredRuns.filter(item => item.firstPassValid).length;
const repaired = scoredRuns.filter(item => item.repaired).length;

let truePositive = 0;
let falsePositive = 0;
let trueNegative = 0;
let falseNegative = 0;
for (const item of validScoredRuns) {
  const expectedGate = item.expected.screeningGate;
  const actualGate = item.actual!.screeningGate;
  if (expectedGate && actualGate) truePositive += 1;
  else if (!expectedGate && actualGate) falsePositive += 1;
  else if (!expectedGate && !actualGate) trueNegative += 1;
  else falseNegative += 1;
}

const safeRatio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
const byExpectedBasis = Object.fromEntries(
  [...new Set(scoredRuns.map(item => item.expected.gateBasis))].sort().map(basis => {
    const items = scoredRuns.filter(item => item.expected.gateBasis === basis);
    return [basis, {
      count: items.length,
      exactMatches: items.filter(item => item.exactMatch).length,
      exactAccuracy: safeRatio(items.filter(item => item.exactMatch).length, items.length),
    }];
  }),
);

const semanticMismatches = scoredRuns.filter(item => item.actual && !item.exactMatch).map(item => ({
  caseId: item.caseId,
  role: item.role,
  requirement: item.requirement.requirement,
  expected: item.expected,
  actual: item.actual,
  note: item.note,
}));

const challengeResults = executions.filter(item => !item.scored).map(item => ({
  caseId: item.caseId,
  role: item.role,
  requirement: item.requirement.requirement,
  hypothesis: item.expected,
  actual: item.actual,
  firstPassValid: item.firstPassValid,
  technicalError: item.technicalError,
  note: item.note,
}));

const summary = {
  model: { id: model.id, version: model.version },
  corpusCases: selectedCases.length,
  scoredCases: selectedCases.filter(item => item.scored).length,
  challengeCases: selectedCases.filter(item => !item.scored).length,
  repeats,
  totalExecutions: executions.length,
  scoredExecutions: scoredRuns.length,
  technicalFailures: technicalFailures.length,
  firstPassValidRate: safeRatio(firstPassValid, scoredRuns.length),
  repairedScoredExecutions: repaired,
  functionAccuracy: safeRatio(functionMatches, scoredRuns.length),
  exactFunctionAndBasisAccuracy: safeRatio(exactMatches, scoredRuns.length),
  gateAccuracy: safeRatio(gateMatches, scoredRuns.length),
  gatePrecision: safeRatio(truePositive, truePositive + falsePositive),
  gateRecall: safeRatio(truePositive, truePositive + falseNegative),
  gateConfusion: { truePositive, falsePositive, trueNegative, falseNegative },
  byExpectedBasis,
};

const artifact = {
  generatedAt: new Date().toISOString(),
  mode: 'SCREENING_SEMANTIC_LAB',
  persistenceWrites: false,
  queueUsed: false,
  summary,
  semanticMismatches,
  challengeResults,
  executions,
};

mkdirSync('.radar/dossier-runs', { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(artifact, null, 2));
console.log(JSON.stringify({ written: OUTPUT_PATH, summary, semanticMismatches, challengeResults }, null, 2));

if (technicalFailures.length) process.exitCode = 2;
