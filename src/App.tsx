/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  FileCode,
  Sparkles,
  Info,
  GitCompare,
  X,
  RefreshCw,
  Layers,
  Code2,
  Search,
  HelpCircle,
  Bug,
} from 'lucide-react';

interface CoverageMetrics {
  linesPct: number | 'Unavailable';
  branchesPct: number | 'Unavailable';
  statementsPct: number | 'Unavailable';
  functionsPct: number | 'Unavailable';
}

interface TestItem {
  name: string;
  inputDesc: string;
  expectedOutcome?: string;
  category: 'Normal' | 'Edge cases' | 'Invalid';
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  error?: string;
}

interface TestGroupStats {
  category: 'Normal' | 'Edge cases' | 'Invalid';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestItem[];
}

interface GeneratedTestsState {
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

interface ModelResult {
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

interface ModelEntry {
  status: 'not_run' | 'testing' | 'PASS' | 'FAIL' | 'ERROR' | 'INVALID RESPONSE';
  code: string;
  responseTime: string;
  prompt: string;
  result: ModelResult | null;
  history: ModelResult[];
}

interface AgreementPair {
  modelA: 'chatgpt' | 'claude' | 'gemini';
  modelB: 'chatgpt' | 'claude' | 'gemini';
  status: 'Identical' | 'Same after formatting' | 'Different' | 'Not run yet' | 'Unavailable';
  samePassFail: 'Yes' | 'No' | 'Not run yet';
  diff: Array<{ value: string; added?: boolean; removed?: boolean }>;
}

interface ExperimentState {
  step: 1 | 2 | 3 | 4;
  originalCode: string;
  lockedOriginalCode: string;
  lockedTestFileCode: string;
  generatedTests: GeneratedTestsState;
  strategy: 'basic' | 'structured' | 'test_aware';
  strategyLocked: boolean;
  models: {
    chatgpt: ModelEntry;
    claude: ModelEntry;
    gemini: ModelEntry;
  };
  agreement: Record<string, AgreementPair>;
  updatedAt?: string;
}

const STRATEGY_TEXTS = {
  basic: 'Improve readability and maintainability while preserving behaviour.',
  structured:
    'Improve readability, simplify control flow, reduce duplication, and preserve existing functionality and interfaces.',
  test_aware:
    'Preserve observable behaviour, edge cases, inputs, outputs, error handling, side effects, and public interfaces. Never weaken trusted tests.',
};

const STRATEGY_LABELS = {
  basic: '1. Basic Strategy',
  structured: '2. Structured Strategy',
  test_aware: '3. Test-Aware Strategy',
};

const SAMPLE_CODE_OPTIONS = {
  displayName: `export function getDisplayName(user) {
  if (!user) return 'Guest';
  if (typeof user === 'string') {
    const trimmed = user.trim();
    if (!trimmed) return 'Guest';
    return trimmed;
  }
  if (typeof user === 'object') {
    if (user.name && typeof user.name === 'string') {
      const trimmed = user.name.trim();
      if (trimmed) return trimmed;
    }
    if (user.username && typeof user.username === 'string') {
      const trimmed = user.username.trim();
      if (trimmed) return trimmed;
    }
  }
  return 'Guest';
}`,

  userPanel: `export default function UserPanel(props) {
  if (!props || !props.visible) {
    return null;
  }

  const user = props.user;
  let displayName = 'Guest';
  if (user) {
    if (typeof user === 'string' && user.trim()) {
      displayName = user.trim();
    } else if (user.name && typeof user.name === 'string' && user.name.trim()) {
      displayName = user.name.trim();
    }
  }

  return (
    <div className="user-panel">
      <h3>{displayName}</h3>
    </div>
  );
}`,

  throwsOnNull: `export function getUserCity(user) {
  // Throws TypeError if user is null or undefined
  return user.address.city;
}`,

  commonJS: `function calculateTotal(price, taxRate) {
  if (typeof price !== 'number' || Number.isNaN(price)) return 0;
  const tax = (typeof taxRate === 'number' && !Number.isNaN(taxRate)) ? taxRate : 0.05;
  return price + (price * tax);
}

module.exports = { calculateTotal };`
};

const REFACTOR_SAMPLES = {
  getDisplayName: {
    working: `export function getDisplayName(user) {
  if (!user) return 'Guest';
  if (typeof user === 'string') {
    const trimmed = user.trim();
    return trimmed || 'Guest';
  }
  if (typeof user === 'object') {
    const name = user.name?.trim?.() || user.username?.trim?.();
    if (name) return name;
  }
  return 'Guest';
}`,
    buggy: `export function getDisplayName(user) {
  // Bug: fails whitespace edge cases (returns empty string "" instead of "Guest")
  if (!user) return 'Guest';
  if (typeof user === 'string') {
    return user.trim(); // BUG: when user is "   ", returns "" instead of "Guest"!
  }
  if (typeof user === 'object' && user.name) {
    return user.name;
  }
  return 'Guest';
}`,
    brokenInterface: `// Bug: renamed public export from getDisplayName to formatUserName
export function formatUserName(user) {
  return user?.name || 'Guest';
}`
  },
  userPanel: {
    working: `export default function UserPanel(props) {
  if (!props?.visible) return null;
  const user = props.user;
  const name = typeof user === 'string' ? user.trim() : user?.name?.trim?.();
  return (
    <div className="user-panel">
      <h3>{name || 'Guest'}</h3>
    </div>
  );
}`,
    buggy: `export default function UserPanel(props) {
  // Bug: ignores 'visible: false' prop and renders anyway!
  const name = typeof props?.user === 'string' ? props.user : props?.user?.name;
  return (
    <div className="user-panel">
      <h3>{name || 'Guest'}</h3>
    </div>
  );
}`,
    brokenInterface: `// Bug: dropped default export
export function DifferentPanel(props) {
  return <div>{props?.user}</div>;
}`
  }
};

interface SourceCodeError {
  type: 'SYNTAX_ERROR' | 'LOAD_ERROR';
  message: string;
  line?: number;
  column?: number;
}

export default function App() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [originalCode, setOriginalCode] = useState<string>('');
  const [strategy, setStrategy] = useState<'basic' | 'structured' | 'test_aware'>('basic');
  const [strategyLocked, setStrategyLocked] = useState<boolean>(false);
  const [lockedOriginalCode, setLockedOriginalCode] = useState<string>('');

  const [generatedTests, setGeneratedTests] = useState<GeneratedTestsState>({
    hasGenerated: false,
    seed: 42,
    inputCount: 0,
    testFileCode: '',
    comparable: true,
    totalTests: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    groups: {
      normal: { category: 'Normal', total: 0, passed: 0, failed: 0, skipped: 0, tests: [] },
      edgeCases: { category: 'Edge cases', total: 0, passed: 0, failed: 0, skipped: 0, tests: [] },
      invalid: { category: 'Invalid', total: 0, passed: 0, failed: 0, skipped: 0, tests: [] },
    },
    coverage: { linesPct: 'Unavailable', branchesPct: 'Unavailable', statementsPct: 'Unavailable', functionsPct: 'Unavailable' },
    errors: [],
    history: [],
    timestamp: null,
  });

  const [models, setModels] = useState<ExperimentState['models']>({
    chatgpt: { status: 'not_run', code: '', responseTime: '', prompt: '', result: null, history: [] },
    claude: { status: 'not_run', code: '', responseTime: '', prompt: '', result: null, history: [] },
    gemini: { status: 'not_run', code: '', responseTime: '', prompt: '', result: null, history: [] },
  });

  const [agreement, setAgreement] = useState<Record<string, AgreementPair>>({});

  // Loading & Progress
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgressText, setAnalysisProgressText] = useState('Analyzing code...');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [sourceError, setSourceError] = useState<SourceCodeError | null>(null);

  // Screen 2 filter states
  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [activeTestTab, setActiveTestTab] = useState<'all' | 'normal' | 'edgeCases' | 'invalid'>('all');

  // Active Model Pipeline
  const [activeTestingModel, setActiveTestingModel] = useState<string | null>(null);
  const [pipelineProgressText, setPipelineProgressText] = useState('');

  // UI state
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState<Record<string, boolean>>({});
  const [activePairDiff, setActivePairDiff] = useState<{ pairKey: string; diff: any[] } | null>(null);

  // 1. Initial State Fetch
  useEffect(() => {
    fetchState();
  }, []);

  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        if (data.state) {
          applyState(data.state);
        }
      }
    } catch {
      const localStep = localStorage.getItem('refactorlab_step');
      if (localStep) {
        setStep(parseInt(localStep, 10) as 1 | 2 | 3 | 4);
      }
    }
  };

  const applyState = (st: ExperimentState) => {
    setOriginalCode(st.originalCode || '');
    setLockedOriginalCode(st.lockedOriginalCode || '');
    if (st.generatedTests) {
      setGeneratedTests(st.generatedTests);
    }
    setStrategy(st.strategy || 'basic');
    setStrategyLocked(st.strategyLocked || false);
    if (st.models) {
      setModels(st.models);
    }
    if (st.agreement) {
      setAgreement(st.agreement);
    }

    const savedStep = localStorage.getItem('refactorlab_step');
    if (savedStep && ['1', '2', '3', '4'].includes(savedStep)) {
      setStep(parseInt(savedStep, 10) as 1 | 2 | 3 | 4);
    } else if (st.step) {
      setStep(st.step);
    }
  };

  const navigateToStep = (newStep: 1 | 2 | 3 | 4) => {
    setStep(newStep);
    localStorage.setItem('refactorlab_step', String(newStep));
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: newStep }),
    }).catch(() => {});
  };

  // Screen 1: Continue button -> POST /api/analyze
  const handleContinueFromScreen1 = async () => {
    if (!originalCode.trim()) return;
    setIsAnalyzing(true);
    setSourceError(null);
    setAnalysisProgressText('Analyzing code...');

    try {
      setTimeout(() => setAnalysisProgressText('Generating tests (Normal, Edge cases, Invalid)...'), 400);
      setTimeout(() => setAnalysisProgressText('Running tests on original & measuring coverage...'), 1200);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: originalCode }),
      });

      const data = await res.json();
      if (!data.success) {
        setSourceError({
          type: data.errorType || 'LOAD_ERROR',
          message: data.error || 'Failed to process code.',
          line: data.line,
          column: data.column,
        });
      } else {
        setSourceError(null);
        applyState(data.state);
        navigateToStep(2);
      }
    } catch (err: any) {
      setSourceError({
        type: 'LOAD_ERROR',
        message: `Could not load code: ${err.message}`,
      });
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgressText('Analyzing code...');
    }
  };

  // Screen 2: Regenerate button -> POST /api/regenerate
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch('/api/regenerate', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.state) {
        applyState(data.state);
      }
    } catch (err: any) {
      alert(`Regeneration failed: ${err.message}`);
    } finally {
      setIsRegenerating(false);
    }
  };

  // Strategy Selection
  const handleSelectStrategy = (strat: 'basic' | 'structured' | 'test_aware') => {
    if (strategyLocked) return;
    setStrategy(strat);
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: strat }),
    }).catch(() => {});
  };

  // Generated prompt
  const generatedPrompt = `${STRATEGY_TEXTS[strategy]}

Return the COMPLETE refactored code. Do not omit, shorten, or summarize any part. Do not use placeholders like '// rest unchanged'. Keep all exported names, function signatures, props, and imports working exactly as before. Do not add new features or remove existing ones. Return only code.

${lockedOriginalCode || originalCode}`;

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    }
  };

  // Model Code & Time handlers
  const handleModelCodeChange = (modelKey: 'chatgpt' | 'claude' | 'gemini', val: string) => {
    setModels((prev) => ({
      ...prev,
      [modelKey]: { ...prev[modelKey], code: val },
    }));
  };

  const handleModelTimeChange = (modelKey: 'chatgpt' | 'claude' | 'gemini', val: string) => {
    setModels((prev) => ({
      ...prev,
      [modelKey]: { ...prev[modelKey], responseTime: val },
    }));
  };

  // Screen 3: Save & Test for one model
  const handleSaveAndTest = async (modelKey: 'chatgpt' | 'claude' | 'gemini') => {
    const entry = models[modelKey];
    if (!entry.code.trim()) return;

    setActiveTestingModel(modelKey);
    setPipelineProgressText('Saving prompt & AI response...');

    try {
      setTimeout(() => setPipelineProgressText('Running safety checks (parse, placeholders, exports)...'), 400);
      setTimeout(() => setPipelineProgressText('Running validated Jest suite on refactored code...'), 1200);
      setTimeout(() => setPipelineProgressText('Running ESLint on original & refactored...'), 2000);
      setTimeout(() => setPipelineProgressText('Calculating metrics & model agreement...'), 2800);

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelKey,
          code: entry.code,
          responseTime: entry.responseTime,
          prompt: generatedPrompt,
          strategy,
        }),
      });

      const data = await res.json();
      if (data.success && data.state) {
        applyState(data.state);
        setStrategyLocked(true);
      } else {
        alert(`Test execution failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error running pipeline: ${err.message}`);
    } finally {
      setActiveTestingModel(null);
      setPipelineProgressText('');
    }
  };

  // Start Over
  const handleConfirmStartOver = async () => {
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        applyState(data.state);
        localStorage.removeItem('refactorlab_step');
        setStep(1);
      }
    } catch (err) {
      console.error('Failed to reset', err);
    } finally {
      setShowConfirmReset(false);
    }
  };

  const handleExportCSV = () => {
    window.location.href = '/api/export/csv';
  };

  const handleExportJSON = () => {
    window.location.href = '/api/export/json';
  };

  // Best model logic
  const computeBestModel = () => {
    const keys: Array<'chatgpt' | 'claude' | 'gemini'> = ['chatgpt', 'claude', 'gemini'];
    const names = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };

    const missing = keys.filter((k) => !models[k] || models[k].status === 'not_run' || !models[k].result);
    if (missing.length > 0) {
      return {
        hasWinner: false,
        text: `No clear winner yet. (${missing.map((m) => names[m]).join(' and ')} not run yet)`,
      };
    }

    const passing = keys
      .map((k) => {
        const res = models[k].result!;
        return {
          key: k,
          name: names[k],
          passed: res.status === 'PASS',
          interfaceSame: res.publicInterface === 'Same',
          valid: res.isResponseValid !== false,
          eslintErrors: res.eslintErrors ?? 999,
          maintainability:
            typeof res.metrics.maintainability === 'number'
              ? (res.metrics.maintainability as number)
              : -999,
        };
      })
      .filter((m) => m.passed && m.interfaceSame && m.valid);

    if (passing.length === 0) {
      return {
        hasWinner: false,
        text: 'No clear winner yet. (No model passed all validated tests with an unchanged public interface)',
      };
    }

    if (passing.length === 1) {
      return {
        hasWinner: true,
        text: `Best model: ${passing[0].name} (Passed all validated tests with unchanged public interface)`,
      };
    }

    // Dominance
    const bestCandidates = passing.filter((candidate) =>
      passing.every(
        (other) =>
          candidate.key === other.key ||
          (candidate.eslintErrors <= other.eslintErrors && candidate.maintainability >= other.maintainability)
      )
    );

    if (bestCandidates.length === 1) {
      const winner = bestCandidates[0];
      const strictlyBetter = passing.some(
        (o) =>
          o.key !== winner.key &&
          (winner.eslintErrors < o.eslintErrors || winner.maintainability > o.maintainability)
      );
      if (strictlyBetter) {
        return {
          hasWinner: true,
          text: `Best model: ${winner.name} (Unchanged interface, fewest ESLint errors, and highest maintainability)`,
        };
      }
    }

    return {
      hasWinner: false,
      text: 'No clear winner yet. (Models tied or comparable with trade-offs)',
    };
  };

  const bestModelInfo = computeBestModel();

  const getLineCount = (code: string) => {
    if (!code) return 0;
    return code.split(/\r?\n/).length;
  };

  const hasLowCoverage =
    generatedTests.hasGenerated &&
    ((typeof generatedTests.coverage?.linesPct === 'number' && generatedTests.coverage.linesPct < 80) ||
      (typeof generatedTests.coverage?.branchesPct === 'number' && generatedTests.coverage.branchesPct < 80));

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
      {/* TOP BAR */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xl shadow-xs">
            R
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">RefactorLab</h1>
          </div>
        </div>

        {/* Start Over Button */}
        <button
          onClick={() => setShowConfirmReset(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Start Over
        </button>
      </header>

      {/* CONFIRM START OVER MODAL */}
      {showConfirmReset && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-xl font-bold">Start Over?</h3>
            </div>
            <p className="text-slate-600 mb-6 leading-relaxed">
              Are you sure? This will clear all code, generated tests, and model evaluation results.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmReset(false)}
                className="px-5 py-2.5 text-slate-700 font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl text-base"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmStartOver}
                className="px-5 py-2.5 text-white font-semibold bg-rose-600 hover:bg-rose-700 rounded-xl text-base shadow-xs"
              >
                Yes, Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAIR DIFF MODAL */}
      {activePairDiff && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 md:p-6">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-bold text-slate-900">
                  Model Diff: {activePairDiff.pairKey.replace('_', ' vs ').toUpperCase()}
                </h3>
              </div>
              <button
                onClick={() => setActivePairDiff(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 font-mono text-xs bg-slate-900 text-slate-100 space-y-0.5">
              {activePairDiff.diff.map((chunk, idx) => {
                if (chunk.added) {
                  return (
                    <div key={idx} className="bg-emerald-950/80 text-emerald-300 px-2 py-0.5 border-l-4 border-emerald-500 whitespace-pre-wrap">
                      {chunk.value}
                    </div>
                  );
                }
                if (chunk.removed) {
                  return (
                    <div key={idx} className="bg-rose-950/80 text-rose-300 px-2 py-0.5 border-l-4 border-rose-500 whitespace-pre-wrap line-through opacity-80">
                      {chunk.value}
                    </div>
                  );
                }
                return (
                  <div key={idx} className="text-slate-400 px-2 py-0.5 whitespace-pre-wrap">
                    {chunk.value}
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setActivePairDiff(null)}
                className="px-4 py-1.5 bg-slate-800 text-white rounded-lg font-bold text-xs hover:bg-slate-900"
              >
                Close Diff
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SIMPLE PROGRESS LINE (1 Source Code, 2 Tests, 3 Refactoring, 4 Results) */}
      <div className="bg-white border-b border-slate-200 py-3 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-base font-semibold">
          {[
            { num: 1, label: 'Source Code' },
            { num: 2, label: 'Tests' },
            { num: 3, label: 'Refactoring' },
            { num: 4, label: 'Results' },
          ].map((item, idx, arr) => {
            const isCurrent = step === item.num;
            const isPast = step > item.num;
            return (
              <React.Fragment key={item.num}>
                <div
                  onClick={() => {
                    if (isPast || isCurrent) navigateToStep(item.num as any);
                  }}
                  className={`flex items-center gap-2 ${
                    isPast || isCurrent ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                  } ${isCurrent ? 'text-blue-600 font-bold' : isPast ? 'text-emerald-700' : 'text-slate-400'}`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${
                      isCurrent
                        ? 'bg-blue-600 text-white'
                        : isPast
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {item.num}
                  </span>
                  <span>{item.label}</span>
                </div>
                {idx < arr.length - 1 && (
                  <div className="h-0.5 flex-1 mx-3 bg-slate-200">
                    <div
                      className={`h-full bg-blue-600 transition-all duration-300 ${
                        step > item.num ? 'w-full' : 'w-0'
                      }`}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* MAIN VIEWPORT - ONLY ONE SCREEN AT A TIME */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-8 flex flex-col justify-start">
        {/* ========================================================= */}
        {/* SCREEN 1: SOURCE CODE */}
        {/* ========================================================= */}
        {step === 1 && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Source Code</h2>
                <p className="text-base text-slate-500 mt-1">
                  Enter your JavaScript function or React component. RefactorLab will automatically analyze it and generate test cases.
                </p>
              </div>

              {!lockedOriginalCode && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalCode(SAMPLE_CODE_OPTIONS.displayName);
                      setSourceError(null);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition-colors flex items-center gap-1.5"
                  >
                    <FileCode className="w-3.5 h-3.5 text-blue-600" />
                    Load export function
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalCode(SAMPLE_CODE_OPTIONS.userPanel);
                      setSourceError(null);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition-colors flex items-center gap-1.5"
                  >
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    Load React JSX (export default)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalCode(SAMPLE_CODE_OPTIONS.throwsOnNull);
                      setSourceError(null);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition-colors flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    Load Throws on Null
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalCode(SAMPLE_CODE_OPTIONS.commonJS);
                      setSourceError(null);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition-colors flex items-center gap-1.5"
                  >
                    <Code2 className="w-3.5 h-3.5 text-emerald-600" />
                    Load CommonJS
                  </button>
                </div>
              )}
            </div>

            {/* Error Alert: Differentiate SYNTAX ERROR vs LOAD ERROR */}
            {sourceError && (
              <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-xl text-rose-900 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-lg text-rose-700">
                    <XCircle className="w-6 h-6 flex-shrink-0" />
                    <span>
                      {sourceError.type === 'SYNTAX_ERROR' ? 'Syntax Error in Original Code' : 'Could not load code'}
                    </span>
                  </div>
                  {sourceError.line !== undefined && (
                    <span className="text-xs font-mono font-bold px-2.5 py-1 bg-rose-200 text-rose-900 rounded-lg">
                      Line {sourceError.line}, Column {sourceError.column}
                    </span>
                  )}
                </div>
                <pre className="text-xs font-mono bg-rose-100/70 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-48 border border-rose-200">
                  {sourceError.message}
                </pre>
              </div>
            )}

            {/* Locked notice */}
            {lockedOriginalCode && (
              <div className="p-3 bg-slate-100 border border-slate-300 rounded-xl text-slate-800 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-slate-600" />
                  <span>
                    <strong>Original code snapshot locked.</strong> To edit the code, click <strong>Start Over</strong>.
                  </span>
                </div>
                <button
                  onClick={() => navigateToStep(2)}
                  className="font-bold underline text-blue-700 hover:text-blue-900"
                >
                  Go to Tests &rarr;
                </button>
              </div>
            )}

            {/* Monospace scrollable box with line counter */}
            <div className="flex flex-col space-y-1">
              <label className="text-lg font-bold text-slate-900 flex items-center justify-between">
                <span>Original Code</span>
                <span className="text-xs font-normal text-slate-500">JavaScript / React JSX</span>
              </label>
              <textarea
                value={originalCode}
                onChange={(e) => {
                  setOriginalCode(e.target.value);
                  if (sourceError) setSourceError(null);
                }}
                disabled={Boolean(lockedOriginalCode)}
                placeholder="// Paste or write your JavaScript function or React component here..."
                className={`w-full h-96 font-mono text-sm p-4 bg-white rounded-xl border-2 transition-all resize-y overflow-y-auto ${
                  lockedOriginalCode
                    ? 'bg-slate-100 border-slate-300 cursor-not-allowed text-slate-700'
                    : 'border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100'
                }`}
              />
              <div className="flex items-center justify-between text-xs text-slate-500 px-1 pt-1 font-mono">
                <span>Line count: {getLineCount(originalCode)} lines</span>
                <span>{originalCode.length} characters</span>
              </div>
            </div>

            {/* CONTINUE BUTTON */}
            <div className="pt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={handleContinueFromScreen1}
                disabled={!originalCode.trim() || isAnalyzing}
                className={`px-8 py-4 rounded-xl text-lg font-bold text-white flex items-center gap-3 shadow-md transition-all ${
                  !originalCode.trim() || isAnalyzing
                    ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-98'
                }`}
              >
                {isAnalyzing ? (
                  <>
                    <span className="inline-block w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin" />
                    {analysisProgressText}
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN 2: TESTS (Automatic validation before refactoring) */}
        {/* ========================================================= */}
        {step === 2 && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Validated Tests (Baseline)</h2>
                <p className="text-base text-slate-500 mt-1">
                  100% of generated tests match your original code's behavior. Click <strong>Continue to Refactoring</strong> to proceed.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateToStep(1)}
                  className="px-4 py-2.5 text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-300 font-semibold text-sm flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>

                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="px-4 py-2.5 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl border border-blue-200 font-semibold text-sm flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                  Regenerate Seed ({generatedTests.seed})
                </button>
              </div>
            </div>

            {/* EDUCATIONAL CARD: Why do all tests pass here? */}
            <div className="p-5 bg-gradient-to-r from-blue-50 via-slate-50 to-indigo-50 border-2 border-blue-200 rounded-2xl text-slate-800 space-y-2.5 shadow-xs">
              <div className="flex items-center gap-2.5 text-blue-800 font-bold text-base">
                <HelpCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <span>Why did all {generatedTests.totalTests} tests succeed on this screen?</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                These are <strong>characterization tests</strong> recorded directly from your original code across <strong>Normal</strong>, <strong>Edge cases</strong>, and <strong>Invalid</strong> inputs. Because they record what your original code currently does (including how it handles errors), the baseline run against your original code passes 100%.
              </p>
              <div className="pt-1 flex items-center gap-2 text-xs font-semibold text-blue-700">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>In <strong>Step 3 (Refactoring)</strong>, you test AI rewrites against these exact tests: any change in behavior or bug will <strong>FAIL</strong>!</span>
              </div>
            </div>

            {/* Non-deterministic notice if applicable */}
            {!generatedTests.comparable && (
              <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <span>Not comparable: {generatedTests.notComparableReason || 'Contains non-deterministic calls'}</span>
                </div>
                <p className="text-xs text-amber-800">
                  Exports using non-deterministic APIs (Math.random, Date.now, timers, fetch) are skipped and will not yield PASS.
                </p>
              </div>
            )}

            {/* 3 HIGH-IMPACT METRICS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Card 1: Total Tests */}
              <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <span>Generated Test Suite</span>
                    <FileCode className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-slate-900">{generatedTests.totalTests}</span>
                    <span className="text-sm font-semibold text-slate-500">tests generated</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5 text-xs">
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-semibold rounded-md border border-blue-200">
                    {generatedTests.groups?.normal?.total || 0} Normal
                  </span>
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 font-semibold rounded-md border border-amber-200">
                    {generatedTests.groups?.edgeCases?.total || 0} Edge cases
                  </span>
                  <span className="px-2 py-0.5 bg-purple-50 text-purple-700 font-semibold rounded-md border border-purple-200">
                    {generatedTests.groups?.invalid?.total || 0} Invalid
                  </span>
                </div>
              </div>

              {/* Card 2: Baseline Result */}
              <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <span>Baseline Validation</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-emerald-700">100%</span>
                    <span className="text-sm font-semibold text-emerald-800">
                      ({generatedTests.passedCount} / {generatedTests.totalTests} passed)
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Tested twice in Jest to eliminate flakiness</span>
                </div>
              </div>

              {/* Card 3: Code Coverage */}
              <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <span>Code Coverage</span>
                    <span className="text-xs font-extrabold text-slate-700">
                      {generatedTests.coverage?.linesPct !== 'Unavailable' ? `${generatedTests.coverage.linesPct}%` : 'Unavailable'} Lines
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-xl font-extrabold text-slate-900">
                      {generatedTests.coverage?.branchesPct !== 'Unavailable' ? `${generatedTests.coverage.branchesPct}% Branches` : 'Unavailable'}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {generatedTests.coverage?.statementsPct !== 'Unavailable' ? `${generatedTests.coverage.statementsPct}% Stmts` : ''}
                    </span>
                  </div>
                </div>

                {/* Coverage Visual Bar */}
                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        hasLowCoverage ? 'bg-amber-500' : 'bg-emerald-600'
                      }`}
                      style={{
                        width: `${
                          typeof generatedTests.coverage?.linesPct === 'number'
                            ? generatedTests.coverage.linesPct
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  {hasLowCoverage ? (
                    <p className="text-2xs text-amber-700 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-500" />
                      Low coverage (&lt;80%). Add more branches or edge cases.
                    </p>
                  ) : (
                    <p className="text-2xs text-emerald-700 font-medium">
                      High coverage: thoroughly tests branches and paths.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* INTERACTIVE TEST CASES EXPLORER */}
            <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                    <span>Test Cases Explorer</span>
                    <span className="px-2.5 py-0.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-full">
                      {generatedTests.totalTests} total
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Inspect the exact inputs generated and the baseline output recorded from your original code.
                  </p>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                  {(['all', 'normal', 'edgeCases', 'invalid'] as const).map((tabKey) => {
                    const isTabActive = activeTestTab === tabKey;
                    const count =
                      tabKey === 'all'
                        ? generatedTests.totalTests
                        : tabKey === 'normal'
                        ? generatedTests.groups?.normal?.total || 0
                        : tabKey === 'edgeCases'
                        ? generatedTests.groups?.edgeCases?.total || 0
                        : generatedTests.groups?.invalid?.total || 0;

                    const label =
                      tabKey === 'all'
                        ? 'All'
                        : tabKey === 'normal'
                        ? 'Normal'
                        : tabKey === 'edgeCases'
                        ? 'Edge cases'
                        : 'Invalid';

                    return (
                      <button
                        key={tabKey}
                        type="button"
                        onClick={() => setActiveTestTab(tabKey)}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                          isTabActive
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={testSearchQuery}
                  onChange={(e) => setTestSearchQuery(e.target.value)}
                  placeholder="Filter test cases by input (e.g. null, user, string, empty)..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>

              {/* Test Items Grid / List */}
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
                {(() => {
                  let allTestsList: TestItem[] = [];
                  if (activeTestTab === 'all') {
                    allTestsList = [
                      ...(generatedTests.groups?.normal?.tests || []),
                      ...(generatedTests.groups?.edgeCases?.tests || []),
                      ...(generatedTests.groups?.invalid?.tests || []),
                    ];
                  } else if (activeTestTab === 'normal') {
                    allTestsList = generatedTests.groups?.normal?.tests || [];
                  } else if (activeTestTab === 'edgeCases') {
                    allTestsList = generatedTests.groups?.edgeCases?.tests || [];
                  } else {
                    allTestsList = generatedTests.groups?.invalid?.tests || [];
                  }

                  const filtered = testSearchQuery.trim()
                    ? allTestsList.filter(
                        (t) =>
                          t.name.toLowerCase().includes(testSearchQuery.toLowerCase()) ||
                          t.inputDesc.toLowerCase().includes(testSearchQuery.toLowerCase()) ||
                          (t.expectedOutcome &&
                            t.expectedOutcome.toLowerCase().includes(testSearchQuery.toLowerCase()))
                      )
                    : allTestsList;

                  if (filtered.length === 0) {
                    return (
                      <div className="p-8 text-center text-slate-400 text-xs">
                        No test cases matched your filter.
                      </div>
                    );
                  }

                  return filtered.map((t, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-blue-300 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span
                          className={`px-2 py-0.5 text-2xs font-extrabold rounded-md flex-shrink-0 ${
                            t.category === 'Normal'
                              ? 'bg-blue-100 text-blue-800'
                              : t.category === 'Edge cases'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {t.category}
                        </span>
                        <span className="font-bold text-slate-800 truncate">{t.name}</span>
                      </div>

                      <div className="flex items-center gap-2 overflow-hidden text-2xs">
                        <span className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-600 truncate max-w-xs">
                          Input: <code>{t.inputDesc}</code>
                        </span>
                        {t.expectedOutcome && (
                          <span className="px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold rounded-md truncate max-w-xs">
                            {t.expectedOutcome}
                          </span>
                        )}
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-md flex items-center gap-1 flex-shrink-0">
                          <Check className="w-3 h-3" /> PASS
                        </span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* BOTTOM ACTIONS: Continue button is ALWAYS enabled on Screen 2 */}
            <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigateToStep(1)}
                className="px-6 py-3.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-300 transition-colors flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Source Code
              </button>

              <button
                type="button"
                onClick={() => navigateToStep(3)}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-extrabold rounded-xl shadow-lg transition-all flex items-center gap-3 text-lg cursor-pointer"
              >
                Continue to Refactoring
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN 3: REFACTORING */}
        {/* ========================================================= */}
        {step === 3 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Refactoring</h2>
                <p className="text-base text-slate-500 mt-1">
                  Choose a strategy, copy the prompt to ChatGPT, Claude, and Gemini, and paste each response.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateToStep(2)}
                  className="px-4 py-2.5 text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-300 font-semibold text-sm flex items-center gap-2 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>

                <button
                  type="button"
                  onClick={() => navigateToStep(4)}
                  className="px-5 py-2.5 text-white bg-slate-800 hover:bg-slate-900 rounded-xl font-bold text-sm flex items-center gap-2 shadow-xs transition-colors"
                >
                  See Results
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Prompt strategy choice */}
            <div className="bg-white p-6 rounded-2xl border-2 border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-900">Prompt Strategy</h3>
                {strategyLocked ? (
                  <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold text-xs rounded-full border border-amber-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Strategy locked (same for all models)
                  </span>
                ) : (
                  <span className="text-xs text-slate-500 font-medium">Select one strategy for all models</span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['basic', 'structured', 'test_aware'] as const).map((stratKey) => {
                  const isSelected = strategy === stratKey;
                  return (
                    <button
                      key={stratKey}
                      type="button"
                      disabled={strategyLocked}
                      onClick={() => handleSelectStrategy(stratKey)}
                      className={`p-4 rounded-xl text-left border-2 transition-all flex flex-col justify-between ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${strategyLocked && !isSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`font-bold text-base ${isSelected ? 'text-blue-700' : 'text-slate-900'}`}>
                            {STRATEGY_LABELS[stratKey]}
                          </span>
                          {isSelected && <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{STRATEGY_TEXTS[stratKey]}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Read-only Prompt Box */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">Generated Prompt (Read-only)</label>
                  <button
                    type="button"
                    onClick={handleCopyPrompt}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-xs"
                  >
                    {copiedPrompt ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-300" />
                        Copied to Clipboard!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy Prompt
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={generatedPrompt}
                  className="w-full h-36 p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-xl text-slate-800 resize-none cursor-default select-all"
                />
              </div>

              {/* External Links */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Open AI Models:</span>
                <a
                  href="https://chatgpt.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
                >
                  ChatGPT <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://claude.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
                >
                  Claude <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://gemini.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
                >
                  Gemini <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* PRESET SAMPLES: Test how code passes, fails, or violates interface */}
            <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 p-5 rounded-2xl border-2 border-blue-200/80 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-blue-600" />
                    <span>Try Sample Refactorings (Verify Passing vs Failing Tests)</span>
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Click a preset below to populate an AI box, then click <strong>Save & Test</strong> to see RefactorLab validate behavior or catch bugs:
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const isComp = (lockedOriginalCode || originalCode).includes('UserPanel');
                    const sample = isComp ? REFACTOR_SAMPLES.userPanel.working : REFACTOR_SAMPLES.getDisplayName.working;
                    handleModelCodeChange('chatgpt', sample);
                  }}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                  Load Working Refactor &rarr; ChatGPT (Passes 100%)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const isComp = (lockedOriginalCode || originalCode).includes('UserPanel');
                    const sample = isComp ? REFACTOR_SAMPLES.userPanel.buggy : REFACTOR_SAMPLES.getDisplayName.buggy;
                    handleModelCodeChange('claude', sample);
                  }}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Bug className="w-4 h-4 text-rose-200" />
                  Load Buggy Refactor &rarr; Claude (Fails Edge Cases)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const isComp = (lockedOriginalCode || originalCode).includes('UserPanel');
                    const sample = isComp ? REFACTOR_SAMPLES.userPanel.brokenInterface : REFACTOR_SAMPLES.getDisplayName.brokenInterface;
                    handleModelCodeChange('gemini', sample);
                  }}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 active:scale-98 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4 text-purple-200" />
                  Load Broken Interface &rarr; Gemini (Safety Check Violation)
                </button>
              </div>
            </div>

            {/* THREE MODEL SECTIONS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(['chatgpt', 'claude', 'gemini'] as const).map((modelKey) => {
                const entry = models[modelKey];
                const displayName = modelKey === 'chatgpt' ? 'ChatGPT' : modelKey === 'claude' ? 'Claude' : 'Gemini';
                const isCurrentTesting = activeTestingModel === modelKey;

                let statusBadge = (
                  <span className="px-3 py-1 text-xs font-bold bg-slate-100 text-slate-600 rounded-full border border-slate-200">
                    Not run yet
                  </span>
                );

                if (isCurrentTesting) {
                  statusBadge = (
                    <span className="px-3 py-1 text-xs font-bold bg-amber-100 text-amber-800 rounded-full border border-amber-300 animate-pulse">
                      Testing...
                    </span>
                  );
                } else if (entry.status === 'PASS') {
                  statusBadge = (
                    <span className="px-3 py-1 text-xs font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> PASS
                    </span>
                  );
                } else if (entry.status === 'FAIL') {
                  statusBadge = (
                    <span className="px-3 py-1 text-xs font-bold bg-rose-100 text-rose-800 rounded-full border border-rose-300 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> FAIL
                    </span>
                  );
                } else if (entry.status === 'INVALID RESPONSE') {
                  statusBadge = (
                    <span className="px-3 py-1 text-xs font-bold bg-purple-100 text-purple-800 rounded-full border border-purple-300 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> INVALID RESPONSE
                    </span>
                  );
                } else if (entry.status === 'ERROR') {
                  statusBadge = (
                    <span className="px-3 py-1 text-xs font-bold bg-red-100 text-red-800 rounded-full border border-red-300 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> ERROR
                    </span>
                  );
                }

                return (
                  <div
                    key={modelKey}
                    className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div>
                          <h4 className="text-lg font-extrabold text-slate-900">{displayName}</h4>
                          {entry.history && entry.history.length > 0 && (
                            <p className="text-xs text-slate-500 font-medium">
                              Run #{entry.history.length + 1} ({entry.history.length} in history)
                            </p>
                          )}
                        </div>
                        {statusBadge}
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">Paste AI code here</label>
                        <textarea
                          value={entry.code}
                          onChange={(e) => handleModelCodeChange(modelKey, e.target.value)}
                          disabled={isCurrentTesting}
                          placeholder={`Paste ${displayName} refactored code...`}
                          className="w-full h-64 font-mono text-xs p-3 bg-white border border-slate-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-y overflow-y-auto"
                        />
                        <div className="text-2xs text-slate-500 px-1 font-mono">
                          Line count: {getLineCount(entry.code)} lines
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Response time (seconds, optional)</label>
                        <input
                          type="text"
                          value={entry.responseTime}
                          onChange={(e) => handleModelTimeChange(modelKey, e.target.value)}
                          disabled={isCurrentTesting}
                          placeholder="e.g. 2.5"
                          className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </div>

                      {isCurrentTesting && (
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-900 space-y-2">
                          <div className="flex items-center gap-2 font-bold">
                            <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            Running pipeline...
                          </div>
                          <p className="font-mono text-blue-700">{pipelineProgressText}</p>
                        </div>
                      )}

                      {entry.result && !isCurrentTesting && (
                        <div
                          className={`p-3 rounded-xl border text-xs space-y-1 ${
                            entry.result.status === 'PASS'
                              ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                              : 'bg-rose-50/60 border-rose-200 text-rose-900'
                          }`}
                        >
                          <div className="flex items-center justify-between font-bold">
                            <span>Pass Rate: {entry.result.passRate}</span>
                            <span>{entry.result.publicInterface}</span>
                          </div>
                          <p className="text-2xs text-slate-600 truncate">{entry.result.behaviourPreserved}</p>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveAndTest(modelKey)}
                      disabled={!entry.code.trim() || Boolean(activeTestingModel)}
                      className={`w-full py-3 rounded-xl font-bold text-sm text-white shadow-xs transition-all flex items-center justify-center gap-2 ${
                        !entry.code.trim() || Boolean(activeTestingModel)
                          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 active:scale-98'
                      }`}
                    >
                      {isCurrentTesting ? 'Running Pipeline...' : 'Save & Test'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigateToStep(2)}
                className="px-6 py-3 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-300 transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Tests
              </button>

              <button
                type="button"
                onClick={() => navigateToStep(4)}
                className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl shadow-md transition-all flex items-center gap-2 active:scale-98"
              >
                See Results
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN 4: RESULTS */}
        {/* ========================================================= */}
        {step === 4 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Results</h2>
                <p className="text-base text-slate-500 mt-1">
                  Comprehensive benchmark comparison and model agreement analysis.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateToStep(3)}
                  className="px-4 py-2.5 text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-300 font-bold text-sm flex items-center gap-2 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Refactoring
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-xs transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>

                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm rounded-xl shadow-xs transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export JSON
                </button>
              </div>
            </div>

            {/* MAIN RESULTS TABLE */}
            <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-x-auto shadow-xs">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200">
                    <th className="py-4 px-6 text-sm font-bold text-slate-600 w-1/4 uppercase tracking-wider">
                      Metric
                    </th>
                    <th className="py-4 px-6 text-lg font-black text-slate-900 w-1/4">ChatGPT</th>
                    <th className="py-4 px-6 text-lg font-black text-slate-900 w-1/4">Claude</th>
                    <th className="py-4 px-6 text-lg font-black text-slate-900 w-1/4">Gemini</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm md:text-base">
                  {/* Row 1: Test Result & Pass Rate */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Test Result & Pass Rate</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) {
                        return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      }
                      return (
                        <td key={key} className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-1 text-xs font-extrabold rounded-full border ${
                              res.status === 'PASS'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : res.status === 'FAIL'
                                ? 'bg-rose-100 text-rose-800 border-rose-300'
                                : 'bg-red-100 text-red-800 border-red-300'
                            }`}>
                              {res.status}
                            </span>
                            <span className="font-semibold text-slate-700">{res.passRate}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 2: Behaviour Preservation */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Behaviour Preservation</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6 font-medium text-slate-800">
                          {res.status === 'PASS' && res.publicInterface === 'Same' && res.isResponseValid ? (
                            <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                              {res.behaviourPreserved}
                            </span>
                          ) : (
                            <span className="text-rose-700 font-bold flex items-center gap-1.5">
                              <XCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                              {res.behaviourPreserved}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 3: Public Interface */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Public Interface</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6">
                          {res.publicInterface === 'Same' ? (
                            <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                              <Check className="w-4 h-4 text-emerald-600" /> Same
                            </span>
                          ) : (
                            <div className="text-rose-700 font-bold">
                              <span>Changed</span>
                              <div className="text-xs font-normal text-rose-600 mt-0.5">{res.interfaceDetails}</div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 4: Response Valid */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Response Valid</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6">
                          {res.isResponseValid ? (
                            <span className="text-emerald-700 font-bold">Yes</span>
                          ) : (
                            <span className="text-rose-700 font-bold">
                              Invalid: {res.invalidReason || 'Error'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 5: ESLint Errors & Warnings */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">ESLint (Original vs Refactored)</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6">
                          <div className="font-semibold text-slate-800">
                            Orig: {res.eslintOriginalErrors} err, {res.eslintOriginalWarnings} warn
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            Refac: <span className={res.eslintErrors > 0 ? 'text-rose-600 font-bold' : 'text-emerald-700'}>{res.eslintErrors} err</span>, {res.eslintWarnings} warn ({res.eslintComparison})
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 6: Cyclomatic Complexity */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Cyclomatic Complexity</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6">
                          <div className="text-sm font-semibold text-slate-800">
                            {res.originalMetrics?.cyclomatic} &rarr; {res.metrics?.cyclomatic} ({res.complexityComparison})
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 7: Maintainability */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Maintainability</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      const orig = res.originalMetrics?.maintainability !== 'Unavailable' ? Math.round(res.originalMetrics?.maintainability as number) : 'Unavailable';
                      const refac = res.metrics?.maintainability !== 'Unavailable' ? Math.round(res.metrics?.maintainability as number) : 'Unavailable';
                      return (
                        <td key={key} className="py-4 px-6">
                          <div className="text-sm font-semibold text-slate-800">
                            {orig} &rarr; {refac} ({res.maintainabilityComparison})
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 8: Coverage of Refactored Code */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Coverage of Refactored Code</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6">
                          <div className="font-semibold text-slate-800">
                            Lines: {res.coverage?.linesPct !== 'Unavailable' ? `${res.coverage.linesPct}%` : 'Unavailable'}
                          </div>
                          <div className="text-xs text-slate-600">
                            Branches: {res.coverage?.branchesPct !== 'Unavailable' ? `${res.coverage.branchesPct}%` : 'Unavailable'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 9: Lines of Code */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Lines of Code</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const res = models[key].result;
                      if (!res) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6 font-medium text-slate-800">
                          {res.originalLineCount} &rarr; {res.refactoredLineCount}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row 10: Response Time */}
                  <tr className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">Response Time</td>
                    {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                      const m = models[key];
                      if (!m.result) return <td key={key} className="py-4 px-6 text-slate-400 font-medium">Not run yet</td>;
                      return (
                        <td key={key} className="py-4 px-6 font-medium text-slate-700">
                          {m.responseTime ? `${m.responseTime}s` : 'Not provided'}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* BEST MODEL LINE UNDER TABLE */}
            <div
              className={`p-6 rounded-2xl border-2 flex items-center justify-between shadow-xs ${
                bestModelInfo.hasWinner
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-slate-100/90 border-slate-300 text-slate-800'
              }`}
            >
              <div className="flex items-center gap-3">
                {bestModelInfo.hasWinner ? (
                  <Sparkles className="w-7 h-7 text-emerald-600 flex-shrink-0" />
                ) : (
                  <Info className="w-6 h-6 text-slate-500 flex-shrink-0" />
                )}
                <span className="text-xl font-bold tracking-tight">{bestModelInfo.text}</span>
              </div>
            </div>

            {/* SECTION: DO THE MODELS AGREE? (3x3 TABLE) */}
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-slate-900">Do the models agree?</h3>
              <p className="text-xs text-slate-500">
                Pairwise syntax comparison (Identical, Same after formatting, Different) and pass/fail consistency.
              </p>

              <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-x-auto shadow-xs">
                <table className="w-full text-center border-collapse min-w-[650px]">
                  <thead>
                    <tr className="bg-slate-100/80 border-b border-slate-200">
                      <th className="py-3 px-4 text-left font-bold text-slate-600">Model Pair</th>
                      <th className="py-3 px-4 font-black text-slate-900">ChatGPT</th>
                      <th className="py-3 px-4 font-black text-slate-900">Claude</th>
                      <th className="py-3 px-4 font-black text-slate-900">Gemini</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {(['chatgpt', 'claude', 'gemini'] as const).map((rowKey) => {
                      const rowName = rowKey === 'chatgpt' ? 'ChatGPT' : rowKey === 'claude' ? 'Claude' : 'Gemini';
                      return (
                        <tr key={rowKey} className="hover:bg-slate-50/50">
                          <td className="py-4 px-4 text-left font-bold text-slate-800 bg-slate-50/50">{rowName}</td>
                          {(['chatgpt', 'claude', 'gemini'] as const).map((colKey) => {
                            if (rowKey === colKey) {
                              return <td key={colKey} className="py-4 px-4 bg-slate-100/40 text-slate-300 font-bold">—</td>;
                            }
                            const pairKey = `${rowKey}_${colKey}`;
                            const pair = agreement[pairKey];
                            if (!pair || pair.status === 'Not run yet') {
                              return <td key={colKey} className="py-4 px-4 text-slate-400 font-medium">Not run yet</td>;
                            }

                            return (
                              <td key={colKey} className="py-4 px-4">
                                <div className="space-y-1">
                                  <span className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-md ${
                                    pair.status === 'Identical'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : pair.status === 'Same after formatting'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-slate-200 text-slate-800'
                                  }`}>
                                    {pair.status}
                                  </span>
                                  <div className="text-2xs text-slate-500">
                                    Same pass/fail: <strong className={pair.samePassFail === 'Yes' ? 'text-emerald-700' : 'text-rose-700'}>{pair.samePassFail}</strong>
                                  </div>
                                  {pair.diff && pair.diff.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setActivePairDiff({ pairKey, diff: pair.diff })}
                                      className="text-2xs text-blue-600 hover:text-blue-800 underline font-semibold flex items-center justify-center gap-1 mx-auto"
                                    >
                                      <GitCompare className="w-3 h-3" /> Show diff
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ERROR EXPANDER FOR FAILED RUNS */}
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-slate-900">Failure Diagnostics & Logs</h3>
              <div className="space-y-3">
                {(['chatgpt', 'claude', 'gemini'] as const).map((key) => {
                  const m = models[key];
                  const res = m.result;
                  const name = key === 'chatgpt' ? 'ChatGPT' : key === 'claude' ? 'Claude' : 'Gemini';
                  const isOpen = Boolean(showErrorDetails[key]);

                  if (!res) return null;

                  return (
                    <div key={key} className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-base text-slate-900">{name} Status:</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                            res.status === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {res.status}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowErrorDetails((prev) => ({ ...prev, [key]: !prev[key] }))}
                          className="text-xs font-bold text-blue-600 hover:text-blue-800 underline"
                        >
                          {isOpen ? 'Hide errors' : 'Show errors'}
                        </button>
                      </div>

                      {isOpen && (
                        <div className="pt-2 text-xs font-mono space-y-2">
                          {res.failingTests && res.failingTests.length > 0 ? (
                            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-2">
                              <div className="font-bold font-sans text-sm text-rose-800">
                                Failing Tests ({res.failingTests.length}):
                              </div>
                              {res.failingTests.map((ft, idx) => (
                                <div key={idx} className="border-t border-rose-200 pt-1">
                                  <div className="font-bold">{ft.title}</div>
                                  <pre className="text-2xs whitespace-pre-wrap mt-0.5">{ft.failureMessage}</pre>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-emerald-700 font-sans text-xs font-semibold">No failing test assertions.</div>
                          )}

                          {res.runnerError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900">
                              <div className="font-bold font-sans text-sm mb-1">Runner Error:</div>
                              <pre className="text-2xs whitespace-pre-wrap">{res.runnerError}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigateToStep(3)}
                className="px-6 py-3 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-300 transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Refactoring
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export JSON
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
