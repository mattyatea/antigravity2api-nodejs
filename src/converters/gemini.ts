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
 * Ensures every functionResponse has a matching functionCall with the same ID
 */
function processFunctionCallIds(contents: any[]) {
    // Build a map of functionCall IDs and names, indexed by message position
    // Structure: Map<messageIndex, Array<{id, name, part, index}>>
    const functionCallsByMessage: Map<number, Array<{ id: string; name: string; part: any; index: number }>> = new Map();

    contents.forEach((content, msgIndex) => {
        if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
            const calls: Array<{ id: string; name: string; part: any; index: number }> = [];
            content.parts.forEach((part: any, partIndex: number) => {
                if (part.functionCall) {
                    // Ensure functionCall has an ID
                    if (!part.functionCall.id) {
                        part.functionCall.id = generateFunctionCallId();
                    }
                    calls.push({
                        id: part.functionCall.id,
                        name: part.functionCall.name,
                        part,
                        index: partIndex
                    });
                }
            });
            if (calls.length > 0) {
                functionCallsByMessage.set(msgIndex, calls);
            }
        }
    });

    // Process functionResponses and match with preceding functionCalls
    contents.forEach((content, msgIndex) => {
        if (content.role === 'user' && content.parts && Array.isArray(content.parts)) {
            // Find the most recent model message with function calls (should be msgIndex - 1)
            let prevModelCalls: Array<{ id: string; name: string; part: any; index: number }> | undefined;
            for (let i = msgIndex - 1; i >= 0; i--) {
                if (functionCallsByMessage.has(i)) {
                    prevModelCalls = functionCallsByMessage.get(i);
                    break;
                }
            }

            // Track which call indices have been matched to avoid duplicates
            const matchedCallIndices = new Set<number>();

            content.parts.forEach((part: any) => {
                if (part.functionResponse) {
                    const responseName = part.functionResponse.name;
                    const existingId = part.functionResponse.id;

                    if (existingId && prevModelCalls) {
                        // If response has an ID, find unmatched call by name and update its ID
                        const matchingCall = prevModelCalls.find(c =>
                            c.name === responseName && !matchedCallIndices.has(c.index)
                        );
                        if (matchingCall) {
                            matchingCall.part.functionCall.id = existingId;
                            matchingCall.id = existingId;
                            matchedCallIndices.add(matchingCall.index);
                        }
                    } else if (!existingId && prevModelCalls) {
                        // If response has no ID, find unmatched call by name and use its ID
                        const matchingCall = prevModelCalls.find(c =>
                            c.name === responseName && !matchedCallIndices.has(c.index)
                        );
                        if (matchingCall) {
                            part.functionResponse.id = matchingCall.id;
                            matchedCallIndices.add(matchingCall.index);
                        } else {
                            // Fallback: find any unmatched call
                            const unmatchedCall = prevModelCalls.find(c => !matchedCallIndices.has(c.index));
                            if (unmatchedCall) {
                                part.functionResponse.id = unmatchedCall.id;
                                matchedCallIndices.add(unmatchedCall.index);
                            } else {
                                // No matching call found, generate new ID
                                part.functionResponse.id = generateFunctionCallId();
                            }
                        }
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
