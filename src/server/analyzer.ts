// @ts-ignore
import escomplex from 'typhonjs-escomplex';
import { ESLint } from 'eslint';
import * as Diff from 'diff';

export interface CodeMetrics {
  cyclomatic: number | 'Unavailable';
  maintainability: number | 'Unavailable';
  duplication:
    | {
        duplicateLines: number;
        totalLines: number;
        percentage: string;
      }
    | 'Unavailable';
}

export interface LineDiffChunk {
  value: string;
  added?: boolean;
  removed?: boolean;
  count?: number;
}

export function computeCodeDiff(originalCode: string, refactoredCode: string): LineDiffChunk[] {
  try {
    return Diff.diffLines(originalCode || '', refactoredCode || '');
  } catch {
    return [];
  }
}

export function calculateDuplicateLines(code: string):
  | { duplicateLines: number; totalLines: number; percentage: string }
  | 'Unavailable' {
  if (typeof code !== 'string') return 'Unavailable';
  try {
    const lines = code
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => {
        if (!l) return false;
        if (l.startsWith('//') || l.startsWith('/*') || l.startsWith('*')) return false;
        if (['{', '}', '};', ']', '];', '(', ')'].includes(l)) return false;
        return true;
      });

    if (lines.length === 0) {
      return { duplicateLines: 0, totalLines: 0, percentage: '0%' };
    }

    const counts: Record<string, number> = {};
    for (const line of lines) {
      counts[line] = (counts[line] || 0) + 1;
    }

    let duplicateCount = 0;
    for (const line of lines) {
      if (counts[line] > 1) {
        duplicateCount++;
      }
    }

    const pct = Math.round((duplicateCount / lines.length) * 100);
    return {
      duplicateLines: duplicateCount,
      totalLines: lines.length,
      percentage: `${pct}%`,
    };
  } catch {
    return 'Unavailable';
  }
}

export function calculateMetrics(code: string): CodeMetrics {
  let cyclomatic: number | 'Unavailable' = 'Unavailable';
  let maintainability: number | 'Unavailable' = 'Unavailable';

  try {
    if (code && typeof code === 'string' && code.trim().length > 0) {
      const report = escomplex.analyzeModule(code);
      if (report) {
        if (typeof report.aggregate?.cyclomatic === 'number') {
          cyclomatic = report.aggregate.cyclomatic;
        } else if (typeof report.cyclomatic === 'number') {
          cyclomatic = report.cyclomatic;
        }

        if (typeof report.maintainability === 'number') {
          maintainability = Math.round(report.maintainability * 10) / 10;
        }
      }
    }
  } catch {
    cyclomatic = 'Unavailable';
    maintainability = 'Unavailable';
  }

  const duplication = calculateDuplicateLines(code);

  return {
    cyclomatic,
    maintainability,
    duplication,
  };
}

export async function runESLint(code: string): Promise<{
  errors: number;
  warnings: number;
  messages: Array<{
    line: number;
    column: number;
    ruleId: string;
    message: string;
    severity: number;
  }>;
}> {
  try {
    const linter = new ESLint();
    const results = await linter.lintText(code, { filePath: 'code.jsx' });
    const firstResult = results[0];
    if (!firstResult) {
      return { errors: 0, warnings: 0, messages: [] };
    }

    const messages = firstResult.messages.map((m) => ({
      line: m.line || 0,
      column: m.column || 0,
      ruleId: m.ruleId || 'syntax-error',
      message: m.message,
      severity: m.severity,
    }));

    return {
      errors: firstResult.errorCount,
      warnings: firstResult.warningCount,
      messages,
    };
  } catch (err: any) {
    return {
      errors: 1,
      warnings: 0,
      messages: [
        {
          line: 1,
          column: 1,
          ruleId: 'linter-execution-error',
          message: err?.message || 'Failed to lint code',
          severity: 2,
        },
      ],
    };
  }
}

export function compareESLint(
  origErrors: number | 'Unavailable',
  refacErrors: number | 'Unavailable'
): 'improved' | 'worse' | 'same' | 'Unavailable' {
  if (origErrors === 'Unavailable' || refacErrors === 'Unavailable') return 'Unavailable';
  if (refacErrors < origErrors) return 'improved';
  if (refacErrors > origErrors) return 'worse';
  return 'same';
}

export function compareCyclomatic(
  orig: number | 'Unavailable',
  refactored: number | 'Unavailable'
): 'improved' | 'worse' | 'same' | 'Unavailable' {
  if (orig === 'Unavailable' || refactored === 'Unavailable') return 'Unavailable';
  if (refactored < orig) return 'improved';
  if (refactored > orig) return 'worse';
  return 'same';
}

export function compareMaintainability(
  orig: number | 'Unavailable',
  refactored: number | 'Unavailable'
): 'improved' | 'worse' | 'same' | 'Unavailable' {
  if (orig === 'Unavailable' || refactored === 'Unavailable') return 'Unavailable';
  if (refactored > orig) return 'improved';
  if (refactored < orig) return 'worse';
  return 'same';
}
