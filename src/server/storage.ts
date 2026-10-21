import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'experiment.json');

export interface CoverageMetrics {
  linesPct: number | 'Unavailable';
  branchesPct: number | 'Unavailable';
  statementsPct: number | 'Unavailable';
  functionsPct: number | 'Unavailable';
}

export interface ModelResult {
  runId: string;
  timestamp: string;
  status: 'PASS' | 'FAIL' | 'ERROR' | 'INVALID RESPONSE';
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  testsTotal: number;
  passRate: string;
  behaviourPreserved: string;
  failingTests: Array<{ title: string; failureMessage: string; expected?: string; received?: string }>;
  runnerError: string | null;
  compileErrors: string | null;
  timeouts: number;
  coverage: CoverageMetrics;
  publicInterface: 'Same' | 'Changed' | 'Unavailable';
  interfaceDetails: string;
  isResponseValid: boolean;
  invalidReason?: string;
  originalLineCount: number;
  refactoredLineCount: number;
  eslintErrors: number;
  eslintWarnings: number;
  eslintOriginalErrors: number;
  eslintOriginalWarnings: number;
  eslintComparison: 'improved' | 'worse' | 'same' | 'Unavailable';
  eslintMessages: Array<{ line: number; column: number; ruleId: string; message: string; severity: number }>;
  metrics: {
    cyclomatic: number | 'Unavailable';
    maintainability: number | 'Unavailable';
    duplication: { duplicateLines: number; totalLines: number; percentage: string } | 'Unavailable';
  };
  originalMetrics: {
    cyclomatic: number | 'Unavailable';
    maintainability: number | 'Unavailable';
    duplication: { duplicateLines: number; totalLines: number; percentage: string } | 'Unavailable';
  };
  complexityComparison: 'improved' | 'worse' | 'same' | 'Unavailable';
  maintainabilityComparison: 'improved' | 'worse' | 'same' | 'Unavailable';
}

export interface ModelEntry {
  status: 'not_run' | 'testing' | 'PASS' | 'FAIL' | 'ERROR' | 'INVALID RESPONSE';
  code: string;
  responseTime: string;
  prompt: string;
  result: ModelResult | null;
  history: ModelResult[];
}

export interface TestItem {
  name: string;
  inputDesc: string;
  category: 'Normal' | 'Edge cases' | 'Invalid';
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  error?: string;
}

export interface TestGroupStats {
  category: 'Normal' | 'Edge cases' | 'Invalid';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestItem[];
}

export interface GeneratedTestsState {
  hasGenerated: boolean;
  seed: number;
  inputCount: number;
  testFileCode: string;
  comparable: boolean;
  notComparableReason?: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  groups: {
    normal: TestGroupStats;
    edgeCases: TestGroupStats;
    invalid: TestGroupStats;
  };
  coverage: CoverageMetrics;
  errors: Array<{ title: string; failureMessage: string }>;
  history: Array<{
    seed: number;
    timestamp: string;
    total: number;
    passed: number;
    failed: number;
    coverage: CoverageMetrics;
  }>;
  timestamp: string | null;
}

export interface ExperimentState {
  step: 1 | 2 | 3 | 4; // 1: Source Code, 2: Tests, 3: Refactoring, 4: Results
  originalCode: string;
  lockedOriginalCode: string;
  generatedTests: GeneratedTestsState;
  lockedTestFileCode: string;
  strategy: 'basic' | 'structured' | 'test_aware';
  strategyLocked: boolean;
  models: {
    chatgpt: ModelEntry;
    claude: ModelEntry;
    gemini: ModelEntry;
  };
  agreement: Record<string, any>;
  updatedAt: string;
}

export function getDefaultState(): ExperimentState {
  return {
    step: 1,
    originalCode: '',
    lockedOriginalCode: '',
    lockedTestFileCode: '',
    generatedTests: {
      hasGenerated: false,
      seed: 42,
      inputCount: 0,
      testFileCode: '',
      comparable: true,
      notComparableReason: undefined,
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      groups: {
        normal: { category: 'Normal', total: 0, passed: 0, failed: 0, skipped: 0, tests: [] },
        edgeCases: { category: 'Edge cases', total: 0, passed: 0, failed: 0, skipped: 0, tests: [] },
        invalid: { category: 'Invalid', total: 0, passed: 0, failed: 0, skipped: 0, tests: [] },
      },
      coverage: {
        linesPct: 'Unavailable',
        branchesPct: 'Unavailable',
        statementsPct: 'Unavailable',
        functionsPct: 'Unavailable',
      },
      errors: [],
      history: [],
      timestamp: null,
    },
    strategy: 'basic',
    strategyLocked: false,
    models: {
      chatgpt: {
        status: 'not_run',
        code: '',
        responseTime: '',
        prompt: '',
        result: null,
        history: [],
      },
      claude: {
        status: 'not_run',
        code: '',
        responseTime: '',
        prompt: '',
        result: null,
        history: [],
      },
      gemini: {
        status: 'not_run',
        code: '',
        responseTime: '',
        prompt: '',
        result: null,
        history: [],
      },
    },
    agreement: {},
    updatedAt: new Date().toISOString(),
  };
}

export function getExperimentState(): ExperimentState {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      const initial = getDefaultState();
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...getDefaultState(),
      ...parsed,
      generatedTests: {
        ...getDefaultState().generatedTests,
        ...(parsed.generatedTests || {}),
        coverage: {
          ...getDefaultState().generatedTests.coverage,
          ...(parsed.generatedTests?.coverage || {}),
        },
        groups: {
          normal: {
            ...getDefaultState().generatedTests.groups.normal,
            ...(parsed.generatedTests?.groups?.normal || {}),
          },
          edgeCases: {
            ...getDefaultState().generatedTests.groups.edgeCases,
            ...(parsed.generatedTests?.groups?.edgeCases || {}),
          },
          invalid: {
            ...getDefaultState().generatedTests.groups.invalid,
            ...(parsed.generatedTests?.groups?.invalid || {}),
          },
        },
      },
      models: {
        chatgpt: { ...getDefaultState().models.chatgpt, ...(parsed.models?.chatgpt || {}) },
        claude: { ...getDefaultState().models.claude, ...(parsed.models?.claude || {}) },
        gemini: { ...getDefaultState().models.gemini, ...(parsed.models?.gemini || {}) },
      },
      agreement: parsed.agreement || {},
    };
  } catch (err) {
    console.error('Error reading experiment state:', err);
    return getDefaultState();
  }
}

export function saveExperimentState(state: ExperimentState): ExperimentState {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const payload: ExperimentState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export function resetExperimentState(): ExperimentState {
  const reset = getDefaultState();
  return saveExperimentState(reset);
}
