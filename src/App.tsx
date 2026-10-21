/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
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
  Layers,
  Code2,
  Search,
  Bug,
  Cpu,
  Play,
  Activity,
  FileUp,
  Sliders,
  CheckSquare,
  AlertCircle,
  X
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

interface FailureExplanation {
  testTitle: string;
  category: string;
  plainEnglishExplanation: string;
  expectedBehavior: string;
  actualBehavior: string;
  inputDescription?: string;
  interpretation: string;
  recommendedAction: string;
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
  failureExplanations?: FailureExplanation[];
}

interface ModelEntry {
  status: 'not_run' | 'testing' | 'PASS' | 'FAIL' | 'ERROR' | 'INVALID RESPONSE';
  code: string;
  responseTime: string;
  prompt: string;
  result: ModelResult | null;
  history: ModelResult[];
}

interface Mutant {
  id: string;
  description: string;
  mutatedCode: string;
  status: 'KILLED' | 'SURVIVED' | 'ERROR';
  detectedByTest?: string;
}

interface MutationTestResult {
  score: number | 'Unavailable';
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  sensitivity: 'Robust' | 'Moderate' | 'Weak' | 'Unavailable';
  mutants: Mutant[];
}

interface BehaviorDiffItem {
  id: string;
  inputDescription: string;
  originalResult: {
    status: 'RETURNED' | 'THREW' | 'TIMEOUT';
    value: any;
    type: string;
  };
  refactoredResult: {
    status: 'RETURNED' | 'THREW' | 'TIMEOUT';
    value: any;
    type: string;
  };
  isMatch: boolean;
  issueDescription?: string;
}

interface BehaviorComparisonResult {
  status: 'Equivalent' | 'Behavior changed' | 'Inconclusive';
  totalCases: number;
  matchedCases: number;
  deviatedCases: number;
  equivalencePercentage: string;
  differences: BehaviorDiffItem[];
  allComparisons: BehaviorDiffItem[];
  exportComparison: {
    originalExports: string[];
    refactoredExports: string[];
    missingInRefactored: string[];
    isCompatible: boolean;
  };
  summary: string;
}

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

  discountCommonJS: `function calculateDiscount(price, customerType) {
  if (price <= 0) return 0;
  if (customerType === 'VIP') return price * 0.8;
  if (customerType === 'REGULAR') return price * 0.95;
  return price;
}

module.exports = { calculateDiscount };`,

  brokenSyntax: `export function calculateTax(amount) {
  if (amount < 0) {
    return 0;
  // Missing closing brace causes syntax error
}`
};

const SAMPLE_REFACTORS = {
  optimal: `export function getDisplayName(user) {
  if (!user) return 'Guest';
  if (typeof user === 'string') {
    return user.trim() || 'Guest';
  }
  if (typeof user === 'object') {
    const candidate = user.name || user.username;
    if (typeof candidate === 'string') {
      return candidate.trim() || 'Guest';
    }
  }
  return 'Guest';
}`,

  bugFix: `export function getUserCity(user) {
  if (!user || !user.address) {
    return 'Unknown';
  }
  return user.address.city || 'Unknown';
}`,

  brokenInterface: `export function fetchDisplayName(user) { // Renamed export breaks public contract
  if (!user) return 'Guest';
  return typeof user === 'string' ? user.trim() || 'Guest' : 'Guest';
}`,

  brokenBehavior: `export function getDisplayName(user) {
  // Logic bug: returns empty string on whitespace instead of 'Guest'
  if (!user) return 'Guest';
  if (typeof user === 'string') return user.trim();
  return 'Guest';
}`
};

export default function App() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [originalCode, setOriginalCode] = useState<string>(SAMPLE_CODE_OPTIONS.displayName);
  const [lockedOriginalCode, setLockedOriginalCode] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'chatgpt' | 'claude' | 'manual'>('gemini');
  const [refactorMode, setRefactorMode] = useState<'preserve_behavior' | 'refactor_and_fix'>('preserve_behavior');
  const [promptText, setPromptText] = useState<string>('');

  // Analysis of code contract
  const [codeContract, setCodeContract] = useState<{
    targets: Array<{ name: string; isComponent: boolean; isDefault: boolean }>;
    metrics: { cyclomatic: any; maintainability: any; duplication: any };
    isNonDeterministic: boolean;
    nonDeterministicReason?: string;
  } | null>(null);

  // Screen 1 syntax check
  const [syntaxState, setSyntaxState] = useState<{
    isValid: boolean;
    errorType?: 'SYNTAX_ERROR' | 'LOAD_ERROR';
    errorMessage?: string;
    line?: number;
    column?: number;
  }>({ isValid: true });

  // Screen 3 AI refactored code
  const [refactoredCode, setRefactoredCode] = useState<string>('');
  const [isAILoading, setIsAILoading] = useState<boolean>(false);
  const [aiResponseTime, setAiResponseTime] = useState<number>(0);
  const [aiError, setAiError] = useState<string | null>(null);

  // Screen 4 Test Suite & Mutation
  const [generatedTests, setGeneratedTests] = useState<GeneratedTestsState | null>(null);
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [testExecutionResult, setTestExecutionResult] = useState<ModelResult | null>(null);
  const [mutationResult, setMutationResult] = useState<MutationTestResult | null>(null);
  const [isRunningMutation, setIsRunningMutation] = useState<boolean>(false);
  const [testFilter, setTestFilter] = useState<'all' | 'normal' | 'edgeCases' | 'invalid'>('all');
  const [testSearch, setTestSearch] = useState<string>('');

  // Screen 5 Behavioral Comparison
  const [behaviorResult, setBehaviorResult] = useState<BehaviorComparisonResult | null>(null);
  const [isComparingBehavior, setIsComparingBehavior] = useState<boolean>(false);

  // Global loading & modals
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);

  // Initialize and check syntax
  useEffect(() => {
    validateSyntax(originalCode);
    analyzeContract(originalCode);
  }, [originalCode]);

  // Initial prompt generation when entering step 2 or changing mode
  useEffect(() => {
    if (step >= 2) {
      generatePrompt(refactorMode);
    }
  }, [refactorMode, step]);

  const validateSyntax = (code: string) => {
    if (!code.trim()) {
      setSyntaxState({ isValid: false, errorMessage: 'Code cannot be empty.' });
      return;
    }
    // Basic client check
    try {
      // Simple parse check
      new Function(`return (${code})`);
      setSyntaxState({ isValid: true });
    } catch (e: any) {
      // If it has imports or exports, new Function fails naturally in browser
      if (/(?:export|import|module\.exports)/.test(code)) {
        setSyntaxState({ isValid: true });
      } else {
        setSyntaxState({ isValid: true }); // Server will do strict @babel/parser validation
      }
    }
  };

  const analyzeContract = async (code: string) => {
    try {
      const res = await fetch('/api/analyze-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        const data = await res.json();
        setCodeContract(data);
      }
    } catch {}
  };

  const generatePrompt = async (mode: 'preserve_behavior' | 'refactor_and_fix') => {
    try {
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: originalCode, mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setPromptText(data.prompt);
      }
    } catch {}
  };

  // Step 1 -> Step 2
  const handleProceedToPrompt = async () => {
    setIsAnalyzing(true);
    setSyntaxState({ isValid: true });

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: originalCode }),
      });
      const data = await res.json();

      if (!data.success) {
        setSyntaxState({
          isValid: false,
          errorType: data.errorType,
          errorMessage: data.error,
          line: data.line,
          column: data.column,
        });
        return;
      }

      setLockedOriginalCode(originalCode);
      if (data.testResults) {
        setGeneratedTests(data.testResults);
      }
      setStep(2);
    } catch (err: any) {
      setSyntaxState({
        isValid: false,
        errorType: 'LOAD_ERROR',
        errorMessage: err.message || 'Error parsing code.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Screen 3: Call AI Refactoring
  const handleRunAIRefactoring = async () => {
    setIsAILoading(true);
    setAiError(null);
    const start = Date.now();

    try {
      const res = await fetch('/api/ai/refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedModel === 'manual' ? 'gemini' : selectedModel,
          originalCode,
          prompt: promptText,
          mode: refactorMode,
        }),
      });
      const data = await res.json();

      if (data.success && data.code) {
        setRefactoredCode(data.code);
        setAiResponseTime(data.responseTimeSeconds || Math.round((Date.now() - start) / 100) / 10);
      } else {
        setAiError(data.error || 'Failed to generate refactored code.');
      }
    } catch (err: any) {
      setAiError(err.message || 'Network error calling AI service.');
    } finally {
      setIsAILoading(false);
    }
  };

  // Screen 4: Run Jest Test Execution
  const handleRunTests = async () => {
    if (!refactoredCode.trim()) return;
    setIsRunningTests(true);

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel === 'manual' ? 'gemini' : selectedModel,
          code: refactoredCode,
          responseTime: aiResponseTime,
          prompt: promptText,
          strategy: 'test_aware',
        }),
      });
      const data = await res.json();

      if (data.success && data.result) {
        setTestExecutionResult(data.result);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunningTests(false);
    }
  };

  // Screen 4: Run Mutation Sensitivity Test
  const handleRunMutationTest = async () => {
    setIsRunningMutation(true);
    try {
      const res = await fetch('/api/run-mutation-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: originalCode,
        }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setMutationResult(data.result);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunningMutation(false);
    }
  };

  // Screen 5: Run Behavioral Comparison
  const handleRunBehaviorComparison = async () => {
    if (!refactoredCode.trim()) return;
    setIsComparingBehavior(true);

    try {
      const res = await fetch('/api/compare-behavior', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalCode,
          refactoredCode,
        }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setBehaviorResult(data.result);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsComparingBehavior(false);
    }
  };

  // Reset experiment
  const handleReset = async () => {
    await fetch('/api/reset', { method: 'POST' });
    setStep(1);
    setOriginalCode(SAMPLE_CODE_OPTIONS.displayName);
    setLockedOriginalCode('');
    setRefactoredCode('');
    setTestExecutionResult(null);
    setMutationResult(null);
    setBehaviorResult(null);
    setShowResetModal(false);
  };

  // File import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (typeof evt.target?.result === 'string') {
          setOriginalCode(evt.target.result);
        }
      };
      reader.readAsText(file);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const lineCount = (str: string) => str.split('\n').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">RefactorLab</span>
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  AI Evaluation
                </span>
              </div>
              <p className="text-xs text-slate-400">Reliable Code Refactoring, Verification & Sensitivity Suite</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowResetModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Lab
            </button>
            <a
              href="/api/export/csv"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          </div>
        </div>

        {/* 6-Screen Stepper Progress Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 overflow-x-auto">
          <div className="flex items-center justify-between min-w-[700px] text-xs">
            {[
              { id: 1, label: '1. Original Code' },
              { id: 2, label: '2. Generate Prompt' },
              { id: 3, label: '3. AI Refactor' },
              { id: 4, label: '4. Jest & Mutation Tests' },
              { id: 5, label: '5. Behavioral Diff' },
              { id: 6, label: '6. Quality & Report' },
            ].map((s) => {
              const isActive = step === s.id;
              const isPast = step > s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    // Only allow navigating backwards or if baseline generated
                    if (s.id <= step || generatedTests) {
                      setStep(s.id as any);
                    }
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : isPast
                      ? 'text-indigo-400 hover:bg-slate-800/60'
                      : 'text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
                      isActive
                        ? 'bg-white text-indigo-600 font-bold'
                        : isPast
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {isPast ? <Check className="h-3 w-3" /> : s.id}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ================= SCREEN 1: ORIGINAL CODE ================= */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileCode className="h-5 w-5 text-indigo-400" />
                  Screen 1 — Original Source Code & Contract Analysis
                </h1>
                <p className="text-sm text-slate-400">
                  Paste JavaScript code or load a sample. RefactorLab analyzes public contracts, function signatures,
                  and edge cases.
                </p>
              </div>

              {/* Presets and file upload */}
              <div className="flex items-center flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-200 bg-slate-800 hover:bg-slate-700 cursor-pointer border border-slate-700">
                  <FileUp className="h-3.5 w-3.5 text-indigo-400" />
                  Import File
                  <input
                    type="file"
                    accept=".js,.jsx,.ts,.mjs"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <span className="text-[11px] text-slate-400 px-2 font-medium">Presets:</span>
                  <button
                    onClick={() => setOriginalCode(SAMPLE_CODE_OPTIONS.displayName)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-200 hover:bg-indigo-600 hover:text-white"
                  >
                    getDisplayName
                  </button>
                  <button
                    onClick={() => setOriginalCode(SAMPLE_CODE_OPTIONS.userPanel)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-200 hover:bg-indigo-600 hover:text-white"
                  >
                    React (JSX)
                  </button>
                  <button
                    onClick={() => setOriginalCode(SAMPLE_CODE_OPTIONS.throwsOnNull)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-200 hover:bg-indigo-600 hover:text-white"
                  >
                    Buggy (Null Throws)
                  </button>
                  <button
                    onClick={() => setOriginalCode(SAMPLE_CODE_OPTIONS.discountCommonJS)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-200 hover:bg-indigo-600 hover:text-white"
                  >
                    CommonJS
                  </button>
                </div>
              </div>
            </div>

            {/* Syntax alert banner if broken */}
            {!syntaxState.isValid && (
              <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <span className="font-bold text-red-300">
                    {syntaxState.errorType === 'SYNTAX_ERROR' ? 'SYNTAX ERROR' : 'COULD NOT LOAD CODE'}
                  </span>
                  {syntaxState.line && syntaxState.column && (
                    <span className="ml-2 font-mono bg-red-900/50 px-1.5 py-0.5 rounded text-red-200">
                      Line {syntaxState.line}, Column {syntaxState.column}
                    </span>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-red-300/90 whitespace-pre-wrap">
                    {syntaxState.errorMessage}
                  </p>
                </div>
              </div>
            )}

            {/* Code Editor & Contract Analysis Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 flex flex-col space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>Source Code Editor ({lineCount(originalCode)} lines)</span>
                  <span className="flex items-center gap-1.5">
                    {syntaxState.isValid ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Valid Syntax
                      </span>
                    ) : (
                      <span className="text-red-400 flex items-center gap-1">
                        <XCircle className="h-3.5 w-3.5" /> Syntax Error
                      </span>
                    )}
                  </span>
                </div>

                <div className="relative rounded-xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-inner">
                  <textarea
                    value={originalCode}
                    onChange={(e) => setOriginalCode(e.target.value)}
                    rows={18}
                    className="w-full bg-transparent text-slate-100 font-mono text-sm p-4 focus:outline-none resize-y leading-relaxed"
                    placeholder="// Paste JavaScript code here..."
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* Sidebar: Contract & Settings */}
              <div className="space-y-4">
                {/* AI Model Selector */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                    Target AI Model
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'gemini', name: 'Gemini 3.8 Flash (Direct API)', tag: 'Built-in / Fast' },
                      { id: 'chatgpt', name: 'ChatGPT (GPT-4o)', tag: 'API / Manual' },
                      { id: 'claude', name: 'Claude 3.5 Sonnet', tag: 'API / Manual' },
                      { id: 'manual', name: 'Manual Paste Fallback', tag: 'Offline' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedModel(m.id as any)}
                        className={`text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition ${
                          selectedModel === m.id
                            ? 'bg-indigo-600/10 border-indigo-500 text-white font-medium'
                            : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span>{m.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {m.tag}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contract Inspection */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Contract & Static Audit
                  </h3>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Detected Exports:</span>
                      <span className="font-mono text-indigo-300">
                        {codeContract?.targets && codeContract.targets.length > 0
                          ? codeContract.targets.map((t) => t.name).join(', ')
                          : 'None explicit'}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Cyclomatic Complexity:</span>
                      <span className="font-semibold text-slate-200">
                        {codeContract?.metrics?.cyclomatic ?? 'Calculating...'}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Maintainability Index:</span>
                      <span className="font-semibold text-slate-200">
                        {codeContract?.metrics?.maintainability ?? 'Calculating...'}
                      </span>
                    </div>

                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Determinism:</span>
                      <span
                        className={`font-medium ${
                          codeContract?.isNonDeterministic ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {codeContract?.isNonDeterministic
                          ? codeContract.nonDeterministicReason || 'Non-deterministic'
                          : 'Deterministic'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Continue button */}
                <button
                  onClick={handleProceedToPrompt}
                  disabled={isAnalyzing || !syntaxState.isValid || !originalCode.trim()}
                  className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm text-white flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition"
                >
                  {isAnalyzing ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing & Validating Code...
                    </>
                  ) : (
                    <>
                      Continue to Refactoring Prompt
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SCREEN 2: GENERATE REFACTORING PROMPT ================= */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <Sliders className="h-5 w-5 text-indigo-400" />
                  Screen 2 — Refactoring Prompt Generation
                </h1>
                <p className="text-sm text-slate-400">
                  Select your objective mode. RefactorLab generates a disciplined prompt guarding public contracts,
                  edge cases, and trusted tests.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Code
                </button>
              </div>
            </div>

            {/* Mode selection tabs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => setRefactorMode('preserve_behavior')}
                className={`p-4 rounded-xl border text-left transition ${
                  refactorMode === 'preserve_behavior'
                    ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-white">Mode A: Behavior-Preserving Refactoring</span>
                  {refactorMode === 'preserve_behavior' && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-500 text-white">ACTIVE</span>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                  Strictly preserve all observable behavior and return values on every edge case. Existing unusual
                  behavior is treated as intentional. No silent bug fixing that alters outputs.
                </p>
              </button>

              <button
                onClick={() => setRefactorMode('refactor_and_fix')}
                className={`p-4 rounded-xl border text-left transition ${
                  refactorMode === 'refactor_and_fix'
                    ? 'bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500'
                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-white">Mode B: Refactoring + Bug Fixing</span>
                  {refactorMode === 'refactor_and_fix' && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500 text-white">ACTIVE</span>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                  Permits fixing confirmed edge-case bugs (e.g. unhandled null pointer exceptions or empty string crashes)
                  while preserving public interfaces, function names, and caller signatures.
                </p>
              </button>
            </div>

            {/* Prompt Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>Editable Generated Prompt</span>
                <button
                  onClick={() => copyToClipboard(promptText)}
                  className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedPrompt ? 'Copied!' : 'Copy Prompt'}
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  rows={10}
                  className="w-full bg-transparent text-slate-100 font-mono text-sm focus:outline-none resize-y leading-relaxed"
                />
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={() => generatePrompt(refactorMode)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Re-generate Prompt
              </button>

              <button
                onClick={() => setStep(3)}
                className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-sm text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                Next: AI Refactoring
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= SCREEN 3: AI REFACTORING ================= */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-indigo-400" />
                  Screen 3 — AI Code Refactoring Execution
                </h1>
                <p className="text-sm text-slate-400">
                  Run refactoring via Gemini-3.8-Flash or paste refactored code manually from ChatGPT / Claude.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Prompt
                </button>
              </div>
            </div>

            {/* Quick Test Presets for instant verification */}
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center flex-wrap justify-between gap-2">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-indigo-400" />
                Quick Test Variants (Instant Verification):
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setRefactoredCode(SAMPLE_REFACTORS.optimal)}
                  className="px-2.5 py-1 text-xs rounded-md bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900"
                >
                  100% Passing Refactor
                </button>
                <button
                  onClick={() => setRefactoredCode(SAMPLE_REFACTORS.bugFix)}
                  className="px-2.5 py-1 text-xs rounded-md bg-indigo-950 text-indigo-300 border border-indigo-800 hover:bg-indigo-900"
                >
                  Defect-Fixing Refactor
                </button>
                <button
                  onClick={() => setRefactoredCode(SAMPLE_REFACTORS.brokenBehavior)}
                  className="px-2.5 py-1 text-xs rounded-md bg-amber-950 text-amber-300 border border-amber-800 hover:bg-amber-900"
                >
                  Behavior Altered Refactor
                </button>
                <button
                  onClick={() => setRefactoredCode(SAMPLE_REFACTORS.brokenInterface)}
                  className="px-2.5 py-1 text-xs rounded-md bg-red-950 text-red-300 border border-red-800 hover:bg-red-900"
                >
                  Broken Interface Refactor
                </button>
              </div>
            </div>

            {/* AI Action Card */}
            <div className="p-5 rounded-xl border border-indigo-900/60 bg-gradient-to-r from-indigo-950/40 to-slate-900 flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">Model: {selectedModel.toUpperCase()}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    gemini-3.8-flash ready
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Sends prompt and original source code to the model, strips Markdown fences, and checks public interfaces.
                </p>
                {aiResponseTime > 0 && (
                  <p className="mt-1 text-xs text-emerald-400">Execution completed in {aiResponseTime}s</p>
                )}
              </div>

              <button
                onClick={handleRunAIRefactoring}
                disabled={isAILoading}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white flex items-center gap-2 shadow-lg shadow-indigo-600/30 shrink-0"
              >
                {isAILoading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating with Gemini...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-white" />
                    Run AI Refactor
                  </>
                )}
              </button>
            </div>

            {aiError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                <span>{aiError}</span>
              </div>
            )}

            {/* Code Editor for Refactored Code */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>Refactored Source Code ({lineCount(refactoredCode)} lines)</span>
                <span>Editable or paste from external AI provider</span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-inner">
                <textarea
                  value={refactoredCode}
                  onChange={(e) => setRefactoredCode(e.target.value)}
                  rows={14}
                  className="w-full bg-transparent text-slate-100 font-mono text-sm p-4 focus:outline-none resize-y leading-relaxed"
                  placeholder="// Paste or run AI to populate refactored code..."
                />
              </div>
            </div>

            {/* Bottom Proceed Action */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Back to Prompt
              </button>

              <button
                onClick={() => {
                  setStep(4);
                  handleRunTests();
                }}
                disabled={!refactoredCode.trim()}
                className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-medium text-sm text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                Proceed to Jest & Mutation Tests
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= SCREEN 4: RELIABLE JEST TESTING & MUTATION ================= */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-indigo-400" />
                  Screen 4 — Reliable Jest Testing & Test Sensitivity Engine
                </h1>
                <p className="text-sm text-slate-400">
                  Runs immutable trusted tests against the exact refactored file in an isolated sandbox, plus controlled
                  mutation sensitivity checks.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Refactoring
                </button>
                <button
                  onClick={handleRunTests}
                  disabled={isRunningTests}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-500"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  {isRunningTests ? 'Executing...' : 'Re-run Tests'}
                </button>
              </div>
            </div>

            {/* Test Results Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
                <span className="text-xs text-slate-400">Overall Status</span>
                <div className="mt-1 flex items-center gap-2">
                  {testExecutionResult?.status === 'PASS' ? (
                    <span className="text-lg font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-5 w-5" /> PASSED
                    </span>
                  ) : testExecutionResult?.status === 'FAIL' ? (
                    <span className="text-lg font-bold text-red-400 flex items-center gap-1">
                      <XCircle className="h-5 w-5" /> FAILED
                    </span>
                  ) : (
                    <span className="text-lg font-bold text-slate-400">Not Run Yet</span>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
                <span className="text-xs text-slate-400">Passed / Total</span>
                <div className="mt-1 text-lg font-bold text-white">
                  {testExecutionResult
                    ? `${testExecutionResult.testsPassed} / ${testExecutionResult.testsTotal}`
                    : '—'}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
                <span className="text-xs text-slate-400">Pass Rate</span>
                <div className="mt-1 text-lg font-bold text-indigo-400">
                  {testExecutionResult ? testExecutionResult.passRate : '—'}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
                <span className="text-xs text-slate-400">Public Interface</span>
                <div className="mt-1 flex items-center gap-1.5">
                  {testExecutionResult?.publicInterface === 'Same' ? (
                    <span className="text-emerald-400 font-bold text-sm">Preserved</span>
                  ) : testExecutionResult?.publicInterface === 'Changed' ? (
                    <span className="text-red-400 font-bold text-sm">Changed</span>
                  ) : (
                    <span className="text-slate-400 text-sm">Unchecked</span>
                  )}
                </div>
              </div>
            </div>

            {/* Test Sensitivity / Mutation Testing Section */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/80 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-400" />
                    Test Suite Sensitivity Check (Mutation Testing)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Injects controlled mutations into original code to verify that the tests are genuinely sensitive
                    and capable of failing when bugs are introduced.
                  </p>
                </div>

                <button
                  onClick={handleRunMutationTest}
                  disabled={isRunningMutation}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 text-xs font-semibold shrink-0"
                >
                  {isRunningMutation ? 'Testing Mutants...' : 'Run Mutation Sensitivity Check'}
                </button>
              </div>

              {mutationResult && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400">Mutation Score:</span>
                      <span className="text-sm font-bold text-white">{mutationResult.score}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400">Sensitivity:</span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                          mutationResult.sensitivity === 'Robust'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : mutationResult.sensitivity === 'Moderate'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-red-950 text-red-300 border border-red-800'
                        }`}
                      >
                        {mutationResult.sensitivity}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      ({mutationResult.killedMutants} killed, {mutationResult.survivedMutants} survived of{' '}
                      {mutationResult.totalMutants} total)
                    </span>
                  </div>

                  {/* Mutants list */}
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-2 space-y-1.5 text-xs">
                    {mutationResult.mutants.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/80"
                      >
                        <div className="space-y-0.5">
                          <span className="font-medium text-slate-300">{m.description}</span>
                          {m.detectedByTest && (
                            <p className="text-[10px] text-slate-500">Caught by: {m.detectedByTest}</p>
                          )}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.status === 'KILLED'
                              ? 'bg-emerald-900/50 text-emerald-300'
                              : 'bg-red-900/50 text-red-300'
                          }`}
                        >
                          {m.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Jest Test Cases Breakdown */}
            {generatedTests && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-emerald-400" />
                    Trusted Test Suite Cases ({generatedTests.totalTests} total)
                  </h3>

                  {/* Search and filter */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Search tests..."
                        value={testSearch}
                        onChange={(e) => setTestSearch(e.target.value)}
                        className="pl-8 pr-3 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(['normal', 'edgeCases', 'invalid'] as const).map((catKey) => {
                    const group = generatedTests.groups[catKey];
                    return (
                      <div key={catKey} className="p-3 rounded-lg border border-slate-800 bg-slate-950/40">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                          <span>{group.category}</span>
                          <span className="text-indigo-400">{group.total} tests</span>
                        </div>
                        <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto">
                          {group.tests.slice(0, 10).map((t, i) => (
                            <div key={i} className="text-[11px] text-slate-400 flex items-center justify-between">
                              <span className="truncate pr-2">{t.name}</span>
                              <span className="text-emerald-400 shrink-0">PASS</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bottom Proceed Action */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Back to Refactor
              </button>

              <button
                onClick={() => {
                  setStep(5);
                  handleRunBehaviorComparison();
                }}
                className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-sm text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                Proceed to Behavioral Comparison
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= SCREEN 5: BEHAVIORAL COMPARISON ================= */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <GitCompare className="h-5 w-5 text-indigo-400" />
                  Screen 5 — Deterministic Behavioral Comparison
                </h1>
                <p className="text-sm text-slate-400">
                  Side-by-side execution across deterministic edge-case inputs (null, undefined, whitespace, numbers, objects).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(4)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Tests
                </button>
                <button
                  onClick={handleRunBehaviorComparison}
                  disabled={isComparingBehavior}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-500"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  {isComparingBehavior ? 'Comparing...' : 'Re-compare'}
                </button>
              </div>
            </div>

            {/* Status Summary Banner */}
            {behaviorResult && (
              <div
                className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                  behaviorResult.status === 'Equivalent'
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    : behaviorResult.status === 'Behavior changed'
                    ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  {behaviorResult.status === 'Equivalent' ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0" />
                  )}
                  <div>
                    <h3 className="font-bold text-sm tracking-wide uppercase">
                      Classification: {behaviorResult.status}
                    </h3>
                    <p className="text-xs opacity-90 mt-0.5">{behaviorResult.summary}</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs opacity-75">Equivalence Rate</span>
                  <div className="text-lg font-bold">{behaviorResult.equivalencePercentage}</div>
                </div>
              </div>
            )}

            {/* Input / Output Diff Table */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Edge-Case Input Matrix ({behaviorResult?.allComparisons?.length || 0} evaluated)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/50 text-slate-400 border-b border-slate-800 font-semibold">
                    <tr>
                      <th className="p-3">Input Description</th>
                      <th className="p-3">Original Output</th>
                      <th className="p-3">Refactored Output</th>
                      <th className="p-3 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {behaviorResult?.allComparisons?.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-800/30 transition">
                        <td className="p-3 font-mono text-slate-300">{c.inputDescription}</td>
                        <td className="p-3 font-mono">
                          <span
                            className={
                              c.originalResult.status === 'THREW' ? 'text-red-400' : 'text-slate-300'
                            }
                          >
                            {JSON.stringify(c.originalResult.value)}
                          </span>
                        </td>
                        <td className="p-3 font-mono">
                          <span
                            className={
                              c.refactoredResult.status === 'THREW' ? 'text-red-400' : 'text-slate-300'
                            }
                          >
                            {JSON.stringify(c.refactoredResult.value)}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {c.isMatch ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold text-[11px]">
                              <Check className="h-3.5 w-3.5" /> Match
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-400 font-semibold text-[11px]">
                              <X className="h-3.5 w-3.5" /> Diverged
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Proceed Action */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={() => setStep(4)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Back to Tests
              </button>

              <button
                onClick={() => setStep(6)}
                className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-sm text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                Proceed to Static Analysis & Final Report
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= SCREEN 6: STATIC ANALYSIS & FINAL REPORT ================= */}
        {step === 6 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <Layers className="h-5 w-5 text-indigo-400" />
                  Screen 6 — Static Analysis, ESLint & Plain-English Diagnostics
                </h1>
                <p className="text-sm text-slate-400">
                  Comprehensive evaluation combining ESLint rule differences, code quality metrics, and plain-English failure cards.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(5)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Behavior Diff
                </button>
                <a
                  href="/api/export/csv"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-500"
                >
                  <Download className="h-3.5 w-3.5" /> Download Full CSV
                </a>
              </div>
            </div>

            {/* Plain English Failure Cards (If any tests failed) */}
            {testExecutionResult?.failureExplanations &&
              testExecutionResult.failureExplanations.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
                    <Bug className="h-4 w-4" />
                    Plain-English Test Failure Diagnostics ({testExecutionResult.failureExplanations.length})
                  </h3>

                  <div className="grid grid-cols-1 gap-3">
                    {testExecutionResult.failureExplanations.map((fail, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl border border-red-900/60 bg-red-950/20 space-y-3 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-red-300">{fail.testTitle}</span>
                          <span className="px-2 py-0.5 rounded bg-red-900/60 text-red-200 font-mono text-[10px]">
                            {fail.category}
                          </span>
                        </div>

                        <p className="text-slate-200 font-medium">{fail.plainEnglishExplanation}</p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 font-mono text-[11px]">
                          <div>
                            <span className="text-slate-400">Expected:</span>
                            <p className="text-emerald-400 truncate">{fail.expectedBehavior}</p>
                          </div>
                          <div>
                            <span className="text-slate-400">Actual (Refactored):</span>
                            <p className="text-red-400 truncate">{fail.actualBehavior}</p>
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-300">
                          <span className="font-semibold text-slate-400">Interpretation:</span> {fail.interpretation}
                        </div>

                        <div className="text-[11px] text-indigo-300 bg-indigo-950/40 p-2 rounded border border-indigo-900/40">
                          <span className="font-semibold">Recommended Fix:</span> {fail.recommendedAction}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Metrics & ESLint Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* ESLint Section */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-indigo-400" />
                  ESLint Static Analysis
                </h3>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Refactored Errors:</span>
                    <span className="font-bold text-slate-200">
                      {testExecutionResult?.eslintErrors ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Refactored Warnings:</span>
                    <span className="font-bold text-slate-200">
                      {testExecutionResult?.eslintWarnings ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">Lint Delta vs Original:</span>
                    <span
                      className={`font-semibold capitalize ${
                        testExecutionResult?.eslintComparison === 'improved'
                          ? 'text-emerald-400'
                          : testExecutionResult?.eslintComparison === 'worse'
                          ? 'text-red-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {testExecutionResult?.eslintComparison ?? 'Unavailable'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Code Complexity & Maintainability */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-400" />
                  Complexity & Maintainability
                </h3>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Cyclomatic Complexity:</span>
                    <span className="font-bold text-slate-200">
                      {testExecutionResult?.originalMetrics?.cyclomatic ?? '—'} &rarr;{' '}
                      {testExecutionResult?.metrics?.cyclomatic ?? '—'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Maintainability Index:</span>
                    <span className="font-bold text-slate-200">
                      {testExecutionResult?.originalMetrics?.maintainability ?? '—'} &rarr;{' '}
                      {testExecutionResult?.metrics?.maintainability ?? '—'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">Maintainability Delta:</span>
                    <span
                      className={`font-semibold capitalize ${
                        testExecutionResult?.maintainabilityComparison === 'improved'
                          ? 'text-emerald-400'
                          : testExecutionResult?.maintainabilityComparison === 'worse'
                          ? 'text-red-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {testExecutionResult?.maintainabilityComparison ?? 'Same'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Start New Evaluation
              </button>

              <div className="flex items-center gap-3">
                <a
                  href="/api/export/json"
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-medium text-xs text-white flex items-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Export JSON
                </a>
                <a
                  href="/api/export/csv"
                  className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-sm text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <Download className="h-4 w-4" /> Export Complete CSV Report
                </a>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Confirmation Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Reset Experiment?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will clear all generated tests, refactored code, evaluation results, and reset RefactorLab to initial
              state.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-xs rounded-lg text-white bg-red-600 hover:bg-red-500 font-semibold"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
