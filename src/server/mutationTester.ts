import fs from 'fs';
import path from 'path';
import { runUntrustedCodeTests } from './testRunner.ts';

export interface Mutant {
  id: string;
  description: string;
  mutatedCode: string;
  status: 'KILLED' | 'SURVIVED' | 'ERROR';
  detectedByTest?: string;
}

export interface MutationTestResult {
  score: number | 'Unavailable';
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  sensitivity: 'Robust' | 'Moderate' | 'Weak' | 'Unavailable';
  mutants: Mutant[];
}

/**
 * Generates controlled mutants from original code
 */
export function generateMutants(code: string): Mutant[] {
  const mutants: Mutant[] = [];

  // Mutation 1: Invert comparison operators (> to <=, < to >=)
  if (/>\s*(?!=)/.test(code)) {
    mutants.push({
      id: 'mut_cmp_gt',
      description: 'Invert greater-than comparison (> to <=)',
      mutatedCode: code.replace(/>\s*(?!=)/, '<= '),
      status: 'SURVIVED',
    });
  } else if (/<\s*(?!=)/.test(code)) {
    mutants.push({
      id: 'mut_cmp_lt',
      description: 'Invert less-than comparison (< to >=)',
      mutatedCode: code.replace(/<\s*(?!=)/, '>= '),
      status: 'SURVIVED',
    });
  }

  // Mutation 2: Invert equality operator (=== to !==)
  if (/===/.test(code)) {
    mutants.push({
      id: 'mut_eq',
      description: 'Invert strict equality check (=== to !==)',
      mutatedCode: code.replace(/===/, '!=='),
      status: 'SURVIVED',
    });
  } else if (/!==/.test(code)) {
    mutants.push({
      id: 'mut_neq',
      description: 'Invert strict inequality check (!== to ===)',
      mutatedCode: code.replace(/!==/, '==='),
      status: 'SURVIVED',
    });
  }

  // Mutation 3: Invert arithmetic operators (+ to - or * to /)
  if (/\bprice\s*\*\s*0\./i.test(code)) {
    mutants.push({
      id: 'mut_discount_add',
      description: 'Calculate discount by adding instead of multiplying/subtracting',
      mutatedCode: code.replace(/\bprice\s*\*\s*(0\.\d+)/i, 'price + $1'),
      status: 'SURVIVED',
    });
  } else if (/\+\s*(?!\+)/.test(code) && !/\+\+/.test(code)) {
    mutants.push({
      id: 'mut_arith_plus',
      description: 'Invert addition operator (+ to -)',
      mutatedCode: code.replace(/\+\s*(?!\+)/, '- '),
      status: 'SURVIVED',
    });
  }

  // Mutation 4: Invert trim logic or default fallback
  if (/\.trim\(\)/.test(code)) {
    mutants.push({
      id: 'mut_omit_trim',
      description: 'Omit string trimming (.trim() removed)',
      mutatedCode: code.replace(/\.trim\(\)/g, ''),
      status: 'SURVIVED',
    });
  }

  // Mutation 5: Invert default return string (e.g. 'Guest' to 'Anonymous' or null)
  if (/'Guest'|"Guest"/.test(code)) {
    mutants.push({
      id: 'mut_default_string',
      description: 'Alter default fallback return value ("Guest" to "Anonymous")',
      mutatedCode: code.replace(/'Guest'|"Guest"/, "'Anonymous'"),
      status: 'SURVIVED',
    });
  } else if (/return\s+0\b/.test(code)) {
    mutants.push({
      id: 'mut_return_num',
      description: 'Alter default return number (0 to 1)',
      mutatedCode: code.replace(/return\s+0\b/, 'return 1'),
      status: 'SURVIVED',
    });
  } else if (/return\s+null\b/.test(code)) {
    mutants.push({
      id: 'mut_return_null',
      description: 'Alter return null to return undefined',
      mutatedCode: code.replace(/return\s+null\b/, 'return undefined'),
      status: 'SURVIVED',
    });
  }

  // Mutation 6: Invert boolean or null check
  if (/!user\b/.test(code)) {
    mutants.push({
      id: 'mut_invert_null_check',
      description: 'Invert null check condition (!user to Boolean(user))',
      mutatedCode: code.replace(/!user\b/, 'Boolean(user)'),
      status: 'SURVIVED',
    });
  }

  return mutants.slice(0, 4); // Limit to top 4 mutations for fast execution (< 5s)
}

/**
 * Runs the test suite against each generated mutant to test test-sensitivity
 */
export async function runMutationTesting(
  originalCode: string,
  testFileCode: string
): Promise<MutationTestResult> {
  const mutants = generateMutants(originalCode);
  if (mutants.length === 0 || !testFileCode) {
    return {
      score: 'Unavailable',
      totalMutants: 0,
      killedMutants: 0,
      survivedMutants: 0,
      sensitivity: 'Unavailable',
      mutants: [],
    };
  }

  let killedCount = 0;

  for (const mutant of mutants) {
    try {
      const execResult = await runUntrustedCodeTests(mutant.mutatedCode, testFileCode, 15000);
      // If tests failed on the mutant, the mutant is successfully killed!
      if (execResult.failed > 0 || execResult.status === 'FAIL') {
        mutant.status = 'KILLED';
        mutant.detectedByTest = execResult.failingTests?.[0]?.title || 'Behaviour test assertion';
        killedCount++;
      } else {
        mutant.status = 'SURVIVED';
      }
    } catch {
      mutant.status = 'KILLED'; // Compilation or runtime crash on mutant also catches it
      killedCount++;
    }
  }

  const score = Math.round((killedCount / mutants.length) * 100);
  const sensitivity: 'Robust' | 'Moderate' | 'Weak' =
    score >= 80 ? 'Robust' : score >= 50 ? 'Moderate' : 'Weak';

  return {
    score,
    totalMutants: mutants.length,
    killedMutants: killedCount,
    survivedMutants: mutants.length - killedCount,
    sensitivity,
    mutants,
  };
}
