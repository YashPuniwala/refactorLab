export interface FailureExplanation {
  testTitle: string;
  category:
    | 'RETURN_VALUE_MISMATCH'
    | 'UNEXPECTED_EXCEPTION'
    | 'MISSING_EXCEPTION'
    | 'INTERFACE_CHANGED'
    | 'TYPE_MISMATCH'
    | 'TIMEOUT'
    | 'SYNTAX_OR_LOAD_FAILURE';
  plainEnglishExplanation: string;
  expectedBehavior: string;
  actualBehavior: string;
  inputDescription?: string;
  interpretation: string;
  recommendedAction: string;
}

/**
 * Parses Jest failure messages and test titles into plain, accessible English
 */
export function explainFailure(
  title: string,
  failureMessage: string = '',
  input?: any
): FailureExplanation {
  const msg = failureMessage || '';

  // Check for expected vs received pattern in Jest
  const expectedMatch = msg.match(/Expected:\s*([\s\S]*?)\n\s*Received:\s*([\s\S]*?)(?:\n|$)/);
  let expectedStr = expectedMatch ? expectedMatch[1].trim() : 'Unknown';
  let receivedStr = expectedMatch ? expectedMatch[2].trim() : 'Unknown';

  // Check if an exception was thrown when not expected
  if (msg.includes('toThrow') && msg.includes('Received function did not throw')) {
    return {
      testTitle: title,
      category: 'MISSING_EXCEPTION',
      plainEnglishExplanation:
        'The original code threw an error or exception for this input, but the refactored code did not throw.',
      expectedBehavior: 'An error should have been thrown.',
      actualBehavior: 'Executed without throwing any error.',
      inputDescription: input !== undefined ? JSON.stringify(input) : undefined,
      interpretation:
        'The refactored code softened error handling or swallowed an exception that callers may rely on.',
      recommendedAction:
        'Restore the exception condition or check input validation logic.',
    };
  }

  if (
    msg.includes('threw') ||
    msg.includes('TypeError:') ||
    msg.includes('ReferenceError:') ||
    (msg.includes('toThrow') && msg.includes('Expected the function to throw'))
  ) {
    return {
      testTitle: title,
      category: 'UNEXPECTED_EXCEPTION',
      plainEnglishExplanation:
        'The refactored code crashed or threw an unexpected exception during this test.',
      expectedBehavior: 'Function should return a valid result without throwing.',
      actualBehavior: `Threw an error: ${msg.split('\n')[0]}`,
      inputDescription: input !== undefined ? JSON.stringify(input) : undefined,
      interpretation:
        'The refactored code has an unhandled null pointer, missing property check, or type assumption.',
      recommendedAction:
        'Add guard clauses or null checks to protect against unexpected inputs.',
    };
  }

  if (msg.includes('Timeout') || msg.includes('timed out')) {
    return {
      testTitle: title,
      category: 'TIMEOUT',
      plainEnglishExplanation:
        'The test timed out before completion, likely caused by an infinite loop or unhandled asynchronous call.',
      expectedBehavior: 'Function must return within the execution timeout.',
      actualBehavior: 'Execution timed out.',
      interpretation:
        'A while loop, recursive step, or unresolved promise is blocking execution.',
      recommendedAction:
        'Inspect iteration conditions and loop counters for termination conditions.',
    };
  }

  if (msg.includes('is not a function') || msg.includes('is not exported')) {
    return {
      testTitle: title,
      category: 'INTERFACE_CHANGED',
      plainEnglishExplanation:
        'The refactored code modified or omitted an expected export, function name, or method signature.',
      expectedBehavior: 'Original function export and signature must remain callable.',
      actualBehavior: 'Function or export was missing or not callable.',
      interpretation:
        'Public contract was broken. Calling systems will fail with TypeError.',
      recommendedAction:
        'Ensure all named and default exports match the original code verbatim.',
    };
  }

  // Type mismatch check
  if (
    (expectedStr.startsWith('"') && !receivedStr.startsWith('"')) ||
    (!isNaN(Number(expectedStr)) && isNaN(Number(receivedStr))) ||
    (expectedStr === 'undefined' && receivedStr !== 'undefined')
  ) {
    return {
      testTitle: title,
      category: 'TYPE_MISMATCH',
      plainEnglishExplanation: `Expected a return value of type matching ${expectedStr}, but received ${receivedStr}.`,
      expectedBehavior: `Expected: ${expectedStr}`,
      actualBehavior: `Received: ${receivedStr}`,
      inputDescription: input !== undefined ? JSON.stringify(input) : undefined,
      interpretation:
        'The refactored code altered the return type contract (e.g. returning undefined or an object instead of string/number).',
      recommendedAction:
        'Verify return statements and ensure identical fallback return types.',
    };
  }

  // General return value mismatch
  if (expectedMatch) {
    return {
      testTitle: title,
      category: 'RETURN_VALUE_MISMATCH',
      plainEnglishExplanation: `When evaluated on this test case, the refactored code returned ${receivedStr} instead of the expected ${expectedStr}.`,
      expectedBehavior: expectedStr,
      actualBehavior: receivedStr,
      inputDescription: input !== undefined ? JSON.stringify(input) : undefined,
      interpretation:
        'The business logic produced an observable difference in output for this specific input.',
      recommendedAction:
        'Review the conditional logic and edge case handling in the refactored function.',
    };
  }

  // Fallback explanation
  return {
    testTitle: title,
    category: 'RETURN_VALUE_MISMATCH',
    plainEnglishExplanation: `Test "${title}" failed. The output or behavior deviated from the original code specification.`,
    expectedBehavior: 'Match original code behavior',
    actualBehavior: msg.slice(0, 150) || 'Test assertion failed',
    inputDescription: input !== undefined ? JSON.stringify(input) : undefined,
    interpretation:
      'The refactored implementation produced a behavior discrepancy detected by the test runner.',
    recommendedAction:
      'Check the test assertions and compare edge-case logic with the original code.',
  };
}
