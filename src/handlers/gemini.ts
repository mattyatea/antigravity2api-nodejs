/**
 * Gemini Format Handler
 * Handles /v1beta/models/* requests, supporting streaming and non-streaming responses
 */

import { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
// @ts-ignore
import { generateAssistantResponse, generateAssistantResponseNoStream, getAvailableModels } from '../services/ai/client.js';
import { generateGeminiRequestBody } from '../converters/gemini.js';

function prepareImageRequest(requestBody: any): any {
    const req = JSON.parse(JSON.stringify(requestBody));
    // SD specific adjustments
    if (req.request && req.request.generationConfig) {
        req.request.generationConfig.responseMimeType = 'image/jpeg';
        // Ensure sample count 1
        req.request.generationConfig.candidateCount = 1;
    }
    return req;
}
import { buildGeminiErrorPayload } from '../utils/errors.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
// @ts-ignore
import tokenManager from '../services/auth/token-manager.js';
import { with429Retry, writeHeartbeat } from '../utils/sse.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from '../config/constants.js';

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: any[];
            role: string;
        };
        finishReason: string;
        index: number;
    }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
        thoughtsTokenCount?: number;
    };
}

function redactGeminiPayload(payload: any) {
    if (!payload || typeof payload !== 'object') return payload;
    const cloned = JSON.parse(JSON.stringify(payload));
    const contents = cloned.request?.contents;
    if (Array.isArray(contents)) {
        for (const content of contents) {
            if (!content?.parts || !Array.isArray(content.parts)) continue;
            for (const part of content.parts) {
                if (part?.inlineData?.data) {
                    part.inlineData.data = '[base64 omitted]';
                }
            }
        }
    }
    return cloned;
}

function logGeminiPayload(label: string, url: string, payload: any) {
    const safePayload = redactGeminiPayload(payload);
    let serialized = '';
    try {
        serialized = JSON.stringify(safePayload);
    } catch {
        serialized = '[unserializable payload]';
    }
    const maxLen = 4000;
    if (serialized.length > maxLen) {
        serialized = `${serialized.slice(0, maxLen)}... [truncated]`;
    }
    logger.info(label, url, serialized);
}

const normalizeGeminiModelName = (modelName: string): string => {
    const trimmed = modelName.trim();
    const withoutPrefix = trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
    const suffixIndex = withoutPrefix.indexOf(':');
    return suffixIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, suffixIndex);
};

/**
 * Create Gemini format response
 */
export const createGeminiResponse = (
    content: string | null,
    reasoning: string | null,
    reasoningSignature: string | null,
    toolCalls: any[] | null,
    finishReason: string | null,
    usage: any | null
): GeminiResponse => {
    const parts: any[] = [];

    if (reasoning) {
        const thoughtPart: any = { text: reasoning, thought: true };
        // @ts-ignore
        if (reasoningSignature && config.passSignatureToClient) {
            thoughtPart.thoughtSignature = reasoningSignature;
        }
        parts.push(thoughtPart);
    }

    if (content) {
        parts.push({ text: content });
    }

    if (toolCalls && toolCalls.length > 0) {
        toolCalls.forEach(tc => {
            try {
                const functionCallPart: any = {
                    functionCall: {
                        name: tc.function.name,
                        args: JSON.parse(tc.function.arguments)
                    }
                };
                // @ts-ignore
                if (tc.thoughtSignature && config.passSignatureToClient) {
                    functionCallPart.thoughtSignature = tc.thoughtSignature;
                }
                parts.push(functionCallPart);
            } catch (e) {
                // Ignore parse error
            }
        });
    }

    const response: GeminiResponse = {
        candidates: [{
            content: {
                parts: parts,
                role: "model"
            },
            finishReason: finishReason || "STOP",
            index: 0
        }]
    };

    if (usage) {
        response.usageMetadata = {
            promptTokenCount: usage.prompt_tokens,
            candidatesTokenCount: usage.completion_tokens,
            totalTokenCount: usage.total_tokens
        };
        // Add thoughtsTokenCount for Gemini thinking models
        if (usage.thoughts_tokens !== undefined) {
            response.usageMetadata.thoughtsTokenCount = usage.thoughts_tokens;
        }
    }

    return response;
};

/**
 * Convert OpenAI model list to Gemini format
 */
export const convertToGeminiModelList = (openaiModels: any) => {
    const models = openaiModels.data.map((model: any) => ({
        name: `models/${model.id}`,
        version: "001",
        displayName: model.id,
        description: "Imported model",
        inputTokenLimit: 32768, // Default
        outputTokenLimit: 8192, // Default
        supportedGenerationMethods: ["generateContent", "countTokens"],
        temperature: 0.9,
        topP: 1.0,
        topK: 40
    }));
    return { models };
};

/**
 * Get Gemini format model list
 */
export const handleGeminiModelsList = async (c: Context) => {
    try {
        const openaiModels = await getAvailableModels();
        const geminiModels = convertToGeminiModelList(openaiModels);
        return c.json(geminiModels);
    } catch (error: any) {
        logger.error('Failed to get model list:', error.message);
        return c.json({ error: { code: 500, message: error.message, status: "INTERNAL" } }, 500);
    }
};

/**
 * Get single model detail (Gemini format)
 */
export const handleGeminiModelDetail = async (c: Context) => {
    try {
        const modelId = c.req.param('model')?.replace(/^models\//, '') || '';
        const openaiModels = await getAvailableModels();
        const model = openaiModels.data.find((m: any) => m.id === modelId);

        if (model) {
            const geminiModel = {
                name: `models/${model.id}`,
                version: "001",
                displayName: model.id,
                description: "Imported model",
                inputTokenLimit: 32768,
                outputTokenLimit: 8192,
                supportedGenerationMethods: ["generateContent", "countTokens"],
                temperature: 0.9,
                topP: 1.0,
                topK: 40
            };
            return c.json(geminiModel);
        } else {
            return c.json({ error: { code: 404, message: `Model ${modelId} not found`, status: "NOT_FOUND" } }, 404);
        }
    } catch (error: any) {
        logger.error('Failed to get model detail:', error.message);
        return c.json({ error: { code: 500, message: error.message, status: "INTERNAL" } }, 500);
    }
};

/**
 * Handle Gemini format chat request
 */
export const handleGeminiRequest = async (c: Context, modelName: string, isStream: boolean) => {
    // @ts-ignore
    const maxRetries = Number(config.retryTimes || 0);
    const safeRetries = maxRetries > 0 ? Math.floor(maxRetries) : 0;

    try {
        const normalizedModelName = normalizeGeminiModelName(modelName);
        if (!normalizedModelName) {
            return c.json({ error: { code: 400, message: 'Model name is required', status: "INVALID_ARGUMENT" } }, 400);
        }
        logger.info('[Gemini] request received', normalizedModelName, isStream ? 'stream' : 'no_stream');

        const token = await tokenManager.getToken();
        if (!token) {
            return c.json({ error: { code: 500, message: 'No token available, please run npm run login to get a token', status: "INTERNAL" } }, 500);
        }

        const body = await c.req.json();
        const isImageModel = normalizedModelName.includes('-image');
        const requestBody = generateGeminiRequestBody(body, normalizedModelName, token);

        if (isImageModel) {
            prepareImageRequest(requestBody);
        }

        const upstreamUrl = isStream ? config.api.url : config.api.noStreamUrl;
        logGeminiPayload('[Upstream Request]', upstreamUrl, requestBody);

        if (isStream) {
            return streamSSE(c, async (stream) => {
                const heartbeatTimer = setInterval(async () => {
                    await writeHeartbeat(stream);
                }, DEFAULT_HEARTBEAT_INTERVAL);

                try {
                    if (isImageModel) {
                        // Image generation: get result non-streaming, then return in one chunk
                        const { content, usage } = await with429Retry(
                            () => generateAssistantResponseNoStream(requestBody, token),
                            safeRetries,
                            'gemini.stream.image '
                        );
                        const chunk = createGeminiResponse(content, null, null, null, 'STOP', usage);
                        await stream.writeSSE({ data: JSON.stringify(chunk) });
                    } else {
                        let usageData: any = null;
                        let hasToolCall = false;

                        await with429Retry(
                            () => generateAssistantResponse(requestBody, token, async (data: any) => {
                                if (data.type === 'usage') {
                                    usageData = data.usage;
                                } else if (data.type === 'reasoning') {
                                    // Gemini thinking content
                                    const chunk = createGeminiResponse(null, data.reasoning_content, data.thoughtSignature, null, null, null);
                                    await stream.writeSSE({ data: JSON.stringify(chunk) });
                                } else if (data.type === 'tool_calls') {
                                    hasToolCall = true;
                                    // Gemini tool call
                                    const chunk = createGeminiResponse(null, null, null, data.tool_calls, null, null);
                                    await stream.writeSSE({ data: JSON.stringify(chunk) });
                                } else {
                                    // Normal text
                                    const chunk = createGeminiResponse(data.content, null, null, null, null, null);
                                    await stream.writeSSE({ data: JSON.stringify(chunk) });
                                }
                            }),
                            safeRetries,
                            'gemini.stream '
                        );

                        // Send finish chunk and usage
                        // Note: Gemini API uses "STOP" for both normal completion and tool calls
                        // But we can distinguish by checking if tool_calls were sent earlier
                        const finalChunk = createGeminiResponse(null, null, null, null, "STOP", usageData);
                        await stream.writeSSE({ data: JSON.stringify(finalChunk) });
                    }
                } catch (error: any) {
                    logger.error('Gemini streaming request failed:', error.message);
                    const statusCode = error.statusCode || error.status || 500;
                    await stream.writeSSE({ data: JSON.stringify(buildGeminiErrorPayload(error, statusCode)) });
                } finally {
                    clearInterval(heartbeatTimer);
                }
            });
        } else {
            // Non-streaming
            const { content, reasoningContent, reasoningSignature, toolCalls, usage } = await with429Retry(
                () => generateAssistantResponseNoStream(requestBody, token),
                safeRetries,
                'gemini.no_stream '
            );

            // Gemini API returns "STOP" for both normal and tool call completions
            // Clients should check for functionCall parts in the response to detect tool calls
            const response = createGeminiResponse(content, reasoningContent, reasoningSignature, toolCalls, "STOP", usage);
            return c.json(response);
        }
    } catch (error: any) {
        logger.error('Gemini request failed:', error.message);
        const statusCode = error.statusCode || error.status || 500;
        return c.json(buildGeminiErrorPayload(error, statusCode), statusCode);
    }
};
