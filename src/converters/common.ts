// Common converter module
import config from '../config/index.js';
import { generateRequestId } from '../utils/id-generator.js';
import { getReasoningSignature, getToolSignature } from '../utils/thoughtSignatureCache.js';
import { setToolNameMapping } from '../utils/toolNameCache.js';
import { getThoughtSignatureForModel, getToolSignatureForModel } from '../utils/parameterNormalizer.js';
import { sanitizeToolName, modelMapping, isEnableThinking, generateGenerationConfig } from '../utils/parameterNormalizer.js';
// Note: Assuming parameterNormalizer or another file now holds these, or they strictly belong here now. 
// Given previous context, utils.ts is being deleted. We must ensure these functions exist somewhere.
// Checking utils list, I see parameterNormalizer.ts. I will assume complex logic moved there or stays in common.ts if it was imported from utils.
// Actually, I should check where they are defined. If they were in utils.ts, I need to find where they went or if I need to migrate them.
// The user said "utils ... should be errors, http-client, id-generator, memory-manager, logger". 
// This implies other files are "extra". 
// I will check parameterNormalizer.ts next to see if logic fits there, otherwise I might need to keep them in common.ts or a new home.
// For now, I will remove the re-export line 210.

interface SignatureContext {
    reasoningSignature: string;
    toolSignature: string;
}

interface ExtractedContent {
    text: string;
    images: any[];
}

interface MessagePart {
    text?: string;
    thought?: boolean;
    thoughtSignature?: string;
    functionCall?: {
        id: string;
        name: string;
        args: any;
    };
    functionResponse?: {
        id: string;
        name: string;
        response: { output: string };
    };
    inlineData?: {
        mimeType: string;
        data: string;
    };
}

interface AntigravityMessage {
    role: string;
    parts: MessagePart[];
}

/**
 * Get signature context
 */
export function getSignatureContext(sessionId: string | undefined, actualModelName: string): SignatureContext {
    const cachedReasoningSig = getReasoningSignature(sessionId, actualModelName);
    const cachedToolSig = getToolSignature(sessionId, actualModelName);

    return {
        reasoningSignature: cachedReasoningSig || getThoughtSignatureForModel(actualModelName),
        toolSignature: cachedToolSig || getToolSignatureForModel(actualModelName)
    };
}

/**
 * Add user message to antigravityMessages
 */
export function pushUserMessage(extracted: ExtractedContent, antigravityMessages: AntigravityMessage[]) {
    antigravityMessages.push({
        role: 'user',
        parts: [{ text: extracted.text }, ...extracted.images]
    });
}

/**
 * Find function name by tool call ID
 */
export function findFunctionNameById(toolCallId: string, antigravityMessages: AntigravityMessage[]): string {
    for (let i = antigravityMessages.length - 1; i >= 0; i--) {
        if (antigravityMessages[i].role === 'model') {
            const parts = antigravityMessages[i].parts;
            for (const part of parts) {
                if (part.functionCall && part.functionCall.id === toolCallId) {
                    return part.functionCall.name;
                }
            }
        }
    }
    return '';
}

/**
 * Add function response to antigravityMessages
 */
export function pushFunctionResponse(toolCallId: string, functionName: string, resultContent: string, antigravityMessages: AntigravityMessage[]) {
    const lastMessage = antigravityMessages[antigravityMessages.length - 1];
    const functionResponse: MessagePart = {
        functionResponse: {
            id: toolCallId,
            name: functionName,
            response: { output: resultContent }
        }
    };

    if (lastMessage?.role === 'user' && lastMessage.parts.some(p => p.functionResponse)) {
        lastMessage.parts.push(functionResponse);
    } else {
        antigravityMessages.push({ role: 'user', parts: [functionResponse] });
    }
}

/**
 * Create signed thought part
 */
export function createThoughtPart(text: string, signature?: string): MessagePart {
    const part: MessagePart = { text: text || ' ', thought: true };
    if (signature) {
        part.thoughtSignature = signature;
    }
    return part;
}

/**
 * Create signed function call part
 */
export function createFunctionCallPart(id: string, name: string, args: any, signature: string | null = null): MessagePart {
    const part: MessagePart = {
        functionCall: {
            id,
            name,
            args: typeof args === 'string' ? { query: args } : args
        }
    };
    if (signature) {
        part.thoughtSignature = signature;
    }
    return part;
}

/**
 * Process tool name mapping
 */
export function processToolName(originalName: string, sessionId: string | undefined, actualModelName: string): string {
    const safeName = sanitizeToolName(originalName);
    if (sessionId && actualModelName && safeName !== originalName) {
        setToolNameMapping(sessionId, actualModelName, safeName, originalName);
    }
    return safeName;
}

/**
 * Add model message to antigravityMessages
 */
export function pushModelMessage(
    { parts, toolCalls, hasContent }: { parts: MessagePart[]; toolCalls: MessagePart[]; hasContent: boolean },
    antigravityMessages: AntigravityMessage[]
) {
    const lastMessage = antigravityMessages[antigravityMessages.length - 1];
    const hasToolCalls = toolCalls && toolCalls.length > 0;

    if (lastMessage?.role === 'model' && hasToolCalls && !hasContent) {
        lastMessage.parts.push(...toolCalls);
    } else {
        const allParts = [...parts, ...(toolCalls || [])];
        antigravityMessages.push({ role: 'model', parts: allParts });
    }
}

/**
 * Build basic request body
 */
export function buildRequestBody(
    { contents, tools, generationConfig, sessionId, systemInstruction }: {
        contents: AntigravityMessage[];
        tools: any[];
        generationConfig: any;
        sessionId: string;
        systemInstruction: string;
    },
    token: any,
    actualModelName: string
): any {
    const requestBody: any = {
        project: token.projectId,
        requestId: generateRequestId(),
        request: {
            contents,
            tools: tools || [],
            toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } },
            generationConfig,
            sessionId
        },
        model: actualModelName,
        userAgent: 'antigravity'
    };

    if (systemInstruction) {
        requestBody.request.systemInstruction = {
            role: 'user',
            parts: [{ text: systemInstruction }]
        };
    }

    return requestBody;
}

/**
 * Merge system instructions
 */
export function mergeSystemInstruction(baseSystem: string, contextSystem: string | undefined): string {
    // @ts-ignore
    if (!config.useContextSystemPrompt || !contextSystem) {
        return baseSystem || '';
    }

    const parts: string[] = [];
    if (baseSystem && baseSystem.trim()) parts.push(baseSystem.trim());
    if (contextSystem && contextSystem.trim()) parts.push(contextSystem.trim());
    return parts.join('\n\n');
}

// Re-export
// Re-exports removed as they are no longer in utils.ts


// Re-export parameter normalization functions
export {
    normalizeOpenAIParameters,
    normalizeClaudeParameters,
    normalizeGeminiParameters,
    normalizeParameters,
    toGenerationConfig
} from '../utils/parameterNormalizer.js';
