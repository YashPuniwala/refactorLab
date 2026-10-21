import { GoogleGenAI } from '@google/genai';
import { sanitizeCode, performSafetyChecks } from './safety.ts';

export interface AIRefactorRequest {
  provider: 'gemini' | 'chatgpt' | 'claude';
  originalCode: string;
  prompt: string;
  mode: 'preserve_behavior' | 'refactor_and_fix';
  apiKey?: string;
}

export interface AIRefactorResponse {
  success: boolean;
  code: string;
  rawResponse?: string;
  responseTimeSeconds: number;
  modelIdentifier: string;
  error?: string;
  safetyCheck?: {
    isValid: boolean;
    invalidReason?: string;
    interfaceStatus: 'Same' | 'Changed' | 'Unavailable';
    interfaceMessage?: string;
  };
}

/**
 * Extracts pure JavaScript code from AI markdown code blocks
 */
export function extractCodeFromResponse(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();

  // Match ```javascript ... ``` or ```jsx ... ``` or ```js ... ```
  const fenceRegex = /```(?:javascript|jsx|js|ts|tsx)?\s*([\s\S]*?)```/i;
  const match = trimmed.match(fenceRegex);
  if (match && match[1]) {
    return match[1].trim();
  }

  // If text starts with ``` and ends with ```
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }

  return trimmed;
}

/**
 * Calls selected AI provider to refactor the code
 */
export async function executeAIRefactoring(
  req: AIRefactorRequest
): Promise<AIRefactorResponse> {
  const startTime = Date.now();
  const provider = req.provider || 'gemini';

  try {
    if (provider === 'gemini') {
      const apiKey = req.apiKey || process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return {
          success: false,
          code: '',
          responseTimeSeconds: 0,
          modelIdentifier: 'gemini-3.8-flash',
          error:
            'Gemini API key is not configured. Please paste your code manually in Screen 3 or configure GEMINI_API_KEY in the Secrets panel.',
        };
      }

      const ai = new GoogleGenAI();
      const fullPrompt = `${req.prompt}

IMPORTANT INSTRUCTIONS:
- Return ONLY the complete refactored JavaScript code.
- Do NOT include markdown explanations, bullet points, or notes.
- Wrap your code in a single \`\`\`javascript code block.
- Keep all existing exports, functions, signatures, and interfaces intact.
- Never use lazy placeholders like '// rest of code'.

Original Code:
\`\`\`javascript
${req.originalCode}
\`\`\``;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: fullPrompt,
      });

      const rawText = response.text || '';
      const extracted = extractCodeFromResponse(rawText);
      const sanitized = sanitizeCode(extracted);

      const durationSec = Math.round(((Date.now() - startTime) / 1000) * 10) / 10;
      const safety = performSafetyChecks(req.originalCode, sanitized);

      return {
        success: true,
        code: sanitized,
        rawResponse: rawText,
        responseTimeSeconds: durationSec,
        modelIdentifier: 'gemini-3.8-flash',
        safetyCheck: {
          isValid: safety.isValid,
          invalidReason: safety.invalidReason,
          interfaceStatus: safety.interfaceStatus,
          interfaceMessage: safety.interfaceMessage,
        },
      };
    }

    // For ChatGPT or Claude, if no external API key is configured on server, instruct manual paste
    const durationSec = Math.round(((Date.now() - startTime) / 1000) * 10) / 10;
    return {
      success: false,
      code: '',
      responseTimeSeconds: durationSec,
      modelIdentifier: provider === 'chatgpt' ? 'gpt-4o' : 'claude-3-5-sonnet',
      error: `Direct API execution for ${provider.toUpperCase()} requires an API key. Use the Copy Prompt button and paste the response into the ${provider.toUpperCase()} box.`,
    };
  } catch (err: any) {
    const durationSec = Math.round(((Date.now() - startTime) / 1000) * 10) / 10;
    return {
      success: false,
      code: '',
      responseTimeSeconds: durationSec,
      modelIdentifier: provider === 'gemini' ? 'gemini-3.8-flash' : provider,
      error: `AI Refactoring request failed: ${err.message}`,
    };
  }
}
