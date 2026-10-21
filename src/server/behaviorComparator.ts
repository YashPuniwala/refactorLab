import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { sanitizeCode } from './safety.ts';

const require = createRequire(import.meta.url);

export interface BehaviorDiffItem {
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

export interface BehaviorComparisonResult {
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

/**
 * Runs deterministic inputs against both original and refactored code and compares behaviors
 */
export async function compareBehavior(
  originalCode: string,
  refactoredCode: string,
  functionName?: string
): Promise<BehaviorComparisonResult> {
  const sanitizedOriginal = sanitizeCode(originalCode);
  const sanitizedRefactored = sanitizeCode(refactoredCode);

  const tempDir = path.resolve(
    process.cwd(),
    '.refactorlab_temp',
    `compare_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

    // Setup Babel config for CommonJS
    const babelConfig = {
      presets: [
        [require.resolve('@babel/preset-env'), { targets: { node: 'current' }, modules: 'commonjs' }],
        [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
      ],
    };
    fs.writeFileSync(path.join(tempDir, 'babel.config.json'), JSON.stringify(babelConfig, null, 2), 'utf8');

    // Transform code to CJS using babel core
    const babel = require('@babel/core');
    let origCjs = '';
    let refactCjs = '';

    try {
      origCjs = babel.transformSync(sanitizedOriginal, {
        presets: [
          [require.resolve('@babel/preset-env'), { targets: { node: 'current' }, modules: 'commonjs' }],
          [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
        ],
        filename: 'original.js',
      }).code;
    } catch (err: any) {
      return {
        status: 'Inconclusive',
        totalCases: 0,
        matchedCases: 0,
        deviatedCases: 0,
        equivalencePercentage: '0%',
        differences: [],
        allComparisons: [],
        exportComparison: {
          originalExports: [],
          refactoredExports: [],
          missingInRefactored: [],
          isCompatible: false,
        },
        summary: `Original code could not be compiled for comparison: ${err.message}`,
      };
    }

    try {
      refactCjs = babel.transformSync(sanitizedRefactored, {
        presets: [
          [require.resolve('@babel/preset-env'), { targets: { node: 'current' }, modules: 'commonjs' }],
          [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
        ],
        filename: 'refactored.js',
      }).code;
    } catch (err: any) {
      return {
        status: 'Inconclusive',
        totalCases: 0,
        matchedCases: 0,
        deviatedCases: 0,
        equivalencePercentage: '0%',
        differences: [],
        allComparisons: [],
        exportComparison: {
          originalExports: [],
          refactoredExports: [],
          missingInRefactored: [],
          isCompatible: false,
        },
        summary: `Refactored code could not be compiled for comparison: ${err.message}`,
      };
    }

    fs.writeFileSync(path.join(tempDir, 'original.js'), origCjs, 'utf8');
    fs.writeFileSync(path.join(tempDir, 'refactored.js'), refactCjs, 'utf8');

    // Comparison harness script
    const harnessScript = `
const origMod = require('./original.js');
const refactMod = require('./refactored.js');

function getCallable(mod, preferredName) {
  if (preferredName && typeof mod[preferredName] === 'function') {
    return mod[preferredName];
  }
  if (typeof mod.default === 'function') {
    return mod.default;
  }
  const keys = Object.keys(mod).filter(k => typeof mod[k] === 'function');
  if (keys.length > 0) {
    return mod[keys[0]];
  }
  if (typeof mod === 'function') {
    return mod;
  }
  return null;
}

const origExports = Object.keys(origMod);
const refactExports = Object.keys(refactMod);
const missingExports = origExports.filter(k => k !== '__esModule' && !refactExports.includes(k));

const fnOrig = getCallable(origMod, ${JSON.stringify(functionName || '')});
const fnRefact = getCallable(refactMod, ${JSON.stringify(functionName || '')});

if (!fnOrig || !fnRefact) {
  process.stdout.write(JSON.stringify({
    success: false,
    error: 'Could not find matching callable function in both modules',
    origExports,
    refactExports,
    missingExports
  }));
  process.exit(0);
}

const testInputs = [
  { desc: 'null', args: [null] },
  { desc: 'undefined', args: [undefined] },
  { desc: 'empty string ""', args: [''] },
  { desc: 'whitespace string "   "', args: ['   '] },
  { desc: 'single word "Alice"', args: ['Alice'] },
  { desc: 'word with spaces "  Bob Smith  "', args: ['  Bob Smith  '] },
  { desc: 'empty object {}', args: [{}] },
  { desc: 'object with name { name: "Carol" }', args: [{ name: 'Carol' }] },
  { desc: 'object with whitespace name { name: "   " }', args: [{ name: '   ' }] },
  { desc: 'object with displayName { displayName: "Dave" }', args: [{ displayName: 'Dave' }] },
  { desc: 'number 0', args: [0] },
  { desc: 'number 1', args: [1] },
  { desc: 'negative number -1', args: [-1] },
  { desc: 'NaN', args: [NaN] },
  { desc: 'boolean true', args: [true] },
  { desc: 'boolean false', args: [false] },
  { desc: 'empty array []', args: [[]] },
  { desc: 'array with elements ["Guest", "User"]', args: [['Guest', 'User']] },
  { desc: 'multiple args (10, 20)', args: [10, 20] },
  { desc: 'multiple args ("test", null, 42)', args: ['test', null, 42] }
];

function safelyExecute(fn, args) {
  try {
    const val = fn(...args);
    let serialized = val;
    if (typeof val === 'function') serialized = '[Function]';
    if (typeof val === 'symbol') serialized = val.toString();
    if (typeof val === 'bigint') serialized = val.toString() + 'n';
    if (Number.isNaN(val)) serialized = 'NaN';
    return {
      status: 'RETURNED',
      value: serialized,
      type: typeof val
    };
  } catch (err) {
    return {
      status: 'THREW',
      value: err ? (err.message || String(err)) : 'Unknown error',
      type: 'error'
    };
  }
}

const comparisons = [];
for (let i = 0; i < testInputs.length; i++) {
  const item = testInputs[i];
  const rOrig = safelyExecute(fnOrig, item.args);
  const rRefact = safelyExecute(fnRefact, item.args);

  const isMatch = (
    rOrig.status === rRefact.status &&
    JSON.stringify(rOrig.value) === JSON.stringify(rRefact.value) &&
    rOrig.type === rRefact.type
  );

  let issueDescription = undefined;
  if (!isMatch) {
    if (rOrig.status !== rRefact.status) {
      issueDescription = \`Status mismatch: Original \${rOrig.status}, Refactored \${rRefact.status}\`;
    } else {
      issueDescription = \`Value mismatch: Expected \${JSON.stringify(rOrig.value)}, Received \${JSON.stringify(rRefact.value)}\`;
    }
  }

  comparisons.push({
    id: 'case_' + i,
    inputDescription: item.desc,
    originalResult: rOrig,
    refactoredResult: rRefact,
    isMatch,
    issueDescription
  });
}

process.stdout.write(JSON.stringify({
  success: true,
  origExports,
  refactExports,
  missingExports,
  comparisons
}));
`;

    fs.writeFileSync(path.join(tempDir, 'runner.cjs'), harnessScript, 'utf8');

    return await new Promise<BehaviorComparisonResult>((resolve) => {
      const child = spawn('node', ['runner.cjs'], {
        cwd: tempDir,
        env: { ...process.env, NODE_ENV: 'test' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        resolve({
          status: 'Inconclusive',
          totalCases: 0,
          matchedCases: 0,
          deviatedCases: 0,
          equivalencePercentage: '0%',
          differences: [],
          allComparisons: [],
          exportComparison: {
            originalExports: [],
            refactoredExports: [],
            missingInRefactored: [],
            isCompatible: false,
          },
          summary: 'Behavioral comparison timed out after 10 seconds.',
        });
      }, 10000);

      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}

        try {
          const res = JSON.parse(stdout.trim());
          if (!res.success) {
            resolve({
              status: 'Inconclusive',
              totalCases: 0,
              matchedCases: 0,
              deviatedCases: 0,
              equivalencePercentage: '0%',
              differences: [],
              allComparisons: [],
              exportComparison: {
                originalExports: res.origExports || [],
                refactoredExports: res.refactExports || [],
                missingInRefactored: res.missingExports || [],
                isCompatible: (res.missingExports || []).length === 0,
              },
              summary: res.error || 'Could not execute behavioral comparison harness.',
            });
            return;
          }

          const comparisons: BehaviorDiffItem[] = res.comparisons;
          const total = comparisons.length;
          const matches = comparisons.filter((c) => c.isMatch).length;
          const diffs = comparisons.filter((c) => !c.isMatch);
          const pct = total > 0 ? Math.round((matches / total) * 100) : 0;

          const missingExports = res.missingExports || [];
          const isExportsCompatible = missingExports.length === 0;

          let status: 'Equivalent' | 'Behavior changed' | 'Inconclusive' = 'Equivalent';
          let summary = '';

          if (!isExportsCompatible) {
            status = 'Behavior changed';
            summary = `Public interface changed: Missing exports [${missingExports.join(', ')}] in refactored code.`;
          } else if (diffs.length > 0) {
            status = 'Behavior changed';
            summary = `Behavior changed: ${diffs.length} out of ${total} input tests produced differing results or differing error behaviors.`;
          } else if (total === 0) {
            status = 'Inconclusive';
            summary = 'No test inputs could be evaluated.';
          } else {
            status = 'Equivalent';
            summary = `Identical behavior verified across ${total} input edge-cases and identical public exports.`;
          }

          resolve({
            status,
            totalCases: total,
            matchedCases: matches,
            deviatedCases: diffs.length,
            equivalencePercentage: `${pct}%`,
            differences: diffs,
            allComparisons: comparisons,
            exportComparison: {
              originalExports: res.origExports || [],
              refactoredExports: res.refactExports || [],
              missingInRefactored: missingExports,
              isCompatible: isExportsCompatible,
            },
            summary,
          });
        } catch (err: any) {
          resolve({
            status: 'Inconclusive',
            totalCases: 0,
            matchedCases: 0,
            deviatedCases: 0,
            equivalencePercentage: '0%',
            differences: [],
            allComparisons: [],
            exportComparison: {
              originalExports: [],
              refactoredExports: [],
              missingInRefactored: [],
              isCompatible: false,
            },
            summary: `Error parsing comparison output: ${err.message}. Stderr: ${stderr.slice(0, 150)}`,
          });
        }
      });
    });
  } catch (err: any) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    return {
      status: 'Inconclusive',
      totalCases: 0,
      matchedCases: 0,
      deviatedCases: 0,
      equivalencePercentage: '0%',
      differences: [],
      allComparisons: [],
      exportComparison: {
        originalExports: [],
        refactoredExports: [],
        missingInRefactored: [],
        isCompatible: false,
      },
      summary: `Failed to initialize behavioral comparison: ${err.message}`,
    };
  }
}
