// @ts-ignore
import * as babelParser from '@babel/parser';

export interface ExportAnalysis {
  exports: string[];
  hasDefault: boolean;
  parseError?: string;
}

export interface SafetyCheckResult {
  isValid: boolean;
  invalidReason?: string;
  hasCompileError: boolean;
  compileErrorMessage?: string;
  originalExports: string[];
  refactoredExports: string[];
  missingExports: string[];
  interfaceStatus: 'Same' | 'Changed';
  interfaceMessage: string;
  originalLineCount: number;
  refactoredLineCount: number;
}

/**
 * Strips accidental markdown backticks from AI responses
 */
export function sanitizeCode(code: string): string {
  if (!code) return '';
  let cleaned = code.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:javascript|js|typescript|ts|jsx|tsx)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

/**
 * Detects truncated or lazy placeholder responses
 */
export function detectPlaceholders(code: string): { hasPlaceholder: boolean; matched?: string } {
  const patterns = [
    /\/\/\s*rest\s+of\s+(the\s+)?code/i,
    /\/\/\s*rest\s+unchanged/i,
    /\/\/\s*unchanged/i,
    /\/\/\s*\.{3,}/,
    /^\s*\/\*\s*\.{3,}\s*\*\/\s*$/m,
    /\/\/\s*existing\s+code\s+(here|goes\s+here)?/i,
    /\/\*\s*existing\s+code\s+(here|goes\s+here)?\s*\*\//i,
    /\/\/\s*same\s+as\s+before/i,
    /\/\/\s*code\s+remains\s+the\s+same/i,
  ];

  for (const pat of patterns) {
    const match = code.match(pat);
    if (match) {
      return { hasPlaceholder: true, matched: match[0] };
    }
  }

  return { hasPlaceholder: false };
}

/**
 * Extracts named and default exports using Babel parser (supports CJS and ESM)
 */
export function extractExports(code: string): ExportAnalysis {
  const exports = new Set<string>();
  let hasDefault = false;

  try {
    const ast = babelParser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
    });

    for (const node of ast.program.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          if (node.declaration.type === 'VariableDeclaration' && node.declaration.declarations) {
            for (const d of node.declaration.declarations) {
              if (d.id && d.id.type === 'Identifier') {
                exports.add(d.id.name);
              }
            }
          } else if (
            (node.declaration.type === 'FunctionDeclaration' ||
              node.declaration.type === 'ClassDeclaration') &&
            node.declaration.id
          ) {
            exports.add(node.declaration.id.name);
          }
        }
        if (node.specifiers) {
          for (const s of node.specifiers) {
            if (s.type === 'ExportSpecifier' && s.exported) {
              const name = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value;
              if (name) exports.add(name);
            }
          }
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        hasDefault = true;
        exports.add('default');
      } else if (node.type === 'ExpressionStatement') {
        const expr = node.expression;
        if (expr.type === 'AssignmentExpression' && expr.left) {
          const left = expr.left;
          if (left.type === 'MemberExpression') {
            const obj = left.object;
            const prop = left.property;

            // module.exports = { ... } or module.exports = identifier
            if (obj.type === 'Identifier' && obj.name === 'module' && prop.type === 'Identifier' && prop.name === 'exports') {
              if (expr.right.type === 'ObjectExpression') {
                for (const p of expr.right.properties) {
                  if (p.type === 'ObjectProperty' && p.key) {
                    const kName = p.key.type === 'Identifier' ? p.key.name : (p.key as any).value;
                    if (kName) exports.add(kName);
                  } else if (p.type === 'ObjectMethod' && p.key) {
                    const kName = p.key.type === 'Identifier' ? p.key.name : (p.key as any).value;
                    if (kName) exports.add(kName);
                  }
                }
              } else if (expr.right.type === 'Identifier') {
                exports.add(expr.right.name);
              } else {
                hasDefault = true;
                exports.add('default');
              }
            }
            // module.exports.foo = ...
            else if (
              obj.type === 'MemberExpression' &&
              obj.object.type === 'Identifier' &&
              obj.object.name === 'module' &&
              obj.property.type === 'Identifier' &&
              obj.property.name === 'exports' &&
              prop.type === 'Identifier'
            ) {
              exports.add(prop.name);
            }
            // exports.foo = ...
            else if (obj.type === 'Identifier' && obj.name === 'exports' && prop.type === 'Identifier') {
              exports.add(prop.name);
            }
          }
        }
      }
    }

    return {
      exports: Array.from(exports).sort(),
      hasDefault,
    };
  } catch (err: any) {
    return {
      exports: [],
      hasDefault: false,
      parseError: err.message,
    };
  }
}

/**
 * Perform all safety checks on refactored code against original code
 */
export function performSafetyChecks(
  originalCode: string,
  refactoredCode: string
): SafetyCheckResult {
  const sanitized = sanitizeCode(refactoredCode);
  const origSanitized = sanitizeCode(originalCode);

  const origLines = origSanitized ? origSanitized.split(/\r?\n/).length : 0;
  const refacLines = sanitized ? sanitized.split(/\r?\n/).length : 0;

  // 1. Placeholder check
  const placeholderCheck = detectPlaceholders(sanitized);
  let isValid = true;
  let invalidReason: string | undefined;

  if (placeholderCheck.hasPlaceholder) {
    isValid = false;
    invalidReason = `Contains lazy placeholder: "${placeholderCheck.matched}"`;
  }

  // 2. Parse check with Babel
  let hasCompileError = false;
  let compileErrorMessage: string | undefined;
  try {
    babelParser.parse(sanitized, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
    });
  } catch (err: any) {
    hasCompileError = true;
    compileErrorMessage = `Code could not be compiled: ${err.message}`;
    isValid = false;
    if (!invalidReason) {
      invalidReason = compileErrorMessage;
    }
  }

  // 3. Export comparison
  const origExportsAnalysis = extractExports(origSanitized);
  const refacExportsAnalysis = extractExports(sanitized);

  const origExports = origExportsAnalysis.exports;
  const refacExports = refacExportsAnalysis.exports;

  // Find missing exports (if original had exports defined)
  const missingExports = origExports.filter((exp) => !refacExports.includes(exp));

  let interfaceStatus: 'Same' | 'Changed' = 'Same';
  let interfaceMessage = 'Public interface preserved';

  if (origExports.length > 0 && missingExports.length > 0) {
    interfaceStatus = 'Changed';
    interfaceMessage = `Public interface changed: missing ${missingExports.join(', ')}`;
  }

  return {
    isValid,
    invalidReason,
    hasCompileError,
    compileErrorMessage,
    originalExports: origExports,
    refactoredExports: refacExports,
    missingExports,
    interfaceStatus,
    interfaceMessage,
    originalLineCount: origLines,
    refactoredLineCount: refacLines,
  };
}
