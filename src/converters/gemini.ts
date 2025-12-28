// Gemini format converter tool
import config from '../config/index.js';
import { generateRequestId } from '../utils/id-generator.js';
import { convertGeminiToolsToAntigravity } from '../utils/toolConverter.js';
import { getSignatureContext, createThoughtPart } from './common.js';
import { normalizeGeminiParameters, toGenerationConfig, modelMapping, isEnableThinking } from '../utils/parameterNormalizer.js';

/**
 * Generate unique ID for functionCall
 */
function generateFunctionCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Handle ID matching between functionCall and functionResponse
 */
function processFunctionCallIds(contents: any[]) {
    const functionCallIds: string[] = [];

    // Collect IDs of all functionCall
    contents.forEach(content => {
        if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
            content.parts.forEach((part: any) => {
                if (part.functionCall) {
                    if (!part.functionCall.id) {
                        part.functionCall.id = generateFunctionCallId();
                    }
                    functionCallIds.push(part.functionCall.id);
                }
            });
        }
    });

    // Assign corresponding IDs to functionResponse
    let responseIndex = 0;
    contents.forEach(content => {
        if (content.role === 'user' && content.parts && Array.isArray(content.parts)) {
            content.parts.forEach((part: any) => {
                if (part.functionResponse) {
                    if (!part.functionResponse.id && responseIndex < functionCallIds.length) {
                        part.functionResponse.id = functionCallIds[responseIndex];
                        responseIndex++;
                    }
                }
            });
        }
    });
}

/**
 * Process thoughts and signatures in model messages
 */
function processModelThoughts(content: any, reasoningSignature: string, toolSignature: string) {
    const parts = content.parts;

    // Search for position of thought and independent thoughtSignature
    let thoughtIndex = -1;
    let signatureIndex = -1;
    let signatureValue: string | null = null;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.thought === true && !part.thoughtSignature) {
            thoughtIndex = i;
        }
        if (part.thoughtSignature && !part.thought) {
            signatureIndex = i;
            signatureValue = part.thoughtSignature;
        }
    }

    // Merge or add thought and signature
    if (thoughtIndex !== -1 && signatureIndex !== -1) {
        parts[thoughtIndex].thoughtSignature = signatureValue;
        parts.splice(signatureIndex, 1);
    } else if (thoughtIndex !== -1 && signatureIndex === -1) {
        parts[thoughtIndex].thoughtSignature = reasoningSignature;
    } else if (thoughtIndex === -1) {
        parts.unshift(createThoughtPart(' ', reasoningSignature));
    }

    // Collect independent signature parts (for functionCall)
    const standaloneSignatures: { index: number; signature: string }[] = [];
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part.thoughtSignature && !part.thought && !part.functionCall && !part.text) {
            standaloneSignatures.unshift({ index: i, signature: part.thoughtSignature });
        }
    }

    // Assign signature to functionCall
    let sigIndex = 0;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.functionCall && !part.thoughtSignature) {
            if (sigIndex < standaloneSignatures.length) {
                part.thoughtSignature = standaloneSignatures[sigIndex].signature;
                sigIndex++;
            } else {
                part.thoughtSignature = toolSignature;
            }
        }
    }

    // Remove used independent signature parts
    for (let i = standaloneSignatures.length - 1; i >= 0; i--) {
        if (i < sigIndex) {
            parts.splice(standaloneSignatures[i].index, 1);
        }
    }
}

export function generateGeminiRequestBody(geminiBody: any, modelName: string, token: any) {
    const enableThinking = isEnableThinking(modelName);
    const actualModelName = modelMapping(modelName);
    const request = JSON.parse(JSON.stringify(geminiBody));

    if (request.contents && Array.isArray(request.contents)) {
        request.contents.forEach((content: any) => {
            if (!content.role) {
                content.role = 'user';
            }
        });
        processFunctionCallIds(request.contents);

        if (enableThinking) {
            const { reasoningSignature, toolSignature } = getSignatureContext(token.sessionId, actualModelName);

            request.contents.forEach((content: any) => {
                if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
                    processModelThoughts(content, reasoningSignature, toolSignature);
                }
            });
        }
    }

    const hadThinkingConfig = Boolean(request.generationConfig?.thinkingConfig);
    // Process Gemini format parameters using unified parameter normalizer module
    const normalizedParams = normalizeGeminiParameters(request.generationConfig || {});

    // Convert to generationConfig format
    request.generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);
    if (!enableThinking && !hadThinkingConfig && normalizedParams.thinking_level === undefined && normalizedParams.thinking_budget === undefined) {
        delete request.generationConfig.thinkingConfig;
    }
    request.sessionId = token.sessionId;
    delete request.safetySettings;

    // Convert tool definitions
    if (request.tools && Array.isArray(request.tools)) {
        request.tools = convertGeminiToolsToAntigravity(request.tools, token.sessionId, actualModelName);
    }

    // Add tool configuration
    if (request.tools && request.tools.length > 0 && !request.toolConfig) {
        request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
    }

    const existingText = request.systemInstruction?.parts?.[0]?.text || '';
    // @ts-ignore
    const mergedText = existingText ? `${config.systemInstruction}\n\n${existingText}` : config.systemInstruction ?? "";
    const trimmedText = mergedText.trim();
    if (trimmedText) {
        request.systemInstruction = {
            role: 'user',
            parts: [{ text: trimmedText }]
        };
    } else {
        delete request.systemInstruction;
    }

    const requestBody = {
        project: token.projectId,
        requestId: generateRequestId(),
        request: request,
        model: actualModelName,
        userAgent: 'antigravity'
    };

    return requestBody;
}
