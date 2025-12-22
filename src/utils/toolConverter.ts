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
 */
export function convertOpenAIToolsToAntigravity(
    openaiTools: any[] | undefined,
    sessionId: string | undefined,
    actualModelName: string | undefined
): AntigravityTool[] {
    if (!openaiTools || openaiTools.length === 0) return [];

    return openaiTools.map((tool) => {
        const func = tool.function || {};
        const declaration = convertSingleTool(
            func.name,
            func.description,
            func.parameters,
            sessionId,
            actualModelName
        );

        return {
            functionDeclarations: [declaration]
        };
    });
}

/**
 * Convert Claude format tool list to Antigravity format
 * Claude Format: [{ name, description, input_schema }]
 */
export function convertClaudeToolsToAntigravity(
    claudeTools: any[] | undefined,
    sessionId: string | undefined,
    actualModelName: string | undefined
): AntigravityTool[] {
    if (!claudeTools || claudeTools.length === 0) return [];

    return claudeTools.map((tool) => {
        const declaration = convertSingleTool(
            tool.name,
            tool.description,
            tool.input_schema,
            sessionId,
            actualModelName
        );

        return {
            functionDeclarations: [declaration]
        };
    });
}

/**
 * Convert Gemini format tool list to Antigravity format
 * Gemini Format:
 * 1. [{ functionDeclarations: [{ name, description, parameters }] }]
 * 2. [{ name, description, parameters }]
 */
export function convertGeminiToolsToAntigravity(
    geminiTools: any[] | undefined,
    sessionId: string | undefined,
    actualModelName: string | undefined
): AntigravityTool[] {
    if (!geminiTools || geminiTools.length === 0) return [];

    return geminiTools.map((tool) => {
        // Format 1: Already functionDeclarations format
        if (tool.functionDeclarations) {
            return {
                functionDeclarations: tool.functionDeclarations.map((fd: any) =>
                    convertSingleTool(fd.name, fd.description, fd.parameters, sessionId, actualModelName)
                )
            };
        }

        // Format 2: Single tool definition format
        if (tool.name) {
            const declaration = convertSingleTool(
                tool.name,
                tool.description,
                tool.parameters || tool.input_schema,
                sessionId,
                actualModelName
            );

            return {
                functionDeclarations: [declaration]
            };
        }

        // Unknown format, return as is
        return tool;
    });
}
