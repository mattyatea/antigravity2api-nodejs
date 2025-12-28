/**
 * OpenAI Format Handler
 * Handles /v1/chat/completions requests, supporting streaming and non-streaming responses
 */

import { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { generateAssistantResponse, generateAssistantResponseNoStream } from '../services/ai/client.js';
import { generateRequestBody, prepareImageRequest } from '../converters/openai.js';
// @ts-ignore
import { buildOpenAIErrorPayload } from '../utils/errors.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
// @ts-ignore
import tokenManager from '../services/auth/token-manager.js';
import {
    createResponseMeta,
    writeStreamData,
    with429Retry,
    createStreamChunk,
    createErrorStreamChunk
} from '../utils/sse.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from '../config/constants.js';

/**
 * Handle OpenAI format chat request
 */
export const handleOpenAIRequest = async (c: Context) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { messages, model, stream = false, tools, ...params } = body;

    if (!messages) {
        return c.json({ error: 'messages is required' }, 400);
    }

    const token = await tokenManager.getToken();
    if (!token) {
        return c.json({ error: 'No token available, please run npm run login to get a token' }, 500);
    }

    const isImageModel = model.includes('-image');
    const requestBody = generateRequestBody(messages, model, params, tools, token);

    if (isImageModel) {
        prepareImageRequest(requestBody);
    }

    const { id, created } = createResponseMeta();
    const maxRetries = Number(config.retryTimes || 0);
    const safeRetries = maxRetries > 0 ? Math.floor(maxRetries) : 0;

    if (stream) {
        return streamSSE(c, async (stream) => {
            // Start heartbeat
            const heartbeatTimer = setInterval(async () => {
                // SSE comment for heartbeat
                // streamSSE helper doesn't expose strict comment api easily, but writeSSE can take a string
                // But stream.writeSSE({ comment: 'heartbeat' }) depends on implementation.
                // Hono streamSSE writes `:${options.comment}\n` if comment is present.
                await stream.writeSSE({ event: 'ping', data: '{}' });
            }, DEFAULT_HEARTBEAT_INTERVAL);

            try {
                if (isImageModel) {
                    const { content, usage } = await with429Retry(
                        () => generateAssistantResponseNoStream(requestBody, token),
                        safeRetries,
                        'chat.stream.image '
                    );
                    await writeStreamData(stream, createStreamChunk(id, created, model, { content }));
                    await writeStreamData(stream, { ...createStreamChunk(id, created, model, {}, 'stop'), usage });
                } else {
                    let hasToolCall = false;
                    let usageData = null;

                    await with429Retry(
                        () => generateAssistantResponse(requestBody, token, async (data: any) => {
                            if (data.type === 'usage') {
                                usageData = data.usage;
                            } else if (data.type === 'reasoning') {
                                const delta: any = { reasoning_content: data.reasoning_content };
                                if (data.thoughtSignature && config.passSignatureToClient) {
                                    delta.thoughtSignature = data.thoughtSignature;
                                }
                                await writeStreamData(stream, createStreamChunk(id, created, model, delta));
                            } else if (data.type === 'tool_calls') {
                                hasToolCall = true;
                                const toolCallsWithIndex = data.tool_calls.map((toolCall: any, index: number) => {
                                    if (config.passSignatureToClient) {
                                        return { index, ...toolCall };
                                    } else {
                                        const { thoughtSignature, ...rest } = toolCall;
                                        return { index, ...rest };
                                    }
                                });
                                const delta = { tool_calls: toolCallsWithIndex };
                                await writeStreamData(stream, createStreamChunk(id, created, model, delta));
                            } else {
                                const delta = { content: data.content };
                                await writeStreamData(stream, createStreamChunk(id, created, model, delta));
                            }
                        }),
                        safeRetries,
                        'chat.stream '
                    );

                    await writeStreamData(stream, { ...createStreamChunk(id, created, model, {}, hasToolCall ? 'tool_calls' : 'stop'), usage: usageData });
                }
            } catch (error: any) {
                logger.error('Stream processing error:', error.message);
                const statusCode = error.statusCode || error.status || 500;
                // Send error via SSE instead of throwing (consistent with Claude/Gemini handlers)
                await writeStreamData(stream, createErrorStreamChunk(error, statusCode));
            } finally {
                clearInterval(heartbeatTimer);
                await stream.writeSSE({ data: '[DONE]' });
            }
        });
    } else {
        // Non-streaming response
        try {
            const { content, reasoningContent, reasoningSignature, toolCalls, usage } = await with429Retry(
                () => generateAssistantResponseNoStream(requestBody, token),
                safeRetries,
                'chat.no_stream '
            );

            const message: any = { role: 'assistant' };
            if (reasoningContent) message.reasoning_content = reasoningContent;
            if (reasoningSignature && config.passSignatureToClient) message.thoughtSignature = reasoningSignature;
            message.content = content;

            if (toolCalls.length > 0) {
                if (config.passSignatureToClient) {
                    message.tool_calls = toolCalls;
                } else {
                    message.tool_calls = toolCalls.map(({ thoughtSignature, ...rest }: any) => rest);
                }
            }

            // Build extended usage object for OpenAI API compatibility
            const extendedUsage: any = usage ? { ...usage } : {};

            // Add completion_tokens_details for reasoning models (o3, etc.)
            if (usage?.reasoning_tokens !== undefined) {
                extendedUsage.completion_tokens_details = {
                    reasoning_tokens: usage.reasoning_tokens
                };
            }

            // Add prompt_tokens_details for cached tokens
            if (usage?.cached_tokens !== undefined) {
                extendedUsage.prompt_tokens_details = {
                    cached_tokens: usage.cached_tokens
                };
            }

            const response = {
                id,
                object: 'chat.completion',
                created,
                model,
                choices: [{
                    index: 0,
                    message,
                    finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
                }],
                usage: extendedUsage
            };

            return c.json(response);
        } catch (error: any) {
            logger.error('Failed to generate response:', error.message);
            const statusCode = error.statusCode || error.status || 500;
            return c.json(buildOpenAIErrorPayload(error, statusCode), statusCode);
        }
    }
};

