import escomplex from 'typhonjs-escomplex';
import * as babelParser from '@babel/parser';
import * as Diff from 'diff';

describe('RefactorLab Enhanced Verification Suite', () => {
  test('calculates cyclomatic complexity and maintainability index correctly', () => {
    const code = `
      function calculateDiscount(price, customerType) {
        if (price <= 0) return 0;
        if (customerType === 'VIP') return price * 0.8;
        if (customerType === 'REGULAR') return price * 0.95;
        return price;
      }
      module.exports = { calculateDiscount };
    `;
    const report = escomplex.analyzeModule(code);
    expect(report).toBeDefined();
    expect(report.aggregate.cyclomatic).toBeGreaterThan(1);
    expect(report.maintainability).toBeGreaterThan(0);
  });

  test('detects truncated or lazy placeholder responses', () => {
    function detectPlaceholders(code) {
      const patterns = [
        /\/\/\s*rest\s+of\s+(the\s+)?code/i,
        /\/\/\s*rest\s+unchanged/i,
        /\/\/\s*unchanged/i,
        /\/\/\s*\.{3,}/,
        /^\s*\/\*\s*\.{3,}\s*\*\/\s*$/m,
        /\/\/\s*existing\s+code\s+(here|goes\s+here)?/i,
        /\/\*\s*existing\s+code\s+(here|goes\s+here)?\s*\*\//i,
      ];
      for (const pat of patterns) {
        if (pat.test(code)) return true;
      }
      return false;
    }

    expect(detectPlaceholders('function foo() {}\n// rest unchanged')).toBe(true);
    expect(detectPlaceholders('function foo() {}\n// ...')).toBe(true);
    expect(detectPlaceholders('function foo() {}\n/* ... */')).toBe(true);
    expect(detectPlaceholders('function foo() {}\n// existing code here')).toBe(true);
    expect(detectPlaceholders('function foo() { return 42; } module.exports = { foo };')).toBe(false);
  });

  test('compares public interface and detects missing or renamed exports', () => {
    function extractExports(code) {
      const exports = new Set();
      const ast = babelParser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx'] });
      for (const node of ast.program.body) {
        if (node.type === 'ExportNamedDeclaration') {
          if (node.declaration && node.declaration.id) exports.add(node.declaration.id.name);
          if (node.specifiers) {
            for (const s of node.specifiers) {
              if (s.exported) exports.add(s.exported.name || s.exported.value);
            }
          }
        } else if (node.type === 'ExportDefaultDeclaration') {
          exports.add('default');
        } else if (node.type === 'ExpressionStatement') {
          const expr = node.expression;
          if (expr.type === 'AssignmentExpression' && expr.left?.object?.name === 'module' && expr.left?.property?.name === 'exports') {
            if (expr.right.type === 'ObjectExpression') {
              for (const p of expr.right.properties) {
                if (p.key) exports.add(p.key.name || p.key.value);
              }
            }
          }
        }
      }
      return Array.from(exports).sort();
    }

    const origCode = 'function a() {} function b() {} module.exports = { a, b };';
    const refacCodeMissing = 'function a() {} module.exports = { a };';
    const refacCodePreserved = 'export function a() {} export function b() {}';

    const origExp = extractExports(origCode);
    const missingExp = origExp.filter((e) => !extractExports(refacCodeMissing).includes(e));
    const preservedMissing = origExp.filter((e) => !extractExports(refacCodePreserved).includes(e));

    expect(missingExp).toEqual(['b']);
    expect(preservedMissing).toEqual([]);
  });

  test('computes code difference lines accurately with diff library', () => {
    const orig = 'line 1\nline 2\nline 3';
    const refac = 'line 1\nline 2 modified\nline 3';
    const diff = Diff.diffLines(orig, refac);
    expect(diff.length).toBeGreaterThan(1);
    expect(diff.some((d) => d.added)).toBe(true);
    expect(diff.some((d) => d.removed)).toBe(true);
  });

  test('determines best model logic requiring unchanged interface and test pass', () => {
    function evaluate(models) {
      const keys = ['chatgpt', 'claude', 'gemini'];
      const missing = keys.filter(
        (k) => !models[k] || models[k].status === 'not_run' || !models[k].result
      );
      if (missing.length > 0) return { winner: null, reason: 'incomplete' };

      const passing = keys
        .map((k) => ({
          key: k,
          passed: models[k].result.status === 'PASS',
          interfaceSame: models[k].result.publicInterface === 'Same',
          errors: models[k].result.eslintErrors,
          maint: models[k].result.metrics.maintainability,
        }))
        .filter((m) => m.passed && m.interfaceSame);

      if (passing.length === 0) return { winner: null, reason: 'no passing models with same interface' };
      if (passing.length === 1) return { winner: passing[0].key, reason: 'sole passing model' };

      const best = passing.filter((candidate) =>
        passing.every(
          (o) =>
            candidate.key === o.key ||
            (candidate.errors <= o.errors && candidate.maint >= o.maint)
        )
      );

      if (best.length === 1) return { winner: best[0].key };
      return { winner: null, reason: 'tied' };
    }

    const evalResult = evaluate({
      chatgpt: { status: 'PASS', result: { status: 'PASS', publicInterface: 'Changed', eslintErrors: 0, metrics: { maintainability: 150 } } },
      claude: { status: 'PASS', result: { status: 'PASS', publicInterface: 'Same', eslintErrors: 1, metrics: { maintainability: 140 } } },
      gemini: { status: 'FAIL', result: { status: 'FAIL', publicInterface: 'Same', eslintErrors: 0, metrics: { maintainability: 130 } } },
    });

    expect(evalResult.winner).toBe('claude');
  });

  test('filterNodeWarnings correctly removes node warnings without deleting error traces', () => {
    function filterNodeWarnings(str) {
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

    const outputWithWarning = [
      '(node:3441) ExperimentalWarning: VM Modules is an experimental feature and might change at any time',
      'Use `node --trace-warnings ...` to show where the warning was created',
      'TypeError: Cannot read properties of null (reading "name")',
      '    at getDisplayName (/app/code.js:2:10)',
    ].join('\n');

    const cleaned = filterNodeWarnings(outputWithWarning);
    expect(cleaned).not.toContain('ExperimentalWarning');
    expect(cleaned).not.toContain('--trace-warnings');
    expect(cleaned).toContain('TypeError: Cannot read properties of null');
  });

  test('babelParser captures line and column on syntax errors', () => {
    const invalidSyntax = 'export function foo() {\n  return 1 +\n}';
    let caughtErr = null;
    try {
      babelParser.parse(invalidSyntax, { sourceType: 'unambiguous', plugins: ['jsx'] });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).not.toBeNull();
    expect(caughtErr.loc.line).toBe(3);
    expect(typeof caughtErr.loc.column).toBe('number');
  });
});
