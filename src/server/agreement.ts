// @ts-ignore
import * as babelParser from '@babel/parser';
// @ts-ignore
import babelGenerator from '@babel/generator';
import * as Diff from 'diff';
import { ModelEntry } from './storage.ts';

const generate = (babelGenerator as any).default || babelGenerator;

export type AgreementStatus =
  | 'Identical'
  | 'Same after formatting'
  | 'Different'
  | 'Not run yet'
  | 'Unavailable';

export interface AgreementPairResult {
  modelA: 'chatgpt' | 'claude' | 'gemini';
  modelB: 'chatgpt' | 'claude' | 'gemini';
  status: AgreementStatus;
  samePassFail: 'Yes' | 'No' | 'Not run yet';
  diff: Array<{ value: string; added?: boolean; removed?: boolean }>;
}

export function formatCodeForComparison(code: string): string | null {
  if (!code || typeof code !== 'string') return null;
  try {
    const ast = babelParser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
    });
    return generate(ast, {
      comments: false,
      compact: false,
      retainLines: false,
    }).code.trim();
  } catch {
    return null;
  }
}

export function compareModelPair(
  entryA: ModelEntry | undefined,
  entryB: ModelEntry | undefined,
  nameA: 'chatgpt' | 'claude' | 'gemini',
  nameB: 'chatgpt' | 'claude' | 'gemini'
): AgreementPairResult {
  if (
    !entryA ||
    !entryB ||
    entryA.status === 'not_run' ||
    entryB.status === 'not_run' ||
    !entryA.result ||
    !entryB.result
  ) {
    return {
      modelA: nameA,
      modelB: nameB,
      status: 'Not run yet',
      samePassFail: 'Not run yet',
      diff: [],
    };
  }

  const rawA = (entryA.code || '').replace(/\r\n/g, '\n').trim();
  const rawB = (entryB.code || '').replace(/\r\n/g, '\n').trim();

  const diff = Diff.diffLines(rawA, rawB);

  // Check 1: Identical
  let status: AgreementStatus = 'Different';
  if (rawA === rawB) {
    status = 'Identical';
  } else {
    // Check 2: Same after formatting
    const formattedA = formatCodeForComparison(rawA);
    const formattedB = formatCodeForComparison(rawB);

    if (formattedA === null || formattedB === null) {
      status = 'Unavailable';
    } else if (formattedA === formattedB) {
      status = 'Same after formatting';
    } else {
      status = 'Different';
    }
  }

  // Same pass/fail check:
  // Both have the same overall status and same set of failing tests
  const failA = (entryA.result.failingTests || []).map((t) => t.title).sort();
  const failB = (entryB.result.failingTests || []).map((t) => t.title).sort();

  const statusMatch = entryA.result.status === entryB.result.status;
  const failingMatch = JSON.stringify(failA) === JSON.stringify(failB);

  const samePassFail = statusMatch && failingMatch ? 'Yes' : 'No';

  return {
    modelA: nameA,
    modelB: nameB,
    status,
    samePassFail,
    diff,
  };
}

export function computeAgreementMatrix(models: {
  chatgpt: ModelEntry;
  claude: ModelEntry;
  gemini: ModelEntry;
}): Record<string, AgreementPairResult> {
  const keys: Array<'chatgpt' | 'claude' | 'gemini'> = ['chatgpt', 'claude', 'gemini'];
  const matrix: Record<string, AgreementPairResult> = {};

  for (const m1 of keys) {
    for (const m2 of keys) {
      if (m1 !== m2) {
        const pairKey = `${m1}_${m2}`;
        matrix[pairKey] = compareModelPair(models[m1], models[m2], m1, m2);
      }
    }
  }

  return matrix;
}
