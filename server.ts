import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import * as babelParser from '@babel/parser';
import {
  getExperimentState,
  saveExperimentState,
  resetExperimentState,
  ModelResult,
  ExperimentState,
} from './src/server/storage.ts';
import {
  calculateMetrics,
  runESLint,
  compareESLint,
  compareCyclomatic,
  compareMaintainability,
} from './src/server/analyzer.ts';
import { runUntrustedCodeTests } from './src/server/testRunner.ts';
import { generateCSVExport, evaluateBestModel } from './src/server/exporter.ts';
import { performSafetyChecks, sanitizeCode } from './src/server/safety.ts';
import { generateTestFileAndValidate, filterNodeWarnings } from './src/server/testGenerator.ts';
import { computeAgreementMatrix } from './src/server/agreement.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Express JSON limit 5 MB+ (configured as 10 MB for safety)
app.use(express.json({ limit: '10mb' }));

// 1. GET /api/state
app.get('/api/state', (req: Request, res: Response) => {
  try {
    const state = getExperimentState();
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. PUT /api/state
app.put('/api/state', (req: Request, res: Response) => {
  try {
    const current = getExperimentState();
    const merged: ExperimentState = {
      ...current,
      ...req.body,
    };
    const saved = saveExperimentState(merged);
    res.json({ success: true, state: saved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/analyze (Screen 1 Continue: Syntax check, automated test generation, and baseline validation)
app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({
        success: false,
        errorType: 'LOAD_ERROR',
        error: 'Original code cannot be empty.',
      });
    }

    const sanitized = sanitizeCode(code);

    // 1. SYNTAX CHECK: only when @babel/parser fails. Report real line and column.
    try {
      babelParser.parse(sanitized, {
        sourceType: 'unambiguous',
        plugins: ['jsx'],
      });
    } catch (syntaxErr: any) {
      const line = syntaxErr.loc?.line;
      const column = syntaxErr.loc?.column;
      const posStr = line && column ? ` (${line}:${column})` : '';
      return res.status(400).json({
        success: false,
        errorType: 'SYNTAX_ERROR',
        error: `Syntax Error${posStr}: ${syntaxErr.message}`,
        line,
        column,
      });
    }

    const state = getExperimentState();
    state.originalCode = sanitized;
    state.lockedOriginalCode = sanitized;

    // 2. Automated test generation and baseline validation
    try {
      const testGenResult = await generateTestFileAndValidate(sanitized, state.generatedTests.seed || 42);

      state.generatedTests = {
        ...state.generatedTests,
        hasGenerated: true,
        seed: testGenResult.seed,
        inputCount: testGenResult.inputCount,
        testFileCode: testGenResult.testFileCode,
        comparable: testGenResult.comparable,
        notComparableReason: testGenResult.notComparableReason,
        totalTests: testGenResult.totalTests,
        passedCount: testGenResult.passedCount,
        failedCount: testGenResult.failedCount,
        skippedCount: testGenResult.skippedCount,
        groups: testGenResult.groups,
        coverage: testGenResult.coverage,
        errors: testGenResult.errors,
        timestamp: testGenResult.timestamp,
      };

      state.lockedTestFileCode = testGenResult.testFileCode;
      state.step = 2; // Advance to Screen 2

      const saved = saveExperimentState(state);
      return res.json({
        success: true,
        state: saved,
        testResults: testGenResult,
      });
    } catch (loadErr: any) {
      const errorType = loadErr.errorType || 'LOAD_ERROR';
      const cleanMsg = filterNodeWarnings(loadErr.message || String(loadErr));
      return res.status(400).json({
        success: false,
        errorType,
        error: cleanMsg || 'Could not load code.',
        line: loadErr.line,
        column: loadErr.column,
      });
    }
  } catch (err: any) {
    const cleanMsg = filterNodeWarnings(err.message || String(err));
    return res.status(500).json({
      success: false,
      errorType: 'LOAD_ERROR',
      error: cleanMsg || 'Server error processing code.',
    });
  }
});

// 4. POST /api/regenerate (Regenerate with a new seed, keeping old attempt in history)
app.post('/api/regenerate', async (req: Request, res: Response) => {
  try {
    const state = getExperimentState();
    const originalCode = state.lockedOriginalCode || state.originalCode;

    if (!originalCode) {
      return res.status(400).json({ success: false, error: 'No locked original code found.' });
    }

    // Archive old attempt into history
    if (state.generatedTests.hasGenerated) {
      state.generatedTests.history.push({
        seed: state.generatedTests.seed,
        timestamp: state.generatedTests.timestamp || new Date().toISOString(),
        total: state.generatedTests.totalTests,
        passed: state.generatedTests.passedCount,
        failed: state.generatedTests.failedCount,
        coverage: state.generatedTests.coverage,
      });
    }

    // New seed
    const newSeed = Math.floor(Math.random() * 900000) + 100000;
    const testGenResult = await generateTestFileAndValidate(originalCode, newSeed);

    state.generatedTests = {
      ...state.generatedTests,
      hasGenerated: true,
      seed: newSeed,
      inputCount: testGenResult.inputCount,
      testFileCode: testGenResult.testFileCode,
      comparable: testGenResult.comparable,
      notComparableReason: testGenResult.notComparableReason,
      totalTests: testGenResult.totalTests,
      passedCount: testGenResult.passedCount,
      failedCount: testGenResult.failedCount,
      skippedCount: testGenResult.skippedCount,
      groups: testGenResult.groups,
      coverage: testGenResult.coverage,
      errors: testGenResult.errors,
      timestamp: testGenResult.timestamp,
    };
    state.lockedTestFileCode = testGenResult.testFileCode;

    const saved = saveExperimentState(state);
    res.json({ success: true, state: saved, testResults: testGenResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/run (Run automatic pipeline for one model)
app.post('/api/run', async (req: Request, res: Response) => {
  try {
    const { model, code, responseTime, prompt, strategy } = req.body;
    if (!model || !['chatgpt', 'claude', 'gemini'].includes(model)) {
      return res.status(400).json({ success: false, error: 'Invalid model specified' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'Code is required' });
    }

    const state = getExperimentState();
    const originalCode = state.lockedOriginalCode || state.originalCode;
    const testFileCode = state.lockedTestFileCode || state.generatedTests.testFileCode;

    if (!testFileCode) {
      return res.status(400).json({
        success: false,
        error: 'No validated test suite found. Run Screen 2 tests first.',
      });
    }

    // Step 1: Strip fences & perform safety checks
    const sanitizedCode = sanitizeCode(code);
    const safety = performSafetyChecks(originalCode, sanitizedCode);

    // Step 2: Run Jest on refactored code using SAME test file in isolated child process with 60s timeout
    const testExec = await runUntrustedCodeTests(sanitizedCode, testFileCode, 60000);

    // Step 3: Run ESLint on original and refactored code with shared flat config
    const origESLint = await runESLint(originalCode);
    const refacESLint = await runESLint(sanitizedCode);
    const eslintComp = compareESLint(origESLint.errors, refacESLint.errors);

    // Step 4: Calculate metrics for original and refactored code
    const origMetrics = calculateMetrics(originalCode);
    const refactoredMetrics = calculateMetrics(sanitizedCode);

    const complexityComp = compareCyclomatic(origMetrics.cyclomatic, refactoredMetrics.cyclomatic);
    const maintComp = compareMaintainability(origMetrics.maintainability, refactoredMetrics.maintainability);

    // Determine status & exact behavioural label
    let finalStatus: 'PASS' | 'FAIL' | 'ERROR' | 'INVALID RESPONSE' = testExec.status;
    let behaviourPreserved = `Behaviour matches original on ${testExec.passed} tests`;

    if (safety.hasCompileError) {
      finalStatus = 'ERROR';
      behaviourPreserved = 'Error (compile error)';
    } else if (!safety.isValid) {
      finalStatus = 'INVALID RESPONSE';
      behaviourPreserved = `No (${safety.invalidReason || 'Invalid response'})`;
    } else if (safety.interfaceStatus === 'Changed') {
      behaviourPreserved = `No (${safety.interfaceMessage})`;
      if (finalStatus === 'PASS') {
        finalStatus = 'FAIL';
      }
    } else if (testExec.failed > 0 || testExec.status === 'FAIL') {
      finalStatus = 'FAIL';
      behaviourPreserved = 'No (tests failed)';
    } else if (testExec.status === 'ERROR') {
      finalStatus = 'ERROR';
      behaviourPreserved = 'Error (runner/timeout error)';
    }

    const runResult: ModelResult = {
      runId: `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      status: finalStatus,
      testsPassed: testExec.passed,
      testsFailed: testExec.failed,
      testsSkipped: testExec.skipped,
      testsTotal: testExec.total,
      passRate: testExec.passRate,
      behaviourPreserved,
      failingTests: testExec.failingTests,
      runnerError: testExec.runnerError,
      compileErrors: safety.compileErrorMessage || testExec.compileErrors,
      timeouts: testExec.timeouts,
      coverage: testExec.coverage,
      publicInterface: safety.interfaceStatus,
      interfaceDetails: safety.interfaceMessage,
      isResponseValid: safety.isValid,
      invalidReason: safety.invalidReason,
      originalLineCount: safety.originalLineCount,
      refactoredLineCount: safety.refactoredLineCount,
      eslintErrors: refacESLint.errors,
      eslintWarnings: refacESLint.warnings,
      eslintOriginalErrors: origESLint.errors,
      eslintOriginalWarnings: origESLint.warnings,
      eslintComparison: eslintComp,
      eslintMessages: refacESLint.messages,
      metrics: refactoredMetrics,
      originalMetrics: origMetrics,
      complexityComparison: complexityComp,
      maintainabilityComparison: maintComp,
    };

    // Step 5: Save results & update history
    const targetModel = state.models[model as 'chatgpt' | 'claude' | 'gemini'];
    if (targetModel.result) {
      targetModel.history.push(targetModel.result);
    }
    targetModel.code = sanitizedCode;
    targetModel.responseTime = responseTime ? String(responseTime) : '';
    targetModel.prompt = prompt || targetModel.prompt;
    targetModel.result = runResult;
    targetModel.status = runResult.status;

    // Lock strategy
    state.strategyLocked = true;
    if (strategy) {
      state.strategy = strategy;
    }

    // Step 6: Compute 3x3 model agreement
    state.agreement = computeAgreementMatrix(state.models);

    const savedState = saveExperimentState(state);
    const bestModel = evaluateBestModel(savedState.models);

    res.json({
      success: true,
      result: runResult,
      state: savedState,
      bestModel,
      agreement: savedState.agreement,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. GET /api/export/csv
app.get('/api/export/csv', (req: Request, res: Response) => {
  try {
    const state = getExperimentState();
    const csv = generateCSVExport(state);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="refactorlab_experiment.csv"');
    res.send(csv);
  } catch (err: any) {
    res.status(500).send(`Failed to export CSV: ${err.message}`);
  }
});

// 7. GET /api/export/json
app.get('/api/export/json', (req: Request, res: Response) => {
  try {
    const state = getExperimentState();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="refactorlab_experiment.json"');
    res.send(JSON.stringify(state, null, 2));
  } catch (err: any) {
    res.status(500).send(`Failed to export JSON: ${err.message}`);
  }
});

// 8. POST /api/reset
app.post('/api/reset', (req: Request, res: Response) => {
  try {
    const state = resetExperimentState();
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server with Vite middleware in development
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RefactorLab server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RefactorLab server:', err);
  process.exit(1);
});
