import { ExperimentState } from './storage.ts';

export interface BestModelEvaluation {
  winner: string | null;
  winnerKey: 'chatgpt' | 'claude' | 'gemini' | null;
  reason: string;
}

export function evaluateBestModel(models: ExperimentState['models']): BestModelEvaluation {
  const modelKeys: Array<'chatgpt' | 'claude' | 'gemini'> = ['chatgpt', 'claude', 'gemini'];
  const modelNames: Record<'chatgpt' | 'claude' | 'gemini', string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
  };

  const missing: string[] = [];
  for (const key of modelKeys) {
    const m = models[key];
    if (!m || m.status === 'not_run' || !m.result) {
      missing.push(modelNames[key]);
    }
  }

  if (missing.length > 0) {
    return {
      winner: null,
      winnerKey: null,
      reason: `${missing.join(' and ')} not run yet.`,
    };
  }

  // All 3 models are completed
  const completed = modelKeys.map((key) => {
    const res = models[key].result!;
    return {
      key,
      name: modelNames[key],
      status: res.status,
      allTestsPassed: res.status === 'PASS',
      publicInterfaceSame: res.publicInterface === 'Same',
      responseValid: res.isResponseValid !== false,
      eslintErrors: res.eslintErrors,
      maintainability:
        typeof res.metrics.maintainability === 'number'
          ? (res.metrics.maintainability as number)
          : -999,
    };
  });

  const passingModels = completed.filter(
    (m) => m.allTestsPassed && m.publicInterfaceSame && m.responseValid
  );

  if (passingModels.length === 0) {
    return {
      winner: null,
      winnerKey: null,
      reason: 'No model passed all validated tests with an unchanged public interface.',
    };
  }

  if (passingModels.length === 1) {
    return {
      winner: passingModels[0].name,
      winnerKey: passingModels[0].key,
      reason: `${passingModels[0].name} passed all tests with an unchanged public interface.`,
    };
  }

  // Check dominance
  const candidates = passingModels.filter((candidate) => {
    return passingModels.every((other) => {
      if (candidate.key === other.key) return true;
      const fewerOrEqualErrors = candidate.eslintErrors <= other.eslintErrors;
      const betterOrEqualMaint = candidate.maintainability >= other.maintainability;
      return fewerOrEqualErrors && betterOrEqualMaint;
    });
  });

  if (candidates.length === 1) {
    const best = candidates[0];
    const strictlyBetter = passingModels.some(
      (o) =>
        o.key !== best.key &&
        (best.eslintErrors < o.eslintErrors || best.maintainability > o.maintainability)
    );

    if (strictlyBetter) {
      return {
        winner: best.name,
        winnerKey: best.key,
        reason: `${best.name} passed all tests with unchanged interface, fewest ESLint errors, and highest maintainability.`,
      };
    }
  }

  // Check if tied
  const minErrors = Math.min(...passingModels.map((m) => m.eslintErrors));
  const maxMaint = Math.max(...passingModels.map((m) => m.maintainability));
  const tied = passingModels.filter(
    (m) => m.eslintErrors === minErrors && m.maintainability === maxMaint
  );

  if (tied.length > 1) {
    return {
      winner: null,
      winnerKey: null,
      reason: 'Models tied with identical test, lint, and maintainability scores.',
    };
  }

  return {
    winner: null,
    winnerKey: null,
    reason: 'Models tied or have trade-offs between lint errors and maintainability.',
  };
}

export function generateCSVExport(state: ExperimentState): string {
  const modelKeys: Array<'chatgpt' | 'claude' | 'gemini'> = ['chatgpt', 'claude', 'gemini'];
  const modelNames: Record<'chatgpt' | 'claude' | 'gemini', string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
  };

  const escapeCSV = (val: any) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const headers = [
    'Model',
    'Status',
    'Pass Rate',
    'Tests Passed',
    'Tests Failed',
    'Behaviour Label',
    'Coverage (Lines %)',
    'Coverage (Branches %)',
    'Public Interface Check',
    'Response Valid',
    'Original Lines of Code',
    'Refactored Lines of Code',
    'ESLint Errors (Refactored)',
    'ESLint Warnings (Refactored)',
    'ESLint Errors (Original)',
    'ESLint Comparison',
    'Original Cyclomatic Complexity',
    'Refactored Cyclomatic Complexity',
    'Cyclomatic Complexity Comparison',
    'Original Maintainability Index',
    'Refactored Maintainability Index',
    'Maintainability Index Comparison',
    'Original Code Duplication',
    'Refactored Code Duplication',
    'Response Time (s)',
    'Prompt Strategy',
    'Run Timestamp',
  ];

  const rows: string[] = [headers.join(',')];

  for (const key of modelKeys) {
    const m = state.models[key];
    const res = m?.result;
    if (!res) {
      rows.push(
        [
          escapeCSV(modelNames[key]),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV(state.lockedOriginalCode ? state.lockedOriginalCode.split('\n').length : 'Unavailable'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV('Not run yet'),
          escapeCSV(m?.responseTime || 'Not provided'),
          escapeCSV(state.strategy),
          escapeCSV('Unavailable'),
        ].join(',')
      );
      continue;
    }

    const linesCov = res.coverage?.linesPct !== 'Unavailable' ? `${res.coverage.linesPct}%` : 'Unavailable';
    const branchesCov = res.coverage?.branchesPct !== 'Unavailable' ? `${res.coverage.branchesPct}%` : 'Unavailable';

    rows.push(
      [
        escapeCSV(modelNames[key]),
        escapeCSV(res.status),
        escapeCSV(res.passRate),
        escapeCSV(res.testsPassed),
        escapeCSV(res.testsFailed),
        escapeCSV(res.behaviourPreserved),
        escapeCSV(linesCov),
        escapeCSV(branchesCov),
        escapeCSV(res.publicInterface || 'Unavailable'),
        escapeCSV(res.isResponseValid ? 'Yes' : `Invalid: ${res.invalidReason || 'Error'}`),
        escapeCSV(res.originalLineCount),
        escapeCSV(res.refactoredLineCount),
        escapeCSV(res.eslintErrors),
        escapeCSV(res.eslintWarnings),
        escapeCSV(res.eslintOriginalErrors ?? 'Unavailable'),
        escapeCSV(res.eslintComparison ?? 'Unavailable'),
        escapeCSV(res.originalMetrics?.cyclomatic ?? 'Unavailable'),
        escapeCSV(res.metrics?.cyclomatic ?? 'Unavailable'),
        escapeCSV(res.complexityComparison ?? 'Unavailable'),
        escapeCSV(res.originalMetrics?.maintainability ?? 'Unavailable'),
        escapeCSV(res.metrics?.maintainability ?? 'Unavailable'),
        escapeCSV(res.maintainabilityComparison ?? 'Unavailable'),
        escapeCSV(
          typeof res.originalMetrics?.duplication === 'object'
            ? res.originalMetrics.duplication.percentage
            : 'Unavailable'
        ),
        escapeCSV(
          typeof res.metrics?.duplication === 'object'
            ? res.metrics.duplication.percentage
            : 'Unavailable'
        ),
        escapeCSV(m.responseTime || 'Not provided'),
        escapeCSV(state.strategy),
        escapeCSV(res.timestamp),
      ].join(',')
    );
  }

  // Append full artifacts section
  rows.push('\n');
  rows.push('--- EXPERIMENT ARTIFACTS & TOOL VERSIONS ---');
  rows.push(`Jest Version,30.5.2`);
  rows.push(`ESLint Version,10.13.0`);
  rows.push(`Node Environment,jsdom`);
  rows.push(`Seed Used,${escapeCSV(state.generatedTests.seed)}`);
  rows.push(`Total Generated Inputs,${escapeCSV(state.generatedTests.inputCount)}`);
  rows.push(`Comparable,${escapeCSV(state.generatedTests.comparable ? 'YES' : 'NO (' + (state.generatedTests.notComparableReason || '') + ')')}`);
  rows.push(`Strategy Chosen,${escapeCSV(state.strategy)}`);
  rows.push(`Baseline Coverage Lines,${escapeCSV(state.generatedTests.coverage?.linesPct !== 'Unavailable' ? `${state.generatedTests.coverage.linesPct}%` : 'Unavailable')}`);
  rows.push(`Baseline Coverage Branches,${escapeCSV(state.generatedTests.coverage?.branchesPct !== 'Unavailable' ? `${state.generatedTests.coverage.branchesPct}%` : 'Unavailable')}`);

  rows.push('\n');
  rows.push('--- DO THE MODELS AGREE? (PAIRWISE) ---');
  for (const m1 of modelKeys) {
    for (const m2 of modelKeys) {
      if (m1 !== m2) {
        const pairKey = `${m1}_${m2}`;
        const ag = state.agreement?.[pairKey];
        if (ag) {
          rows.push(`${modelNames[m1]} vs ${modelNames[m2]},Agreement: ${ag.status},Same Pass/Fail: ${ag.samePassFail}`);
        }
      }
    }
  }

  rows.push('\n');
  rows.push('--- ORIGINAL CODE ---');
  rows.push(escapeCSV(state.lockedOriginalCode || state.originalCode));

  rows.push('\n');
  rows.push('--- GENERATED TEST FILE (code.test.js) ---');
  rows.push(escapeCSV(state.lockedTestFileCode || state.generatedTests.testFileCode));

  for (const key of modelKeys) {
    const m = state.models[key];
    rows.push('\n');
    rows.push(`--- ${modelNames[key].toUpperCase()} PROMPT ---`);
    rows.push(escapeCSV(m.prompt || 'Not generated'));
    rows.push(`--- ${modelNames[key].toUpperCase()} RESPONSE CODE ---`);
    rows.push(escapeCSV(m.code || 'Not submitted'));
  }

  return rows.join('\n');
}
