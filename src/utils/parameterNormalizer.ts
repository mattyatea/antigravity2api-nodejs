// Unified parameter processing module
// Convert OpenAI, Claude, Gemini parameters to internal format

import config from '../config/index.js';
import { REASONING_EFFORT_MAP } from '../config/constants.js';

// ==================== Signature Constants ====================
const CLAUDE_THOUGHT_SIGNATURE = 'RXNZRENrZ0lDaEFDR0FJcVFMZzVPTmZsd1ZHNmZKK3labDJ0TkNlRzc5QUpzUHV2OW9UZG1yc0JUUGNsUjFBQWhKNWlYcXhlU0dTaEtxeWJ1NUdaM2YvMXByaHJCSnk3OEhsWkxOd1NEREI5Mi8zQXFlYkUvY3RISEJvTXlGVHNzdzRJZXkxUTFkUURJakE3R3AwSXJQeW0xdWxLMVBXcFhuRElPdmJFRFd4LzV2cUZaQTg2NWU1SkM3QnY2dkxwZE43M2dLYkljaThobGR3cXF3S1VMbHE5b3NMdjc3QnNhZm5mbDhlbUd5NmJ6WVRpUnRWcXA0MDJabmZ2Tnl3T2hJd1BBV0l1SUNTdjFTemswZlNmemR0Z2R5eGgxaUJOZHhHNXVhZWhKdWhlUUwza3RDZWVxa2dMNFE0ZjRKWkFnR3pKOHNvaStjZ1pqRXJHT1lyNjJkdkxnUUVoT1E5MjN6bEUwRFd4aXdPU1JOK3VSRWdHZ0FKVkhZcjBKVzhrVTZvaEVaYk1IVkE4aG14ZElGMm9YK1ZxRnFUSGFDZWZEYWNQNTJVOW94VmJ0cFhrNnJUanQ2ZHpadEFMWThXQWs5RFI3bTJTbGova2VraXFzVVBRbFdIaFNUN3diZGpuVkYvdUVoODRWbXQ5WjdtaThtR2JEcTdaTHVOalF0T3hHMVpXbXJmeUpCMExwa0R1SnZDV01qZ3BqTHdsU0R4SUpmeEFoT2JzQlVpRzdLTDYwcUluanZaK1VTcXdjZGhmN0U3ZjgrN0l2ZXczRC9DZUYvdlptQ0JqU2JTcUdYYmFIQmdC';
const GEMINI_THOUGHT_SIGNATURE = 'EqAHCp0HAXLI2nygRbdzD4Vgzxxi7tbM87zIRkNgPLqTj+Jxv9mY8Q0G87DzbTtvsIFhWB0RZMoEK6ntm5GmUe6ADtxHk4zgHUs/FKqTu8tzUdPRDrKn3KCAtFW4LJqijZoFxNKMyQRmlgPUX4tGYE7pllD77UK6SjCwKhKZoSVZLMiPXP9YFktbida1Q5upXMrzG1t8abPmpFo983T/rgWlNqJp+Fb+bsoH0zuSpmU4cPKO3LIGsxBhvRhM/xydahZD+VpEX7TEJAN58z1RomFyx9u0IR7ukwZr2UyoNA+uj8OChUDFupQsVwbm3XE1UAt22BGvfYIyyZ42fxgOgsFFY+AZ72AOufcmZb/8vIw3uEUgxHczdl+NGLuS4Hsy/AAntdcH9sojSMF3qTf+ZK1FMav23SPxUBtU5T9HCEkKqQWRnMsVGYV1pupFisWo85hRLDTUipxVy9ug1hN8JBYBNmGLf8KtWLhVp7Z11PIAZj3C6HzoVyiVeuiorwNrn0ZaaXNe+y5LHuDF0DNZhrIfnXByq6grLLSAv4fTLeCJvfGzTWWyZDMbVXNx1HgumKq8calP9wv33t0hfEaOlcmfGIyh1J/N+rOGR0WXcuZZP5/VsFR44S2ncpwTPT+MmR0PsjocDenRY5m/X4EXbGGkZ+cfPnWoA64bn3eLeJTwxl9W1ZbmYS6kjpRGUMxExgRNOzWoGISddHCLcQvN7o50K8SF5k97rxiS5q4rqDmqgRPXzQTQnZyoL3dCxScX9cvLSjNCZDcotonDBAWHfkXZ0/EmFiONQcLJdANtAjwoA44Mbn50gubrTsNd7d0Rm/hbNEh/ZceUalV5MMcl6tJtahCJoybQMsnjWuBXl7cXiKmqAvxTDxIaBgQBYAo4FrbV4zQv35zlol+O3YiyjJn/U0oBeO5pEcH4d0vnLgYP71jZVY2FjWRKnDR9aw4JhiuqAa+i0tupkBy+H4/SVwHADFQq6wcsL8qvXlwktJL9MIAoaXDkIssw6gKE9EuGd7bSO9f+sA8CZ0I8LfJ3jcHUsE/3qd4pFrn5RaET56+1p8ZHZDDUQ0p1okApUCCYsC2WuL6O9P4fcg3yitAA/AfUUNjHKANE+ANneQ0efMG7fx9bvI+iLbXgPupApoov24JRkmhHsrJiu9bp+G/pImd2PNv7ArunJ6upl0VAUWtRyLWyGfdl6etGuY8vVJ7JdWEQ8aWzRK3g6e+8YmDtP5DAfw==';
const CLAUDE_TOOL_SIGNATURE = 'RXVNQkNrZ0lDaEFDR0FJcVFLZGsvMnlyR0VTbmNKMXEyTFIrcWwyY2ozeHhoZHRPb0VOYWJ2VjZMSnE2MlBhcEQrUWdIM3ZWeHBBUG9rbGN1aXhEbXprZTcvcGlkbWRDQWs5MWcrTVNERnRhbWJFOU1vZWZGc1pWSGhvTUxsMXVLUzRoT3BIaWwyeXBJakNYa05EVElMWS9talprdUxvRjFtMmw5dnkrbENhSDNNM3BYNTM0K1lRZ0NaWTQvSUNmOXo4SkhZVzU2Sm1WcTZBcVNRUURBRGVMV1BQRXk1Q0JsS0dCZXlNdHp2NGRJQVlGbDFSMDBXNGhqNHNiSWNKeGY0UGZVQTBIeE1mZjJEYU5BRXdrWUJ4MmNzRFMrZGM1N1hnUlVNblpkZ0hTVHVNaGdod1lBUT09';
const GEMINI_TOOL_SIGNATURE = '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';

export function getThoughtSignatureForModel(actualModelName: string | undefined): string {
    if (!actualModelName) return CLAUDE_THOUGHT_SIGNATURE;
    const lower = actualModelName.toLowerCase();
    if (lower.includes('claude')) return CLAUDE_THOUGHT_SIGNATURE;
    if (lower.includes('gemini')) return GEMINI_THOUGHT_SIGNATURE;
    return CLAUDE_THOUGHT_SIGNATURE;
}

export function getToolSignatureForModel(actualModelName: string | undefined): string {
    if (!actualModelName) return CLAUDE_TOOL_SIGNATURE;
    const lower = actualModelName.toLowerCase();
    if (lower.includes('claude')) return CLAUDE_TOOL_SIGNATURE;
    if (lower.includes('gemini')) return GEMINI_TOOL_SIGNATURE;
    return CLAUDE_TOOL_SIGNATURE;
}

/**
 * Internal unified parameter format
 */
export interface NormalizedParameters {
    max_tokens: number;
    temperature: number;
    top_p: number;
    top_k: number;
    thinking_budget?: number;
    // Gemini 3 thinkingLevel: 'minimal' | 'low' | 'medium' | 'high'
    thinking_level?: string;
    // OpenAI max_completion_tokens compatibility
    max_completion_tokens?: number;
}

/**
 * Extract parameters from OpenAI format
 */
export function normalizeOpenAIParameters(params: any = {}): NormalizedParameters {
    // OpenAI API: max_completion_tokens takes precedence over max_tokens
    const maxTokens = params.max_completion_tokens ?? params.max_tokens ?? config.defaults.max_tokens;

    const normalized: NormalizedParameters = {
        max_tokens: maxTokens,
        temperature: params.temperature ?? config.defaults.temperature,
        top_p: params.top_p ?? config.defaults.top_p,
        top_k: params.top_k ?? config.defaults.top_k,
    };

    // Preserve max_completion_tokens for compatibility
    if (params.max_completion_tokens !== undefined) {
        normalized.max_completion_tokens = params.max_completion_tokens;
    }

    // Handle thinking budget
    if (params.thinking_budget !== undefined) {
        normalized.thinking_budget = params.thinking_budget;
    } else if (params.reasoning_effort !== undefined) {
        // @ts-ignore
        normalized.thinking_budget = REASONING_EFFORT_MAP[params.reasoning_effort];
    }

    return normalized;
}

/**
 * Extract parameters from Claude format
 */
export function normalizeClaudeParameters(params: any = {}): NormalizedParameters {
    const { max_tokens, temperature, top_p, top_k, thinking, ...rest } = params;

    const normalized: NormalizedParameters = {
        max_tokens: max_tokens ?? config.defaults.max_tokens,
        temperature: temperature ?? config.defaults.temperature,
        top_p: top_p ?? config.defaults.top_p,
        top_k: top_k ?? config.defaults.top_k,
    };

    // Handle Claude thinking parameter
    if (thinking && typeof thinking === 'object') {
        if (thinking.type === 'enabled' && thinking.budget_tokens !== undefined) {
            normalized.thinking_budget = thinking.budget_tokens;
        } else if (thinking.type === 'disabled') {
            // Explicitly disable thinking
            normalized.thinking_budget = 0;
        }
    }

    // Note: we don't assign 'rest' to normalized because NormalizedParameters is strict interface in TS usually,
    // but if we want to pass through we might need intersection type or allow any.
    // For now keeping strict NormalizedParameters returns.

    return normalized;
}

/**
 * Extract parameters from Gemini format
 */
export function normalizeGeminiParameters(generationConfig: any = {}): NormalizedParameters {
    const normalized: NormalizedParameters = {
        max_tokens: generationConfig.maxOutputTokens ?? config.defaults.max_tokens,
        temperature: generationConfig.temperature ?? config.defaults.temperature,
        top_p: generationConfig.topP ?? config.defaults.top_p,
        top_k: generationConfig.topK ?? config.defaults.top_k,
    };

    // Handle Gemini thinkingConfig parameter
    if (generationConfig.thinkingConfig && typeof generationConfig.thinkingConfig === 'object') {
        // Gemini 3: thinkingLevel ('minimal' | 'low' | 'medium' | 'high')
        if (generationConfig.thinkingConfig.thinkingLevel !== undefined) {
            normalized.thinking_level = generationConfig.thinkingConfig.thinkingLevel;
            // Map thinkingLevel to approximate budget for compatibility
            const levelToBudget: Record<string, number> = {
                'minimal': 0,
                'low': 1024,
                'medium': 8192,
                'high': 24576
            };
            const level = generationConfig.thinkingConfig.thinkingLevel.toLowerCase();
            if (level in levelToBudget) {
                normalized.thinking_budget = levelToBudget[level];
            }
        }
        // Gemini 2.5: thinkingBudget (number, -1 for dynamic, 0 to disable)
        if (generationConfig.thinkingConfig.thinkingBudget !== undefined) {
            const budget = generationConfig.thinkingConfig.thinkingBudget;
            if (budget === -1) {
                // Dynamic thinking - use default
                normalized.thinking_budget = undefined;
            } else {
                normalized.thinking_budget = budget;
            }
        }
        // Legacy: includeThoughts false to disable
        if (generationConfig.thinkingConfig.includeThoughts === false) {
            normalized.thinking_budget = 0;
        }
    }

    return normalized;
}

/**
 * Automatically detect format and normalize parameters
 */
export function normalizeParameters(params: any, format: 'openai' | 'claude' | 'gemini'): NormalizedParameters {
    switch (format) {
        case 'openai':
            return normalizeOpenAIParameters(params);
        case 'claude':
            return normalizeClaudeParameters(params);
        case 'gemini':
            return normalizeGeminiParameters(params);
        default:
            return normalizeOpenAIParameters(params);
    }
}

/**
 * Convert normalized parameters to Gemini generationConfig format
 */
export function toGenerationConfig(normalized: NormalizedParameters, enableThinking: boolean, actualModelName: string | undefined): any {
    // @ts-ignore
    const defaultThinkingBudget = config.defaults.thinking_budget ?? 1024;
    let thinkingBudget = 0;
    let actualEnableThinking = enableThinking;

    if (enableThinking) {
        if (normalized.thinking_budget !== undefined) {
            thinkingBudget = normalized.thinking_budget;
            // If user explicitly sets thinking_budget = 0, disable thinking
            if (thinkingBudget === 0) {
                actualEnableThinking = false;
            }
        } else {
            thinkingBudget = defaultThinkingBudget;
        }
    }

    const generationConfig: any = {
        topP: normalized.top_p,
        topK: normalized.top_k,
        temperature: normalized.temperature,
        candidateCount: 1,
        maxOutputTokens: normalized.max_tokens || normalized.max_completion_tokens,
    };

    // Build thinkingConfig based on model type
    const isGemini3 = actualModelName && actualModelName.includes('gemini-3');

    if (isGemini3 && normalized.thinking_level) {
        // Gemini 3: use thinkingLevel
        generationConfig.thinkingConfig = {
            thinkingLevel: normalized.thinking_level
        };
    } else {
        // Gemini 2.5 and other models: use thinkingBudget
        generationConfig.thinkingConfig = {
            includeThoughts: actualEnableThinking,
            thinkingBudget: thinkingBudget
        };
    }

    // Claude model does not support topP when thinking enabled
    if (actualEnableThinking && actualModelName && actualModelName.includes('claude')) {
        delete generationConfig.topP;
    }

    return generationConfig;
}

// ==================== Parameter cleanup ====================
const EXCLUDED_KEYS = new Set([
    '$schema', 'additionalProperties', 'minLength', 'maxLength',
    'minItems', 'maxItems', 'uniqueItems', 'exclusiveMaximum',
    'exclusiveMinimum', 'const', 'anyOf', 'oneOf', 'allOf',
    'any_of', 'one_of', 'all_of', 'multipleOf'
]);

export function cleanParameters(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const cleaned: any = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
        if (EXCLUDED_KEYS.has(key)) continue;
        cleaned[key] = (value && typeof value === 'object') ? cleanParameters(value) : value;
    }
    return cleaned;
}

// ==================== Tool name normalization ====================
export function sanitizeToolName(name: any): string {
    if (!name || typeof name !== 'string') return 'tool';
    let cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    cleaned = cleaned.replace(/^_+|_+$/g, '');
    if (!cleaned) cleaned = 'tool';
    if (cleaned.length > 128) cleaned = cleaned.slice(0, 128);
    return cleaned;
}

// ==================== Model Mapping ====================
export function modelMapping(modelName: string): string {
    if (modelName === 'claude-sonnet-4-5-thinking') return 'claude-sonnet-4-5';
    if (modelName === 'claude-opus-4-5') return 'claude-opus-4-5-thinking';
    if (modelName === 'gemini-2.5-flash-thinking') return 'gemini-2.5-flash';
    return modelName;
}

export function isEnableThinking(modelName: string): boolean {
    return modelName.includes('-thinking') ||
        modelName === 'gemini-2.5-pro' ||
        modelName.startsWith('gemini-3-pro-') ||
        modelName === 'rev19-uic3-1p' ||
        modelName === 'gpt-oss-120b-medium';
}

export function generateGenerationConfig(parameters: any, enableThinking: boolean, actualModelName: string | undefined): any {
    // Use config.defaults as fallback
    const normalizedParams: NormalizedParameters = {
        // @ts-ignore
        max_tokens: parameters.max_tokens ?? config.defaults.max_tokens,
        // @ts-ignore
        temperature: parameters.temperature ?? config.defaults.temperature,
        // @ts-ignore
        top_p: parameters.top_p ?? config.defaults.top_p ?? 0.95,
        // @ts-ignore
        top_k: parameters.top_k ?? config.defaults.top_k ?? 40,
        thinking_budget: parameters.thinking_budget,
    };

    // Handle reasoning_effort to thinking_budget conversion
    if (normalizedParams.thinking_budget === undefined && parameters.reasoning_effort !== undefined) {
        // @ts-ignore
        const defaultThinkingBudget = config.defaults.thinking_budget ?? 1024;
        // @ts-ignore
        normalizedParams.thinking_budget = REASONING_EFFORT_MAP[parameters.reasoning_effort] ?? defaultThinkingBudget;
    }

    // Use unified parameter conversion function
    const generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);

    // Add stopSequences
    // @ts-ignore
    generationConfig.stopSequences = [
        '<|user|>',
        '<|bot|>',
        '<|context_request|>',
        '<|endoftext|>',
        '<|end_of_turn|>'
    ];

    return generationConfig;
}


// ==================== System instruction extraction ====================
export function extractSystemInstruction(openaiMessages: any[]): string {
    // @ts-ignore
    const baseSystem = config.systemInstruction || '';
    // @ts-ignore
    if (!config.useContextSystemPrompt) return baseSystem;

    const systemTexts: string[] = [];
    for (const message of openaiMessages) {
        if (message.role === 'system') {
            const content = typeof message.content === 'string'
                ? message.content
                : (Array.isArray(message.content)
                    ? message.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('')
                    : '');
            if (content.trim()) systemTexts.push(content.trim());
        } else {
            break;
        }
    }

    const parts: string[] = [];
    if (baseSystem.trim()) parts.push(baseSystem.trim());
    if (systemTexts.length > 0) parts.push(systemTexts.join('\n\n'));
    return parts.join('\n\n');
}

export default {
    normalizeOpenAIParameters,
    normalizeClaudeParameters,
    normalizeGeminiParameters,
    normalizeParameters,
    toGenerationConfig,
    sanitizeToolName,
    modelMapping,
    isEnableThinking,
    generateGenerationConfig,
    cleanParameters,
    extractSystemInstruction,
    getThoughtSignatureForModel,
    getToolSignatureForModel
};
