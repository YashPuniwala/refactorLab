import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { sanitizeCode } from './safety.ts';
import { filterNodeWarnings } from './testGenerator.ts';

const require = createRequire(import.meta.url);

export interface CoverageMetrics {
  linesPct: number | 'Unavailable';
  branchesPct: number | 'Unavailable';
  statementsPct: number | 'Unavailable';
  functionsPct: number | 'Unavailable';
}

export interface TestExecutionResult {
  status: 'PASS' | 'FAIL' | 'ERROR';
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  passRate: string;
  behaviourPreserved: string;
  coverage: CoverageMetrics;
  failingTests: Array<{ title: string; failureMessage: string }>;
  runnerError: string | null;
  compileErrors: string | null;
  timeouts: number;
}

export async function runUntrustedCodeTests(
  code: string,
  tests: string,
  timeoutMs: number = 60000
): Promise<TestExecutionResult> {
  const sanitizedCode = sanitizeCode(code);
  const tempDir = path.resolve(
    process.cwd(),
    '.refactorlab_temp',
    `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // Ensure temp directory has commonjs package.json so Node never treats files as ESM from parent
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

    // Write babel.config.json using identical presets for Jest babel-jest
    const babelConfig = {
      presets: [
        [require.resolve('@babel/preset-env'), { targets: { node: 'current' }, modules: 'commonjs' }],
        [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
      ],
    };
    fs.writeFileSync(path.join(tempDir, 'babel.config.json'), JSON.stringify(babelConfig, null, 2), 'utf8');

    // Write code as code.js and index.js
    const codePath = path.join(tempDir, 'code.js');
    const indexPath = path.join(tempDir, 'index.js');
    fs.writeFileSync(codePath, sanitizedCode, 'utf8');
    fs.writeFileSync(indexPath, sanitizedCode, 'utf8');

    // Write trusted tests to code.test.js
    const testPath = path.join(tempDir, 'code.test.js');
    fs.writeFileSync(testPath, tests, 'utf8');

    // Create jest.config.json with coverage and jsdom environment
    const jestConfig = {
      testEnvironment: 'jsdom',
      collectCoverage: true,
      coverageReporters: ['json-summary'],
      collectCoverageFrom: ['code.js'],
      coverageDirectory: './coverage',
      transform: {
        '^.+\\.[t|j]sx?$': 'babel-jest',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'jest.config.json'),
      JSON.stringify(jestConfig, null, 2),
      'utf8'
    );

    // Run Jest in a child process with 60s timeout
    return await new Promise<TestExecutionResult>((resolve) => {
      let isTimedOut = false;
      const child = spawn(
        'npx',
        [
          'jest',
          'code.test.js',
          '--config',
          'jest.config.json',
          '--json',
          '--runInBand',
          '--forceExit',
        ],
        {
          cwd: tempDir,
          shell: true,
          env: {
            ...process.env,
            NODE_ENV: 'test',
          },
        }
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        isTimedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {}
      }, timeoutMs);

      child.on('close', () => {
        clearTimeout(timer);

        // Read coverage report if generated
        const coverageResult: CoverageMetrics = {
          linesPct: 'Unavailable',
          branchesPct: 'Unavailable',
          statementsPct: 'Unavailable',
          functionsPct: 'Unavailable',
        };

        const covSummaryPath = path.join(tempDir, 'coverage', 'coverage-summary.json');
        if (fs.existsSync(covSummaryPath)) {
          try {
            const rawCov = fs.readFileSync(covSummaryPath, 'utf8');
            const parsedCov = JSON.parse(rawCov);
            if (parsedCov.total) {
              const t = parsedCov.total;
              coverageResult.linesPct =
                typeof t.lines?.pct === 'number' ? Math.round(t.lines.pct) : 'Unavailable';
              coverageResult.branchesPct =
                typeof t.branches?.pct === 'number' ? Math.round(t.branches.pct) : 'Unavailable';
              coverageResult.statementsPct =
                typeof t.statements?.pct === 'number' ? Math.round(t.statements.pct) : 'Unavailable';
              coverageResult.functionsPct =
                typeof t.functions?.pct === 'number' ? Math.round(t.functions.pct) : 'Unavailable';
            }
          } catch {}
        }

        if (isTimedOut) {
          return resolve({
            status: 'ERROR',
            passed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            passRate: '0%',
            behaviourPreserved: 'Error (timeout)',
            coverage: coverageResult,
            failingTests: [],
            runnerError: `Execution timed out after ${timeoutMs / 1000} seconds. Possible infinite loop in untrusted code.`,
            compileErrors: null,
            timeouts: 1,
          });
        }

        // Try parsing JSON output from Jest
        try {
          const jsonStartIndex = stdout.indexOf('{');
          const jsonEndIndex = stdout.lastIndexOf('}');
          if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            return resolve({
              status: 'ERROR',
              passed: 0,
              failed: 0,
              skipped: 0,
              total: 0,
              passRate: '0%',
              behaviourPreserved: 'Error',
              coverage: coverageResult,
              failingTests: [],
              runnerError: filterNodeWarnings(stderr) || filterNodeWarnings(stdout) || 'Test runner failed without valid output.',
              compileErrors: filterNodeWarnings(stderr) || filterNodeWarnings(stdout),
              timeouts: 0,
            });
          }

          const rawJson = stdout.slice(jsonStartIndex, jsonEndIndex + 1);
          const parsed = JSON.parse(rawJson);

          const passed = parsed.numPassedTests || 0;
          const failed = parsed.numFailedTests || 0;
          const skipped = (parsed.numPendingTests || 0) + (parsed.numTodoTests || 0);
          const total = parsed.numTotalTests || passed + failed + skipped;
          const numRuntimeErrors = parsed.numRuntimeErrorTestSuites || 0;

          const failingTests: Array<{ title: string; failureMessage: string }> = [];
          let compileErrorMessage: string | null = null;

          if (Array.isArray(parsed.testResults)) {
            for (const suite of parsed.testResults) {
              if (suite.message) {
                compileErrorMessage = suite.message;
              }
              if (Array.isArray(suite.assertionResults)) {
                for (const assertion of suite.assertionResults) {
                  if (assertion.status === 'failed') {
                    failingTests.push({
                      title: assertion.fullName || assertion.title || 'Unnamed test',
                      failureMessage:
                        (assertion.failureMessages || []).join('\n') || 'Assertion failed',
                    });
                  }
                }
              }
            }
          }

          const passRate =
            total > 0 ? `${passed}/${total} (${Math.round((passed / total) * 100)}%)` : '0/0';

          if (numRuntimeErrors > 0 && total === 0) {
            return resolve({
              status: 'ERROR',
              passed: 0,
              failed: 0,
              skipped: 0,
              total: 0,
              passRate: '0%',
              behaviourPreserved: 'Error (syntax/runtime)',
              coverage: coverageResult,
              failingTests: [],
              runnerError: compileErrorMessage || 'Test suite failed to compile or run.',
              compileErrors: compileErrorMessage,
              timeouts: 0,
            });
          }

          if (failed > 0 || numRuntimeErrors > 0) {
            return resolve({
              status: 'FAIL',
              passed,
              failed: failed > 0 ? failed : 1,
              skipped,
              total: total > 0 ? total : 1,
              passRate,
              behaviourPreserved: 'No (tests failed)',
              coverage: coverageResult,
              failingTests,
              runnerError: null,
              compileErrors: compileErrorMessage,
              timeouts: 0,
            });
          }

          if (passed > 0 && failed === 0 && numRuntimeErrors === 0) {
            return resolve({
              status: 'PASS',
              passed,
              failed: 0,
              skipped,
              total,
              passRate,
              behaviourPreserved: 'Behaviour preserved (per tests)',
              coverage: coverageResult,
              failingTests: [],
              runnerError: null,
              compileErrors: null,
              timeouts: 0,
            });
          }

          return resolve({
            status: 'ERROR',
            passed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            passRate: '0%',
            behaviourPreserved: 'Error (no tests found)',
            coverage: coverageResult,
            failingTests: [],
            runnerError:
              'No tests were executed. Please verify test definitions in Trusted Tests.',
            compileErrors: null,
            timeouts: 0,
          });
        } catch (err: any) {
          return resolve({
            status: 'ERROR',
            passed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            passRate: '0%',
            behaviourPreserved: 'Error',
            coverage: coverageResult,
            failingTests: [],
            runnerError: `Failed to parse test runner output: ${err.message}\nRaw stderr: ${stderr}`,
            compileErrors: stderr,
            timeouts: 0,
          });
        }
      });
    });
  } catch (err: any) {
    return {
      status: 'ERROR',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      passRate: '0%',
      behaviourPreserved: 'Error',
      coverage: {
        linesPct: 'Unavailable',
        branchesPct: 'Unavailable',
        statementsPct: 'Unavailable',
        functionsPct: 'Unavailable',
      },
      failingTests: [],
      runnerError: err.message || 'Unknown error preparing test environment',
      compileErrors: null,
      timeouts: 0,
    };
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
