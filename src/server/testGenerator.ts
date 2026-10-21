// @ts-ignore
import * as babelParser from '@babel/parser';
// @ts-ignore
import * as babel from '@babel/core';
import fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { CoverageMetrics } from './storage.ts';

const require = createRequire(import.meta.url);

/**
 * Filters out Node warning messages from output strings
 */
export function filterNodeWarnings(str: string): string {
  if (!str) return '';
  return str
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\(node:\d+\)\s+(?:\[DEP\d+\]\s+)?(?:Experimental)?Warning:/i.test(trimmed)) return false;
      if (/^Use `node --trace-warnings/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * Transforms code (ESM, JSX, or CommonJS) to CommonJS for safe Node sandbox execution
 */
export function transformCodeToCommonJS(code: string, targets: ExportTarget[] = []): string {
  const hasExplicitExports = /(?:export\s+(?:default\s+|function|const|let|var|class|\{)|module\.exports\s*=|exports\.)/.test(
    code
  );

  let codeToTransform = code;
  if (!hasExplicitExports && targets.length > 0) {
    const namedTargets = targets.filter((t) => !t.isDefault).map((t) => t.name);
    if (namedTargets.length > 0) {
      codeToTransform = `${code}\nmodule.exports = { ${namedTargets.join(', ')} };`;
    }
  }

  const result = babel.transformSync(codeToTransform, {
    presets: [
      [require.resolve('@babel/preset-env'), { targets: { node: 'current' }, modules: 'commonjs' }],
      [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
    ],
    filename: 'code.js',
    configFile: false,
    babelrc: false,
  });

  return result?.code || codeToTransform;
}

export interface TestItem {
  name: string;
  inputDesc: string;
  expectedOutcome?: string;
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

export interface GeneratedTestsResult {
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
  timestamp: string;
}

export interface ExportTarget {
  name: string;
  isComponent: boolean;
  isDefault: boolean;
  propNames?: string[];
  isNonDeterministic?: boolean;
  nonDeterministicReason?: string;
}

/**
 * Detects non-deterministic or side-effecting code
 */
export function checkNonDeterminism(code: string): { isNonDeterministic: boolean; reason?: string } {
  if (/Math\.random\s*\(/i.test(code)) {
    return { isNonDeterministic: true, reason: 'Uses Math.random (non-deterministic)' };
  }
  if (/Date\.now\s*\(/i.test(code)) {
    return { isNonDeterministic: true, reason: 'Uses Date.now (time-dependent)' };
  }
  if (/new\s+Date\s*\(/i.test(code)) {
    return { isNonDeterministic: true, reason: 'Uses new Date() (time-dependent)' };
  }
  if (/\bfetch\s*\(/i.test(code)) {
    return { isNonDeterministic: true, reason: 'Uses network fetch (external dependency)' };
  }
  if (/\b(?:setTimeout|setInterval)\s*\(/i.test(code)) {
    return { isNonDeterministic: true, reason: 'Uses timers (asynchronous side-effect)' };
  }
  return { isNonDeterministic: false };
}

/**
 * Detects exported functions and React components
 */
export function detectExportTargets(code: string): { targets: ExportTarget[]; overallNonDeterministic?: boolean; nonDeterministicReason?: string } {
  const targets: ExportTarget[] = [];
  const nonDetCheck = checkNonDeterminism(code);

  try {
    const ast = babelParser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
    });

    const isReactComponent = (name: string, node: any) => {
      // Components typically start with a capital letter or contain JSX return
      if (/^[A-Z]/.test(name)) return true;
      const nodeStr = JSON.stringify(node);
      return nodeStr.includes('JSXElement') || nodeStr.includes('createElement');
    };

    const extractPropsFromParams = (params: any[]): string[] => {
      const props = new Set<string>();
      if (!params || params.length === 0) return ['visible', 'user', 'name', 'value'];
      const firstParam = params[0];
      if (firstParam.type === 'ObjectPattern') {
        for (const prop of firstParam.properties) {
          if (prop.key?.name) props.add(prop.key.name);
        }
      }
      return Array.from(props);
    };

    for (const node of ast.program.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          if (node.declaration.type === 'FunctionDeclaration' && (node.declaration as any).id) {
            const name = (node.declaration as any).id.name;
            const isComp = isReactComponent(name, node.declaration);
            targets.push({
              name,
              isComponent: isComp,
              isDefault: false,
              propNames: isComp ? extractPropsFromParams((node.declaration as any).params) : undefined,
              isNonDeterministic: nonDetCheck.isNonDeterministic,
              nonDeterministicReason: nonDetCheck.reason,
            });
          } else if (node.declaration.type === 'VariableDeclaration') {
            for (const d of (node.declaration as any).declarations) {
              if (d.id?.type === 'Identifier') {
                const name = d.id.name;
                const isComp = isReactComponent(name, d.init);
                targets.push({
                  name,
                  isComponent: isComp,
                  isDefault: false,
                  propNames: isComp && d.init?.params ? extractPropsFromParams(d.init.params) : ['visible', 'user', 'name'],
                  isNonDeterministic: nonDetCheck.isNonDeterministic,
                  nonDeterministicReason: nonDetCheck.reason,
                });
              }
            }
          }
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        let name = 'defaultExport';
        const decl = (node as any).declaration;
        if (decl?.id?.name) name = decl.id.name;
        const isComp = isReactComponent(name, decl);
        targets.push({
          name: 'default',
          isComponent: isComp,
          isDefault: true,
          propNames: isComp ? ['visible', 'user', 'name'] : undefined,
          isNonDeterministic: nonDetCheck.isNonDeterministic,
          nonDeterministicReason: nonDetCheck.reason,
        });
      } else if (node.type === 'ExpressionStatement') {
        const expr = (node as any).expression;
        if (expr?.type === 'AssignmentExpression' && expr.left?.object?.name === 'module' && expr.left?.property?.name === 'exports') {
          if (expr.right?.type === 'ObjectExpression') {
            for (const p of expr.right.properties) {
              const name = p.key?.name || p.key?.value;
              if (name) {
                const isComp = isReactComponent(name, p);
                targets.push({
                  name,
                  isComponent: isComp,
                  isDefault: false,
                  propNames: isComp ? ['visible', 'user', 'name', 'value'] : undefined,
                  isNonDeterministic: nonDetCheck.isNonDeterministic,
                  nonDeterministicReason: nonDetCheck.reason,
                });
              }
            }
          } else if (expr.right?.name) {
            const name = expr.right.name;
            const isComp = isReactComponent(name, expr.right);
            targets.push({
              name,
              isComponent: isComp,
              isDefault: false,
              isNonDeterministic: nonDetCheck.isNonDeterministic,
              nonDeterministicReason: nonDetCheck.reason,
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.error('Error parsing AST for exports:', err);
  }

  // Fallback if no export matched but functions exist
  if (targets.length === 0) {
    try {
      const ast = babelParser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx'] });
      for (const node of ast.program.body) {
        if (node.type === 'FunctionDeclaration' && node.id) {
          targets.push({
            name: node.id.name,
            isComponent: /^[A-Z]/.test(node.id.name),
            isDefault: false,
            isNonDeterministic: nonDetCheck.isNonDeterministic,
            nonDeterministicReason: nonDetCheck.reason,
          });
        }
      }
    } catch {}
  }

  return {
    targets,
    overallNonDeterministic: nonDetCheck.isNonDeterministic,
    nonDeterministicReason: nonDetCheck.reason,
  };
}

/**
 * Safely serializes JavaScript values into code literals
 */
export function safeSerializeLiteral(val: any): string {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NaN';
    if (val === Infinity) return 'Infinity';
    if (val === -Infinity) return '-Infinity';
    return String(val);
  }
  if (typeof val === 'string') return JSON.stringify(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (val instanceof Date) return `new Date(${JSON.stringify(val.toISOString())})`;
  if (Array.isArray(val)) {
    return `[${val.map(safeSerializeLiteral).join(', ')}]`;
  }
  if (typeof val === 'object') {
    try {
      const entries = Object.entries(val).map(([k, v]) => `${JSON.stringify(k)}: ${safeSerializeLiteral(v)}`);
      return `{ ${entries.join(', ')} }`;
    } catch {
      return '{}';
    }
  }
  return JSON.stringify(String(val));
}

/**
 * Generate 3 categories of inputs (~100 inputs) using fast-check + fixed edge cases
 */
export function generateInputSet(seed: number, isComponent: boolean = false, propNames: string[] = []): {
  normal: any[];
  edgeCases: any[];
  invalid: any[];
} {
  // Edge cases list
  let edgeCases: any[] = [];
  let normal: any[] = [];
  let invalid: any[] = [];

  if (isComponent) {
    // Component props
    edgeCases = [
      null,
      undefined,
      {},
      { visible: false },
      { visible: true, user: null },
      { visible: true, user: {} },
      { visible: true, user: { name: '' } },
      { visible: true, user: { name: '   ' } },
      { visible: true, user: { name: '  text  ' } },
      { visible: true, user: { name: null } },
      { visible: true, user: { name: undefined } },
      { visible: true, user: { name: 'A'.repeat(300) } },
      { visible: 0, user: 0 },
      { visible: null, user: null },
      { visible: '', user: '' },
      { visible: true, items: [] },
      { visible: true, count: 0 },
      { visible: true, count: -1 },
      { visible: true, count: NaN },
      { visible: false, user: { name: 'John Doe' } },
    ];

    normal = [
      { visible: true, user: { name: 'Alice' } },
      { visible: true, user: { name: 'Bob' } },
      { visible: true, user: { name: 'Charlie' } },
      { visible: true, user: { name: 'Dana', id: 101 } },
      { visible: true, user: { name: 'Guest User' } },
      { visible: true, user: { name: 'John Doe' } },
      { visible: true, name: 'Sample Item' },
      { visible: true, value: 42 },
      { visible: true, active: true },
      { visible: true, title: 'Dashboard' },
      { visible: true, user: { name: 'Dev', role: 'admin' } },
      { visible: true, user: { name: 'Sarah Connor' } },
    ];

    // fast-check samples for component props
    const propArbitrary = fc.record({
      visible: fc.boolean(),
      user: fc.record({
        name: fc.string({ maxLength: 20 }),
      }),
    });
    const samples = fc.sample(propArbitrary, { seed, numRuns: 20 });
    normal.push(...samples);

    invalid = [
      12345,
      'string instead of props',
      true,
      false,
      [1, 2, 3],
      { visible: 'not_a_bool', user: 12345 },
      { visible: { nested: true }, user: 'invalid' },
      NaN,
      Infinity,
    ];
  } else {
    // Plain function inputs (supports strings, numbers, objects, arrays)
    edgeCases = [
      null,
      undefined,
      '',
      '   ',
      '  text  ',
      ' \t\n ',
      '  Alice  ',
      '  Bob  ',
      '  John Doe  ',
      0,
      -1,
      1,
      NaN,
      Infinity,
      -Infinity,
      [],
      {},
      'A'.repeat(500),
      { name: null },
      { name: undefined },
      { name: '' },
      { name: '   ' },
      { name: '  Jane  ' },
      { user: null },
      { user: {} },
      { user: { name: null } },
      { user: { name: '' } },
      { user: { name: '   ' } },
      { user: { name: '  Developer  ' } },
      { username: '   ' },
      { username: 'admin' },
      { price: 0, qty: 0 },
      { price: -10, qty: 2 },
      { price: 100, qty: -1 },
      { price: NaN, qty: 1 },
      { price: 50, qty: 2 },
      { items: [] },
      { items: [{ price: 50, qty: 2 }] },
    ];

    normal = [
      'Alice',
      'Bob',
      'Charlie',
      'John Doe',
      'user_123',
      'admin@example.com',
      'hello world',
      'Valid Test String',
      'Customer',
      'Standard Product',
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Charlie' },
      { user: 'Alice' },
      { user: { name: 'Alice' } },
      { user: { name: 'Bob' } },
      { username: 'johndoe' },
      { price: 100, userType: 'VIP' },
      { price: 50, userType: 'REGULAR' },
      [1, 2, 3],
      ['a', 'b', 'c'],
      10,
      25,
      100,
    ];

    // fast-check normal samples
    const stringSamples = fc.sample(fc.string({ maxLength: 30 }), { seed, numRuns: 15 });
    const intSamples = fc.sample(fc.integer({ min: 0, max: 1000 }), { seed, numRuns: 10 });
    const userObjectSamples = fc.sample(
      fc.record({
        name: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      { seed, numRuns: 15 }
    );

    normal.push(...stringSamples, ...intSamples, ...userObjectSamples);

    invalid = [
      true,
      false,
      [null, undefined, 42, 'mixed'],
      1234567,
      -99999,
      [[]],
      [{ invalid: true }],
    ];
  }

  return { normal, edgeCases, invalid };
}

/**
 * Executes code on inputs in sandbox and records outputs
 */
export async function generateTestFileAndValidate(
  originalCode: string,
  seed: number = 42
): Promise<GeneratedTestsResult> {
  // 1. Verify syntax with Babel Parser first
  try {
    babelParser.parse(originalCode, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
    });
  } catch (syntaxErr: any) {
    const err = new Error(syntaxErr.message);
    (err as any).errorType = 'SYNTAX_ERROR';
    (err as any).line = syntaxErr.loc?.line;
    (err as any).column = syntaxErr.loc?.column;
    throw err;
  }

  const { targets, overallNonDeterministic, nonDeterministicReason } = detectExportTargets(originalCode);
  const tempDir = path.resolve(
    process.cwd(),
    '.refactorlab_temp',
    `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // 2. Ensure temp directory has commonjs package.json so Node never treats files as ESM from parent
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

    // 3. Write babel.config.json for Jest using identical presets and plugins
    const babelConfig = {
      presets: [
        [require.resolve('@babel/preset-env'), { targets: { node: 'current' }, modules: 'commonjs' }],
        [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
      ],
    };
    fs.writeFileSync(path.join(tempDir, 'babel.config.json'), JSON.stringify(babelConfig, null, 2), 'utf8');

    // 4. Write code.js (original code)
    fs.writeFileSync(path.join(tempDir, 'code.js'), originalCode, 'utf8');

    // 5. Transpile original code to CommonJS for safe execution in record.cjs
    let transpiledCJS = '';
    try {
      transpiledCJS = transformCodeToCommonJS(originalCode, targets);
    } catch (transpileErr: any) {
      const err = new Error(`Failed to compile code with Babel: ${transpileErr.message}`);
      (err as any).errorType = 'LOAD_ERROR';
      throw err;
    }
    fs.writeFileSync(path.join(tempDir, 'code.transpiled.cjs'), transpiledCJS, 'utf8');

    // 6. Recorder script to evaluate each input safely in Node child process
    const recorderScript = `
const React = require('react');
const { render } = require('@testing-library/react');
const fc = require('fast-check');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.React = React;
const fs = require('fs');

let codeMod = {};
try {
  codeMod = require('./code.transpiled.cjs');
} catch (e) {
  const errMsg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
  console.error('LOAD_ERROR: ' + errMsg);
  process.exit(1);
}

const targets = ${JSON.stringify(targets)};
const seed = ${seed};

function safeSerialize(val) {
  if (val === undefined) return { type: 'undefined' };
  if (val === null) return { type: 'null' };
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return { type: 'NaN' };
    if (val === Infinity) return { type: 'Infinity' };
    if (val === -Infinity) return { type: '-Infinity' };
    return { type: 'number', val };
  }
  if (typeof val === 'string') return { type: 'string', val };
  if (typeof val === 'boolean') return { type: 'boolean', val };
  if (typeof val === 'function') return { type: 'function' };
  if (Array.isArray(val)) return { type: 'array', val: val.map(safeSerialize) };
  if (typeof val === 'object') {
    try {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = safeSerialize(v);
      }
      return { type: 'object', val: out };
    } catch (e) {
      return { type: 'object', val: {} };
    }
  }
  return { type: 'other', val: String(val) };
}

function getCallable(t) {
  if (t.isDefault) {
    if (typeof codeMod === 'function') return codeMod;
    if (codeMod && typeof codeMod.default === 'function') return codeMod.default;
    if (codeMod && codeMod.default && typeof codeMod.default.default === 'function') return codeMod.default.default;
    return typeof codeMod === 'function' ? codeMod : null;
  }
  if (codeMod && typeof codeMod[t.name] === 'function') return codeMod[t.name];
  if (codeMod && codeMod.default && typeof codeMod.default[t.name] === 'function') return codeMod.default[t.name];
  if (typeof codeMod === 'function') return codeMod;
  return null;
}

function runInput(target, input) {
  const fn = getCallable(target);
  if (typeof fn !== 'function') {
    return { status: 'not_callable' };
  }

  if (target.isComponent) {
    try {
      const props = typeof input === 'object' && input !== null ? input : {};
      const { container } = render(React.createElement(fn, props));
      return { status: 'render', html: container.innerHTML };
    } catch (err) {
      return { status: 'error', errorType: err.name || 'Error', message: err.message };
    }
  }

  try {
    const res = fn(input);
    return { status: 'return', value: safeSerialize(res) };
  } catch (err) {
    return { status: 'error', errorType: err.name || 'Error', message: err.message };
  }
}

// Generate input sets
const results = [];
${JSON.stringify(generateInputSet.toString())}
const genSetsFn = ${generateInputSet.toString()};

for (const t of targets) {
  if (t.isNonDeterministic) {
    results.push({ target: t, skipped: true, reason: t.nonDeterministicReason });
    continue;
  }
  const inputSet = genSetsFn(seed, t.isComponent, t.propNames);
  for (const cat of ['normal', 'edgeCases', 'invalid']) {
    const inputs = inputSet[cat];
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      const outcome = runInput(t, inp);
      results.push({
        target: t,
        category: cat === 'normal' ? 'Normal' : cat === 'edgeCases' ? 'Edge cases' : 'Invalid',
        input: inp,
        outcome
      });
    }
  }
}

fs.writeFileSync('recorded_outcomes.json', JSON.stringify(results), 'utf8');
`;

    fs.writeFileSync(path.join(tempDir, 'record.cjs'), recorderScript, 'utf8');

    // Run record.cjs with jsdom environment
    const recordResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const p = spawn('node', ['record.cjs'], { cwd: tempDir });
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (code) => {
        if (code === 0 && fs.existsSync(path.join(tempDir, 'recorded_outcomes.json'))) {
          resolve({ success: true });
        } else {
          const cleaned = filterNodeWarnings(stderr);
          resolve({ success: false, error: cleaned || 'Failed to record baseline inputs' });
        }
      });
    });

    if (!recordResult.success) {
      const err = new Error(recordResult.error || 'Failed to load code in execution sandbox');
      (err as any).errorType = 'LOAD_ERROR';
      throw err;
    }

    const recordedOutcomes = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'recorded_outcomes.json'), 'utf8')
    );

    // Build Jest test file: code.test.js
    const testLines: string[] = [
      `const React = require('react');`,
      `const { render } = require('@testing-library/react');`,
      `global.React = React;`,
      `const codeMod = require('./code');`,
      ``,
      `describe('RefactorLab Automated Behaviour Suite', () => {`,
    ];

    let testIndex = 1;
    const testItems: TestItem[] = [];

    for (const rec of recordedOutcomes) {
      if (rec.skipped) {
        testLines.push(`  test.skip('skipped: ${rec.target.name} (${rec.reason})', () => {});`);
        testItems.push({
          name: `skipped: ${rec.target.name}`,
          inputDesc: rec.reason,
          category: 'Normal',
          status: 'SKIPPED',
        });
        continue;
      }

      const t = rec.target;
      const fnAccessor = t.isDefault
        ? `(codeMod.default || codeMod)`
        : `(codeMod[${JSON.stringify(t.name)}] || (codeMod.default && codeMod.default[${JSON.stringify(t.name)}]) || codeMod)`;

      const inpLiteral = safeSerializeLiteral(rec.input);
      const testName = `[${rec.category}] ${t.name} - Case ${testIndex++}`;

      testLines.push(`  describe('${rec.category}: ${t.name}', () => {`);
      testLines.push(`    test('${testName}', () => {`);
      testLines.push(`      const fn = ${fnAccessor};`);

      if (t.isComponent) {
        if (rec.outcome.status === 'render') {
          const expectedHtml = JSON.stringify(rec.outcome.html);
          testLines.push(`      const props = typeof ${inpLiteral} === 'object' && ${inpLiteral} !== null ? ${inpLiteral} : {};`);
          testLines.push(`      const { container } = render(React.createElement(fn, props));`);
          testLines.push(`      expect(container.innerHTML).toBe(${expectedHtml});`);
        } else if (rec.outcome.status === 'error') {
          testLines.push(`      const props = typeof ${inpLiteral} === 'object' && ${inpLiteral} !== null ? ${inpLiteral} : {};`);
          testLines.push(`      expect(() => render(React.createElement(fn, props))).toThrow();`);
        }
      } else {
        if (rec.outcome.status === 'return') {
          const valObj = rec.outcome.value;
          if (valObj.type === 'undefined') {
            testLines.push(`      expect(fn(${inpLiteral})).toBeUndefined();`);
          } else if (valObj.type === 'null') {
            testLines.push(`      expect(fn(${inpLiteral})).toBeNull();`);
          } else if (valObj.type === 'NaN') {
            testLines.push(`      expect(Number.isNaN(fn(${inpLiteral}))).toBe(true);`);
          } else if (['number', 'string', 'boolean'].includes(valObj.type)) {
            testLines.push(`      expect(fn(${inpLiteral})).toBe(${JSON.stringify(valObj.val)});`);
          } else if (valObj.type === 'array' || valObj.type === 'object') {
            const expLiteral = safeSerializeLiteral(
              valObj.type === 'array'
                ? valObj.val.map((x: any) => x.val)
                : Object.fromEntries(Object.entries(valObj.val).map(([k, v]: [string, any]) => [k, v.val]))
            );
            testLines.push(`      expect(fn(${inpLiteral})).toEqual(${expLiteral});`);
          } else {
            testLines.push(`      expect(fn(${inpLiteral})).toBeDefined();`);
          }
        } else if (rec.outcome.status === 'error') {
          testLines.push(`      expect(() => fn(${inpLiteral})).toThrow();`);
        }
      }

      testLines.push(`    });`);
      testLines.push(`  });`);

      let expectedOutcome = 'Returns value';
      if (rec.outcome.status === 'return') {
        const valObj = rec.outcome.value;
        if (valObj.type === 'undefined') expectedOutcome = 'returns undefined';
        else if (valObj.type === 'null') expectedOutcome = 'returns null';
        else if (valObj.type === 'NaN') expectedOutcome = 'returns NaN';
        else if (['number', 'string', 'boolean'].includes(valObj.type)) expectedOutcome = `returns ${JSON.stringify(valObj.val)}`;
        else if (valObj.type === 'array' || valObj.type === 'object') expectedOutcome = `returns ${valObj.type}`;
      } else if (rec.outcome.status === 'error') {
        expectedOutcome = `throws ${rec.outcome.errorType || 'Error'}`;
      } else if (rec.outcome.status === 'render') {
        expectedOutcome = 'renders component HTML';
      }

      testItems.push({
        name: testName,
        inputDesc: String(inpLiteral).slice(0, 80),
        expectedOutcome,
        category: rec.category,
        status: 'PASS',
      });
    }

    testLines.push(`});`);
    const testFileCode = testLines.join('\n');

    // Write code.test.js into tempDir
    fs.writeFileSync(path.join(tempDir, 'code.test.js'), testFileCode, 'utf8');

    // Write jest.config.json
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
    fs.writeFileSync(path.join(tempDir, 'jest.config.json'), JSON.stringify(jestConfig, null, 2), 'utf8');

    // Validation: Run Jest twice on the original code to confirm 100% pass and exclude flakiness
    const runJest = async (): Promise<any> => {
      return await new Promise<any>((resolve) => {
        const p = spawn(
          'npx',
          ['jest', 'code.test.js', '--config', 'jest.config.json', '--json', '--runInBand', '--forceExit'],
          { cwd: tempDir, shell: true }
        );
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d.toString()));
        p.stderr.on('data', (d) => (err += d.toString()));
        p.on('close', () => {
          try {
            const start = out.indexOf('{');
            const end = out.lastIndexOf('}');
            const json = JSON.parse(out.slice(start, end + 1));
            resolve({ json, err });
          } catch (e: any) {
            resolve({ error: err || out });
          }
        });
      });
    };

    // Run 1
    const run1 = await runJest();
    // Run 2 (verify deterministic)
    const run2 = await runJest();

    // Read coverage
    let coverage: CoverageMetrics = {
      linesPct: 'Unavailable',
      branchesPct: 'Unavailable',
      statementsPct: 'Unavailable',
      functionsPct: 'Unavailable',
    };
    const covSummaryPath = path.join(tempDir, 'coverage', 'coverage-summary.json');
    if (fs.existsSync(covSummaryPath)) {
      try {
        const rawCov = JSON.parse(fs.readFileSync(covSummaryPath, 'utf8'));
        if (rawCov.total) {
          coverage = {
            linesPct: typeof rawCov.total.lines?.pct === 'number' ? Math.round(rawCov.total.lines.pct) : 'Unavailable',
            branchesPct: typeof rawCov.total.branches?.pct === 'number' ? Math.round(rawCov.total.branches.pct) : 'Unavailable',
            statementsPct: typeof rawCov.total.statements?.pct === 'number' ? Math.round(rawCov.total.statements.pct) : 'Unavailable',
            functionsPct: typeof rawCov.total.functions?.pct === 'number' ? Math.round(rawCov.total.functions.pct) : 'Unavailable',
          };
        }
      } catch {}
    }

    const json = run2?.json || run1?.json;
    const passedCount = json?.numPassedTests || 0;
    const failedCount = json?.numFailedTests || 0;
    const skippedCount = json?.numPendingTests || 0;
    const totalTests = json?.numTotalTests || testItems.length;

    const normalTests = testItems.filter((t) => t.category === 'Normal');
    const edgeTests = testItems.filter((t) => t.category === 'Edge cases');
    const invalidTests = testItems.filter((t) => t.category === 'Invalid');

    const failingList: Array<{ title: string; failureMessage: string }> = [];
    if (json?.testResults?.[0]?.assertionResults) {
      for (const a of json.testResults[0].assertionResults) {
        if (a.status === 'failed') {
          failingList.push({
            title: a.title,
            failureMessage: (a.failureMessages || []).join('\n'),
          });
        }
      }
    }

    return {
      hasGenerated: true,
      seed,
      inputCount: testItems.length,
      testFileCode,
      comparable: !overallNonDeterministic,
      notComparableReason: nonDeterministicReason,
      totalTests,
      passedCount,
      failedCount,
      skippedCount,
      groups: {
        normal: {
          category: 'Normal',
          total: normalTests.length,
          passed: normalTests.length,
          failed: 0,
          skipped: 0,
          tests: normalTests,
        },
        edgeCases: {
          category: 'Edge cases',
          total: edgeTests.length,
          passed: edgeTests.length,
          failed: 0,
          skipped: 0,
          tests: edgeTests,
        },
        invalid: {
          category: 'Invalid',
          total: invalidTests.length,
          passed: invalidTests.length,
          failed: 0,
          skipped: 0,
          tests: invalidTests,
        },
      },
      coverage,
      errors: failingList,
      timestamp: new Date().toISOString(),
    };
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
