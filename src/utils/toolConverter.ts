// This tool call is actually to update toolConverter.ts but I realized I need to update parameterNormalizer.ts first.
// I will just do the toolConverter update here assuming I'll fix parameterNormalizer.ts in the next turn? 
// No, I should do parameterNormalizer.ts first.
// Wait, I can't cancel a tool call. I'll use this tool call to fix toolConverter.ts imports, anticipating the location.
import { sanitizeToolName } from './parameterNormalizer.js';
import { setToolNameMapping } from './toolNameCache.js';

// Missing cleanParameters. I'll add a local helper or import it if I add it to parameterNormalizer. 
// I'll add cleanParameters to parameterNormalizer in the next step. So I'll import it from there.
import { cleanParameters } from './parameterNormalizer.js';


interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: any;
}

interface AntigravityTool {
    functionDeclarations: FunctionDeclaration[];
}

/**
 * Convert single tool definition to Antigravity format functionDeclaration
 */
function convertSingleTool(
    name: string | undefined,
    description: string | undefined,
    parameters: any,
    sessionId: string | undefined,
    actualModelName: string | undefined
): FunctionDeclaration {
    const originalName = name || '';
    const safeName = sanitizeToolName(originalName);

    if (sessionId && actualModelName && safeName !== originalName) {
        setToolNameMapping(sessionId, actualModelName, safeName, originalName);
    }

    const rawParams = parameters || {};
    const cleanedParams = cleanParameters(rawParams) || {};
    if (cleanedParams.type === undefined) cleanedParams.type = 'object';
    if (cleanedParams.type === 'object' && cleanedParams.properties === undefined) cleanedParams.properties = {};

    return {
        name: safeName,
        description: description || '',
        parameters: cleanedParams
    };
}

/**
 * Convert OpenAI format tool list to Antigravity format
 * OpenAI Format: [{ type: 'function', function: { name, description, parameters } }]
 * 
 * IMPORTANT: All function declarations must be in a single tools object
 * because the upstream API doesn't support multiple non-search tool objects.
 */
export function convertOpenAIToolsToAntigravity(
    openaiTools: any[] | undefined,
    sessionId: string | undefined,
    actualModelName: string | undefined
): AntigravityTool[] {
    if (!openaiTools || openaiTools.length === 0) return [];

    const functionDeclarations: FunctionDeclaration[] = [];

    for (const tool of openaiTools) {
        const func = tool.function || {};
        const declaration = convertSingleTool(
            func.name,
            func.description,
            func.parameters,
            sessionId,
            actualModelName
        );
        functionDeclarations.push(declaration);
    }

    // Return a single tools object with all function declarations
    return [{ functionDeclarations }];
}

/**
 * Convert Claude format tool list to Antigravity format
 * Claude Format: [{ name, description, input_schema }]
 * 
 * IMPORTANT: All function declarations must be in a single tools object
 * because the upstream API doesn't support multiple non-search tool objects.
 */
export function convertClaudeToolsToAntigravity(
    claudeTools: any[] | undefined,
    sessionId: string | undefined,
    actualModelName: string | undefined
): AntigravityTool[] {
    if (!claudeTools || claudeTools.length === 0) return [];

    const functionDeclarations: FunctionDeclaration[] = [];

    for (const tool of claudeTools) {
        const declaration = convertSingleTool(
            tool.name,
            tool.description,
            tool.input_schema,
            sessionId,
            actualModelName
        );
        functionDeclarations.push(declaration);
    }

    // Return a single tools object with all function declarations
    return [{ functionDeclarations }];
}

/**
 * Convert Gemini format tool list to Antigravity format
 * Gemini Format:
 * 1. [{ functionDeclarations: [{ name, description, parameters }] }]
 * 2. [{ name, description, parameters }]
 * 
 * IMPORTANT: All function declarations must be in a single tools object
 * because the upstream API doesn't support multiple non-search tool objects.
 */
export function convertGeminiToolsToAntigravity(
    geminiTools: any[] | undefined,
    sessionId: string | undefined,
    actualModelName: string | undefined
): AntigravityTool[] {
    if (!geminiTools || geminiTools.length === 0) return [];

    const functionDeclarations: FunctionDeclaration[] = [];

    for (const tool of geminiTools) {
        // Format 1: Already functionDeclarations format
        if (tool.functionDeclarations) {
            for (const fd of tool.functionDeclarations) {
                functionDeclarations.push(
                    convertSingleTool(fd.name, fd.description, fd.parameters, sessionId, actualModelName)
                );
            }
        }
        // Format 2: Single tool definition format
        else if (tool.name) {
            const declaration = convertSingleTool(
                tool.name,
                tool.description,
                tool.parameters || tool.input_schema,
                sessionId,
                actualModelName
            );
            functionDeclarations.push(declaration);
        }
        // Unknown format, skip
    }

    // Return a single tools object with all function declarations
    if (functionDeclarations.length === 0) return [];
    return [{ functionDeclarations }];
}
